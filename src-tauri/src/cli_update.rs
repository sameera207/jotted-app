//! CLI updates (specs/CLI-updates-spec.md): the app installs new `jotted` releases on its own.
//!
//! ```text
//! <app data>/cli/0.1.0/jotted/jotted     seeded from the app bundle
//!                0.2.0/jotted/jotted     downloaded, checked, smoke tested
//!                current -> 0.2.0        what runs (and what Claude Desktop is connected to)
//!                state.json              last check, skipped versions, the one before `current`
//! ```
//!
//! Nothing in a release is trusted until `release.json`'s minisign signature checks out against
//! the key built into the app; then the build's size and SHA-256 must match it. Only releases
//! with a contract this app supports are installed. A new CLI that won't start is rolled back.

use crate::bin;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

include!(concat!(env!("OUT_DIR"), "/release.rs"));

/// The latest release's files: a plain download, not the GitHub API (no rate limit).
pub const RELEASES: &str = "https://github.com/sameera207/jotted-cli/releases/latest/download";
/// Contracts this app is built for. Must match SUPPORTED_CONTRACTS in src/store/startup.ts (a test checks).
pub const SUPPORTED_CONTRACTS: &[u32] = &[1];
pub const EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(15);
const BUILD_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// A serve supervisor that gives up this soon after a switch means the new CLI is broken.
const ROLLBACK_WINDOW: Duration = Duration::from_secs(10 * 60);

// ---------------------------------------------------------------- the manifest

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Build {
    pub file: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    pub tag: String,
    pub version: String,
    pub contract: u32,
    pub contract_min: u32,
    pub builds: BTreeMap<String, Build>,
}

/// Check `release.json` against its signature and the built-in key, then read it.
pub fn verify_manifest(manifest: &[u8], signature: &str, key: &str) -> Result<Manifest, String> {
    let pk = minisign_verify::PublicKey::decode(key)
        .or_else(|_| minisign_verify::PublicKey::from_base64(key))
        .map_err(|e| format!("the built-in release key can't be read: {e}"))?;
    let sig = minisign_verify::Signature::decode(signature).map_err(|e| format!("release.json.minisig can't be read: {e}"))?;
    pk.verify(manifest, &sig, false)
        .map_err(|_| "release.json isn't signed with the Jotted release key".to_string())?;
    serde_json::from_slice(manifest).map_err(|e| format!("release.json can't be read: {e}"))
}

pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut parts = v.trim().trim_start_matches('v').split('.');
    let version = (parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?);
    parts.next().is_none().then_some(version)
}

/// Whether `a` is a newer version than `b`. Anything that doesn't parse is never newer.
pub fn newer(a: &str, b: &str) -> bool {
    match (parse_version(a), parse_version(b)) {
        (Some(a), Some(b)) => a > b,
        (Some(_), None) => true,
        _ => false,
    }
}

#[derive(Debug, PartialEq)]
pub enum Decision {
    Install,
    UpToDate,
    /// A newer release with a contract this app wasn't built for: it waits for an app update.
    NeedsNewerApp,
    /// It failed before (a checksum, a smoke test, a serve that wouldn't start).
    Skipped,
}

pub fn decide(m: &Manifest, current: &str, skipped: &[String]) -> Decision {
    if !newer(&m.version, current) {
        Decision::UpToDate
    } else if !SUPPORTED_CONTRACTS.contains(&m.contract) {
        Decision::NeedsNewerApp
    } else if skipped.contains(&m.version) {
        Decision::Skipped
    } else {
        Decision::Install
    }
}

/// This Mac's build in the manifest.
pub fn target() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "macos-arm64"
    } else {
        "macos-x64"
    }
}

pub fn check_build(bytes: &[u8], build: &Build) -> Result<(), String> {
    if bytes.len() as u64 != build.size {
        return Err(format!("{} is {} bytes, the manifest says {}", build.file, bytes.len(), build.size));
    }
    let sum: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
    if !sum.eq_ignore_ascii_case(&build.sha256) {
        return Err(format!("{}: checksum {sum} doesn't match the manifest", build.file));
    }
    Ok(())
}

// ---------------------------------------------------------------- files

/// Unpack a .tar.gz into `dest`, refusing absolute paths and `..` (in names and link targets).
pub fn unpack(archive: &[u8], dest: &Path) -> Result<(), String> {
    let unsafe_path = |p: &Path| p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_)));
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(archive));
    tar.set_preserve_permissions(true);
    for entry in tar.entries().map_err(|e| format!("the build isn't a .tar.gz: {e}"))? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        if unsafe_path(&path) {
            return Err(format!("the build has an unsafe path: {}", path.display()));
        }
        if let Some(link) = entry.link_name().map_err(|e| e.to_string())? {
            if link.is_absolute() || (entry.header().entry_type().is_hard_link() && unsafe_path(&link)) {
                return Err(format!("the build has an unsafe link: {} -> {}", path.display(), link.display()));
            }
        }
        if !entry.unpack_in(dest).map_err(|e| e.to_string())? {
            return Err(format!("the build has an unsafe path: {}", path.display()));
        }
    }
    Ok(())
}

/// Point `current` at `version` in one step: a new link beside it, renamed over it.
pub fn switch_current(root: &Path, version: &str) -> io::Result<()> {
    let next = root.join("current.next");
    let _ = fs::remove_file(&next);
    #[cfg(unix)]
    std::os::unix::fs::symlink(version, &next)?;
    fs::rename(&next, root.join("current"))
}

pub fn current_version(root: &Path) -> Option<String> {
    fs::read_link(root.join("current")).ok()?.file_name()?.to_str().map(String::from)
}

/// The versions in the CLI folder.
pub fn versions(root: &Path) -> Vec<String> {
    fs::read_dir(root)
        .map(|dir| {
            dir.flatten()
                .filter(|e| e.path().is_dir() && !e.path().is_symlink())
                .filter_map(|e| e.file_name().to_str().map(String::from))
                .filter(|name| parse_version(name).is_some())
                .collect()
        })
        .unwrap_or_default()
}

/// Delete every version but `keep`, and leftovers of an interrupted install.
pub fn prune(root: &Path, keep: &[&str]) {
    let Ok(dir) = fs::read_dir(root) else { return };
    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let stale = (parse_version(&name).is_some() && !keep.contains(&name.as_str())) || name.ends_with(".partial") || name == ".download";
        if stale && !entry.path().is_symlink() {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// Copy a folder, keeping symlinks as links and files' permissions.
pub fn copy_dir(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let (from, to) = (entry.path(), dst.join(entry.file_name()));
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(fs::read_link(&from)?, &to)?;
        } else if kind.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

// ---------------------------------------------------------------- state.json

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct State {
    /// "Update automatically" (Settings), on by default.
    pub auto: bool,
    pub last_check: Option<u64>,
    pub skipped: Vec<String>,
    /// The version before `current`, kept for going back.
    pub previous: Option<String>,
    /// When each downloaded version was installed (seeded ones aren't here).
    pub installed: BTreeMap<String, u64>,
    /// A newer release found by the last check, installable or not.
    pub available: Option<Manifest>,
    /// The last check's problem, to show in Settings ("Couldn't verify the latest release").
    pub problem: Option<String>,
}

impl Default for State {
    fn default() -> Self {
        Self { auto: true, last_check: None, skipped: vec![], previous: None, installed: BTreeMap::new(), available: None, problem: None }
    }
}

pub fn load_state(root: &Path) -> State {
    fs::read(root.join("state.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save_state(root: &Path, state: &State) -> io::Result<()> {
    fs::create_dir_all(root)?;
    let tmp = root.join("state.json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(state)?)?;
    fs::rename(tmp, root.join("state.json"))
}

// ---------------------------------------------------------------- downloads, smoke test

#[derive(Debug)]
pub enum FetchError {
    /// Offline, a timeout, a server error: try again later, silently.
    Unreachable(String),
    /// The release says something we refuse.
    Refused(String),
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        // https only, except a local test server
        .https_only(!cfg!(test) && !cfg!(debug_assertions))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .expect("an HTTP client")
}

async fn fetch(client: &reqwest::Client, url: &str, timeout: Duration) -> Result<Vec<u8>, FetchError> {
    let res = client.get(url).timeout(timeout).send().await.map_err(|e| FetchError::Unreachable(e.to_string()))?;
    if !res.status().is_success() {
        return Err(FetchError::Unreachable(format!("{url}: HTTP {}", res.status())));
    }
    Ok(res.bytes().await.map_err(|e| FetchError::Unreachable(e.to_string()))?.to_vec())
}

/// `jotted --json version`, run as the app runs it: its version and contract.
pub async fn smoke_test(path: &Path) -> Result<(String, u32), String> {
    let mut cmd = bin::command(path, &["--json".into(), "version".into()]);
    cmd.stdin(std::process::Stdio::null());
    let out = tokio::time::timeout(Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| "no answer to `version` in 60 s".to_string())?
        .map_err(|e| format!("it didn't start: {e}"))?;
    let envelope: Value = serde_json::from_slice(&out.stdout).map_err(|_| "`version` didn't answer in JSON".to_string())?;
    let data = &envelope["data"];
    match (envelope["ok"].as_bool(), data["version"].as_str(), data["contract"].as_u64()) {
        (Some(true), Some(v), Some(c)) => Ok((v.to_string(), c as u32)),
        _ => Err("`version` didn't say its version and contract".into()),
    }
}

// ---------------------------------------------------------------- the updater

#[derive(Debug, Clone, Serialize)]
pub struct Active {
    pub version: String,
    pub contract: u32,
    /// `cli/current/jotted/jotted`: the stable path (also what Claude Desktop runs).
    pub path: PathBuf,
}

pub struct Updater {
    pub root: PathBuf,
    base: String,
    key: Option<String>,
    /// Why updates are off ("development", "no-key"), or None.
    off: Option<&'static str>,
    busy: tokio::sync::Mutex<()>,
    active: Mutex<Option<Active>>,
    switched_at: Mutex<Option<Instant>>,
}

#[derive(Debug, PartialEq)]
pub enum Checked {
    UpToDate,
    Install(Manifest),
    NeedsNewerApp(Manifest),
    Skipped(Manifest),
}

impl Updater {
    pub fn new(root: PathBuf, base: String, key: Option<String>, off: Option<&'static str>) -> Self {
        Self { root, base, key, off, busy: tokio::sync::Mutex::new(()), active: Mutex::new(None), switched_at: Mutex::new(None) }
    }

    pub fn active(&self) -> Option<Active> {
        self.active.lock().unwrap().clone()
    }

    pub fn state(&self) -> State {
        load_state(&self.root)
    }

    fn update_state(&self, change: impl FnOnce(&mut State)) {
        let mut state = self.state();
        change(&mut state);
        let _ = save_state(&self.root, &state);
    }

    /// Copy the bundled CLI into `cli/<bundled version>/` unless something at least as new is
    /// there, then check `current` runs. Without a working `current` the bundled copy runs.
    pub async fn seed(&self, bundled: Option<PathBuf>) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let have = versions(&self.root);
        let seeded = have.iter().any(|v| !newer(BUNDLED_VERSION, v));
        if !seeded {
            if let Some(src) = bundled.filter(|p| p.join("jotted").exists()) {
                let (root, version) = (self.root.clone(), BUNDLED_VERSION.to_string());
                tokio::task::spawn_blocking(move || -> io::Result<()> {
                    let partial = root.join(format!("{version}.partial"));
                    let _ = fs::remove_dir_all(&partial);
                    copy_dir(&src, &partial.join("jotted"))?;
                    fs::rename(&partial, root.join(&version))
                })
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| format!("couldn't copy the bundled jotted: {e}"))?;
            }
        }
        // `current` at the newest version when it's missing, gone, or older than the bundled
        // one (an app update brought a newer CLI than any download).
        let newest = versions(&self.root).into_iter().max_by_key(|v| parse_version(v));
        let current = current_version(&self.root);
        if let Some(newest) = newest {
            let behind = current.as_deref().map_or(true, |c| !self.root.join(c).exists() || newer(BUNDLED_VERSION, c));
            if behind {
                switch_current(&self.root, &newest).map_err(|e| e.to_string())?;
            }
        }
        self.validate().await
    }

    /// Run `current`'s `version`; keep it as the active CLI if it answers.
    pub async fn validate(&self) -> Result<(), String> {
        let path = self.root.join("current").join("jotted").join("jotted");
        let result = smoke_test(&path).await;
        *self.active.lock().unwrap() = result.as_ref().ok().map(|(version, contract)| Active { version: version.clone(), contract: *contract, path: path.clone() });
        result.map(|_| ()).map_err(|e| format!("cli/current doesn't run ({e}); using the bundled jotted"))
    }

    /// The version running: `current`'s, or the bundled one.
    fn running_version(&self) -> String {
        self.active().map(|a| a.version).unwrap_or_else(|| BUNDLED_VERSION.to_string())
    }

    /// Download and verify `release.json`, and say what to do about it.
    pub async fn check(&self, client: &reqwest::Client) -> Result<Checked, FetchError> {
        let key = self.key.as_deref().ok_or_else(|| FetchError::Refused("this build has no release key".into()))?;
        let manifest = fetch(client, &format!("{}/release.json", self.base), MANIFEST_TIMEOUT).await?;
        let signature = fetch(client, &format!("{}/release.json.minisig", self.base), MANIFEST_TIMEOUT).await?;
        let signature = String::from_utf8(signature).map_err(|_| FetchError::Refused("release.json.minisig isn't text".into()))?;
        let verified = verify_manifest(&manifest, &signature, key);
        let mut state = self.state();
        state.last_check = Some(now());
        let m = match verified {
            Ok(m) => m,
            Err(e) => {
                state.problem = Some("Couldn't verify the latest release".into());
                let _ = save_state(&self.root, &state);
                return Err(FetchError::Refused(e));
            }
        };
        state.problem = None;
        let decision = decide(&m, &self.running_version(), &state.skipped);
        state.available = (decision != Decision::UpToDate).then(|| m.clone());
        let _ = save_state(&self.root, &state);
        Ok(match decision {
            Decision::Install => Checked::Install(m),
            Decision::UpToDate => Checked::UpToDate,
            Decision::NeedsNewerApp => Checked::NeedsNewerApp(m),
            Decision::Skipped => Checked::Skipped(m),
        })
    }

    /// Download, check, unpack, smoke test and switch to `m`. Returns the version before it.
    pub async fn install(&self, client: &reqwest::Client, m: &Manifest) -> Result<Option<String>, FetchError> {
        if !SUPPORTED_CONTRACTS.contains(&m.contract) {
            return Err(FetchError::Refused(format!("jotted {} needs a newer app (contract {})", m.version, m.contract)));
        }
        let _busy = self.busy.lock().await;
        let build = m.builds.get(target()).ok_or_else(|| FetchError::Refused(format!("release {} has no {} build", m.version, target())))?;
        let partial = self.root.join(format!("{}.partial", m.version));
        let result = self.install_steps(client, m, build, &partial).await;
        if result.is_err() {
            let _ = fs::remove_dir_all(&partial);
        }
        if let Err(FetchError::Refused(_)) = &result {
            // A bad checksum or a build that won't run: don't try this one again.
            self.update_state(|s| {
                if !s.skipped.contains(&m.version) {
                    s.skipped.push(m.version.clone());
                }
            });
        }
        result
    }

    async fn install_steps(&self, client: &reqwest::Client, m: &Manifest, build: &Build, partial: &Path) -> Result<Option<String>, FetchError> {
        let refused = FetchError::Refused;
        // 1. Download it, and check its size and SHA-256 before anything reads it.
        let bytes = fetch(client, &format!("{}/{}", self.base, build.file), BUILD_TIMEOUT).await?;
        check_build(&bytes, build).map_err(refused)?;
        // 2. Unpack it; it must hold jotted/jotted, executable.
        let _ = fs::remove_dir_all(partial);
        let (dest, archive) = (partial.to_path_buf(), bytes);
        tokio::task::spawn_blocking(move || unpack(&archive, &dest)).await.map_err(|e| refused(e.to_string()))?.map_err(refused)?;
        let exe = partial.join("jotted").join("jotted");
        let runnable = fs::metadata(&exe).map(|meta| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                meta.is_file() && meta.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            meta.is_file()
        });
        if !runnable.unwrap_or(false) {
            return Err(refused(format!("the {} build has no runnable jotted/jotted", m.version)));
        }
        // 3. It runs, and says it's the version and contract the manifest says.
        let (version, contract) = smoke_test(&exe).await.map_err(|e| refused(format!("jotted {}: {e}", m.version)))?;
        if version != m.version || contract != m.contract {
            return Err(refused(format!("the build says {version} (contract {contract}), the manifest {} (contract {})", m.version, m.contract)));
        }
        // 4. Into place, and switch `current`.
        let final_dir = self.root.join(&m.version);
        let _ = fs::remove_dir_all(&final_dir);
        fs::rename(partial, &final_dir).map_err(|e| refused(e.to_string()))?;
        let before = current_version(&self.root);
        switch_current(&self.root, &m.version).map_err(|e| refused(e.to_string()))?;
        self.update_state(|s| {
            s.previous = before.clone().filter(|b| b != &m.version);
            s.installed.insert(m.version.clone(), now());
            s.available = None;
        });
        let keep: Vec<&str> = [Some(m.version.as_str()), before.as_deref()].into_iter().flatten().collect();
        prune(&self.root, &keep);
        *self.active.lock().unwrap() = Some(Active { version, contract, path: self.root.join("current").join("jotted").join("jotted") });
        *self.switched_at.lock().unwrap() = Some(Instant::now());
        Ok(before)
    }

    /// After a switch, `jotted serve` wouldn't start: back to the previous version, and skip
    /// this one. Returns (the broken version, the one now running), or None if there's
    /// nothing to go back to.
    pub async fn rollback(&self) -> Option<(String, String)> {
        let recent = self.switched_at.lock().unwrap().is_some_and(|t| t.elapsed() < ROLLBACK_WINDOW);
        let state = self.state();
        let (broken, previous) = (current_version(&self.root)?, state.previous.clone()?);
        if !recent || !self.root.join(&previous).exists() {
            return None;
        }
        switch_current(&self.root, &previous).ok()?;
        self.update_state(|s| {
            s.previous = None;
            if !s.skipped.contains(&broken) {
                s.skipped.push(broken.clone());
            }
        });
        *self.switched_at.lock().unwrap() = None;
        let _ = self.validate().await;
        Some((broken, previous))
    }

    /// For Settings › App › Jotted.
    pub fn status(&self, busy: bool) -> Value {
        let state = self.state();
        let active = self.active();
        let (version, contract) = active.as_ref().map_or((BUNDLED_VERSION.to_string(), BUNDLED_CONTRACT), |a| (a.version.clone(), a.contract));
        json!({
            "enabled": self.off.is_none(),
            "off": self.off,
            "auto": state.auto,
            "active": {
                "version": version,
                "contract": contract,
                "from_app": !state.installed.contains_key(&version),
                "installed_at": state.installed.get(&version),
            },
            "bundled": { "version": BUNDLED_VERSION, "contract": BUNDLED_CONTRACT },
            "available": state.available.as_ref().filter(|m| newer(&m.version, &version)).map(|m| json!({
                "version": m.version,
                "contract": m.contract,
                "compatible": SUPPORTED_CONTRACTS.contains(&m.contract),
            })),
            "last_check": state.last_check,
            "skipped": state.skipped,
            "problem": state.problem,
            "busy": busy,
        })
    }
}

// ---------------------------------------------------------------- the app

/// Make the updater, seed `cli/` and check `current` runs, then check every 6 hours.
pub fn setup(app: &AppHandle) {
    let Ok(data) = app.path().app_data_dir() else { return };
    let development = cfg!(debug_assertions) && std::env::var_os("JOTTED_BIN").is_some();
    let off = if development {
        Some("development")
    } else if RELEASE_KEY.is_none() {
        Some("no-key")
    } else {
        None
    };
    // A debug build can point at a test server instead of GitHub.
    let base = std::env::var("JOTTED_RELEASE_URL").ok().filter(|_| cfg!(debug_assertions)).unwrap_or_else(|| RELEASES.into());
    app.manage(Updater::new(data.join("cli"), base, RELEASE_KEY.map(String::from), off));
    if development {
        return; // JOTTED_BIN runs; nothing to seed
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = app.state::<Updater>();
        let bundled = app.path().resource_dir().ok().map(|d| d.join("jotted"));
        if let Err(e) = updater.seed(bundled).await {
            crate::log::write(&app, &format!("CLI updates: {e}"), b"");
        }
        if updater.off.is_some() {
            return;
        }
        loop {
            tokio::time::sleep(EVERY).await;
            run_check(&app, false).await;
        }
    });
}

/// The path to run, when `cli/current` works.
pub fn active_path(app: &AppHandle) -> Option<PathBuf> {
    app.try_state::<Updater>()?.active().map(|a| a.path)
}

fn emit(app: &AppHandle, note: Option<String>) {
    let updater = app.state::<Updater>();
    let busy = updater.busy.try_lock().is_err();
    let _ = app.emit("jotted://cli-update", json!({ "status": updater.status(busy), "note": note }));
}

/// Check, and install when updating automatically (or when `install` says to).
pub async fn run_check(app: &AppHandle, install: bool) -> Value {
    let updater = app.state::<Updater>();
    if updater.off.is_none() {
        let client = client();
        match updater.check(&client).await {
            Ok(Checked::Install(m)) if install || updater.state().auto => {
                emit(app, None);
                install_and_restart(app, &client, &m).await;
            }
            Ok(_) => {}
            Err(FetchError::Unreachable(e)) => crate::log::write(app, &format!("CLI updates: couldn't check ({e}); later"), b""),
            Err(FetchError::Refused(e)) => crate::log::write(app, &format!("CLI updates: {e}"), b""),
        }
    }
    emit(app, None);
    updater.status(false)
}

async fn install_and_restart(app: &AppHandle, client: &reqwest::Client, m: &Manifest) {
    let updater = app.state::<Updater>();
    match updater.install(client, m).await {
        Ok(_) => {
            crate::log::write(app, &format!("CLI updates: switched to jotted {}", m.version), b"");
            crate::restart_background(app).await;
            emit(app, Some(format!("Jotted updated to {}.", m.version)));
        }
        Err(FetchError::Unreachable(e)) => crate::log::write(app, &format!("CLI updates: download failed ({e}); later"), b""),
        Err(FetchError::Refused(e)) => {
            crate::log::write(app, &format!("CLI updates: {} refused: {e}", m.version), b"");
            emit(app, None);
        }
    }
}

/// The serve supervisor gave up. If that's right after a switch, go back.
pub fn on_serve_gave_up(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(updater) = app.try_state::<Updater>() else { return };
        if let Some((broken, previous)) = updater.rollback().await {
            crate::log::write(&app, &format!("CLI updates: jotted {broken} didn't start serve; back to {previous}"), b"");
            crate::restart_background(&app).await;
            emit(&app, Some(format!("Jotted {broken} didn't start, so the app went back to {previous}.")));
        }
    });
}

#[tauri::command]
pub fn cli_update_status(app: AppHandle) -> Value {
    let updater = app.state::<Updater>();
    let busy = updater.busy.try_lock().is_err();
    updater.status(busy)
}

/// "Check now" in Settings (and once at launch, after the list loads).
#[tauri::command]
pub async fn cli_update_check(app: AppHandle) -> Value {
    run_check(&app, false).await
}

/// "Install" when updating automatically is off.
#[tauri::command]
pub async fn cli_update_install(app: AppHandle) -> Value {
    let available = app.state::<Updater>().state().available;
    if let Some(m) = available.filter(|m| SUPPORTED_CONTRACTS.contains(&m.contract)) {
        install_and_restart(&app, &client(), &m).await;
    }
    cli_update_status(app)
}

/// "Try again" on a skipped version.
#[tauri::command]
pub async fn cli_update_retry(app: AppHandle, version: String) -> Value {
    app.state::<Updater>().update_state(|s| s.skipped.retain(|v| v != &version));
    run_check(&app, false).await
}

#[tauri::command]
pub fn cli_update_set_auto(app: AppHandle, on: bool) -> Value {
    let updater = app.state::<Updater>();
    updater.update_state(|s| s.auto = on);
    updater.status(false)
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn keypair() -> (minisign::KeyPair, String) {
        let kp = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
        let public = kp.pk.to_box().unwrap().into_string();
        (kp, public)
    }

    fn sign(kp: &minisign::KeyPair, data: &[u8]) -> String {
        minisign::sign(Some(&kp.pk), &kp.sk, data, Some("jotted v0.2.0"), None).unwrap().into_string()
    }

    /// A tiny build: jotted/jotted answers `--json version` with `version` and `contract`.
    fn build(version: &str, contract: u32) -> Vec<u8> {
        let script = format!("#!/bin/sh\necho '{{\"v\":1,\"ok\":true,\"data\":{{\"version\":\"{version}\",\"contract\":{contract}}}}}'\n");
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        let mut header = tar::Header::new_gnu();
        header.set_size(script.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        tar.append_data(&mut header, "jotted/jotted", script.as_bytes()).unwrap();
        let mut lib = tar::Header::new_gnu();
        lib.set_size(3);
        lib.set_mode(0o644);
        lib.set_cksum();
        tar.append_data(&mut lib, "jotted/_internal/lib.txt", &b"lib"[..]).unwrap();
        tar.into_inner().unwrap().finish().unwrap()
    }

    fn manifest_for(version: &str, contract: u32, archive: &[u8]) -> Manifest {
        let sum: String = Sha256::digest(archive).iter().map(|b| format!("{b:02x}")).collect();
        let file = format!("jotted-{version}-{}.tar.gz", target());
        Manifest {
            tag: format!("v{version}"),
            version: version.into(),
            contract,
            contract_min: 1,
            builds: [(target().to_string(), Build { file, sha256: sum, size: archive.len() as u64 })].into(),
        }
    }

    /// A local server for a release: path → bytes. Serves until the test ends.
    fn serve(files: BTreeMap<String, Vec<u8>>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut stream = stream;
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let path = request.split_whitespace().nth(1).unwrap_or("/").trim_start_matches('/').to_string();
                let (status, body) = files.get(&path).map_or(("404 Not Found", vec![]), |b| ("200 OK", b.clone()));
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(&body);
            }
        });
        base
    }

    struct Release {
        base: String,
        public: String,
        manifest: Manifest,
    }

    /// A signed release of `version` on a local server. `tamper` changes the served build.
    fn release(version: &str, contract: u32, tamper: bool) -> Release {
        let (kp, public) = keypair();
        let archive = build(version, contract);
        let manifest = manifest_for(version, contract, &archive);
        let json = serde_json::to_vec(&manifest).unwrap();
        let mut served = archive.clone();
        if tamper {
            served[20] ^= 0xff;
        }
        let files = BTreeMap::from([
            ("release.json".to_string(), json.clone()),
            ("release.json.minisig".to_string(), sign(&kp, &json).into_bytes()),
            (manifest.builds[target()].file.clone(), served),
        ]);
        Release { base: serve(files), public, manifest }
    }

    fn updater(root: &Path, r: &Release) -> Updater {
        Updater::new(root.to_path_buf(), r.base.clone(), Some(r.public.clone()), None)
    }

    // ---- the manifest

    #[test]
    fn a_good_signature_passes_and_a_bad_one_fails() {
        let (kp, public) = keypair();
        let m = serde_json::to_vec(&manifest_for("0.2.0", 1, b"x")).unwrap();
        let sig = sign(&kp, &m);
        assert_eq!(verify_manifest(&m, &sig, &public).unwrap().version, "0.2.0");
        let mut changed = m.clone();
        changed[5] ^= 1;
        assert!(verify_manifest(&changed, &sig, &public).is_err());
        let (_, other) = keypair();
        assert!(verify_manifest(&m, &sig, &other).is_err());
    }

    #[test]
    fn reads_the_manifest_jotted_cli_writes() {
        // The shape of scripts/release_manifest.py in jotted-cli (extra fields are ignored).
        let json = br#"{"name": "jotted", "tag": "v0.2.0", "version": "0.2.0", "contract": 1, "contract_min": 1,
            "builds": {"macos-arm64": {"file": "jotted-0.2.0-macos-arm64.tar.gz", "sha256": "ab", "size": 29},
                       "macos-x64": {"file": "jotted-0.2.0-macos-x64.tar.gz", "sha256": "cd", "size": 30}},
            "files": {"schema.json": {"sha256": "ef"}}}"#;
        let m: Manifest = serde_json::from_slice(json).unwrap();
        assert_eq!(m.builds["macos-x64"].size, 30);
    }

    #[test]
    fn refuses_a_wrong_checksum_or_size() {
        let archive = build("0.2.0", 1);
        let m = manifest_for("0.2.0", 1, &archive);
        let b = &m.builds[target()];
        assert!(check_build(&archive, b).is_ok());
        assert!(check_build(&archive[1..], b).is_err());
        let mut flipped = archive.clone();
        flipped[10] ^= 1;
        assert!(check_build(&flipped, b).unwrap_err().contains("checksum"));
    }

    #[test]
    fn decides_by_version_contract_and_skipped() {
        let m = |v: &str, c| manifest_for(v, c, b"x");
        assert_eq!(decide(&m("0.2.0", 1), "0.1.0", &[]), Decision::Install);
        assert_eq!(decide(&m("0.1.0", 1), "0.1.0", &[]), Decision::UpToDate);
        assert_eq!(decide(&m("0.1.9", 1), "0.2.0", &[]), Decision::UpToDate);
        assert_eq!(decide(&m("0.10.0", 1), "0.9.0", &[]), Decision::Install);
        assert_eq!(decide(&m("0.3.0", 2), "0.2.0", &[]), Decision::NeedsNewerApp);
        assert_eq!(decide(&m("0.2.1", 1), "0.2.0", &["0.2.1".into()]), Decision::Skipped);
        assert!(!newer("garbage", "0.1.0"));
    }

    #[test]
    fn matches_the_front_ends_contracts() {
        let startup = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/store/startup.ts")).unwrap();
        let line = startup.lines().find(|l| l.contains("SUPPORTED_CONTRACTS =")).unwrap();
        let listed: Vec<u32> = line.split(['[', ']']).nth(1).unwrap().split(',').filter_map(|n| n.trim().parse().ok()).collect();
        assert_eq!(listed, SUPPORTED_CONTRACTS);
    }

    // ---- files

    #[test]
    fn refuses_archive_paths_that_escape() {
        let dir = tempfile::tempdir().unwrap();
        for bad in ["../evil", "jotted/../../evil"] {
            let mut raw = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
            let mut header = tar::Header::new_gnu();
            header.set_size(1);
            header.set_mode(0o644);
            // set_path refuses `..`, so write the name into the header directly, as an attacker would.
            header.as_old_mut().name[..bad.len()].copy_from_slice(bad.as_bytes());
            header.set_cksum();
            raw.append(&header, &b"x"[..]).unwrap();
            let archive = raw.into_inner().unwrap().finish().unwrap();
            assert!(unpack(&archive, dir.path()).unwrap_err().contains("unsafe"), "{bad}");
        }
        assert!(!dir.path().parent().unwrap().join("evil").exists());
    }

    #[test]
    fn switches_current_in_one_step() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("0.1.0")).unwrap();
        fs::create_dir_all(dir.path().join("0.2.0")).unwrap();
        switch_current(dir.path(), "0.1.0").unwrap();
        assert_eq!(current_version(dir.path()).as_deref(), Some("0.1.0"));
        switch_current(dir.path(), "0.2.0").unwrap();
        assert_eq!(current_version(dir.path()).as_deref(), Some("0.2.0"));
        assert!(!dir.path().join("current.next").exists());
    }

    // ---- against a local release server

    fn binary(root: &Path, version: &str) -> PathBuf {
        root.join(version).join("jotted").join("jotted")
    }

    fn seed_with(root: &Path, version: &str) {
        let dir = root.join(version);
        unpack(&build(version, 1), &dir).unwrap();
        switch_current(root, version).unwrap();
    }

    #[tokio::test]
    async fn installs_a_newer_release() {
        let dir = tempfile::tempdir().unwrap();
        seed_with(dir.path(), "0.1.0");
        let r = release("0.2.0", 1, false);
        let u = updater(dir.path(), &r);
        u.validate().await.unwrap();
        let client = client();
        let checked = u.check(&client).await.unwrap();
        assert_eq!(checked, Checked::Install(r.manifest.clone()));
        assert_eq!(u.install(&client, &r.manifest).await.unwrap().as_deref(), Some("0.1.0"));
        assert_eq!(current_version(dir.path()).as_deref(), Some("0.2.0"));
        assert_eq!(u.active().unwrap().version, "0.2.0");
        assert_eq!(u.state().previous.as_deref(), Some("0.1.0"));
        assert_eq!(u.status(false)["active"]["from_app"], false);
        // Checked again: nothing newer.
        assert_eq!(u.check(&client).await.unwrap(), Checked::UpToDate);
    }

    #[tokio::test]
    async fn refuses_a_release_signed_with_another_key() {
        let dir = tempfile::tempdir().unwrap();
        seed_with(dir.path(), "0.1.0");
        let r = release("0.2.0", 1, false);
        let (_, other) = keypair();
        let u = Updater::new(dir.path().to_path_buf(), r.base.clone(), Some(other), None);
        assert!(matches!(u.check(&client()).await, Err(FetchError::Refused(_))));
        assert_eq!(u.state().problem.as_deref(), Some("Couldn't verify the latest release"));
        assert!(!dir.path().join("0.2.0").exists());
    }

    #[tokio::test]
    async fn refuses_a_build_whose_checksum_is_wrong_and_skips_it() {
        let dir = tempfile::tempdir().unwrap();
        seed_with(dir.path(), "0.1.0");
        let r = release("0.2.0", 1, true);
        let u = updater(dir.path(), &r);
        u.validate().await.unwrap();
        assert!(matches!(u.install(&client(), &r.manifest).await, Err(FetchError::Refused(_))));
        assert_eq!(current_version(dir.path()).as_deref(), Some("0.1.0"));
        assert!(!dir.path().join("0.2.0.partial").exists());
        assert_eq!(u.state().skipped, vec!["0.2.0"]);
        assert!(matches!(u.check(&client()).await.unwrap(), Checked::Skipped(_)));
    }

    #[tokio::test]
    async fn leaves_a_release_with_a_new_contract_for_a_newer_app() {
        let dir = tempfile::tempdir().unwrap();
        seed_with(dir.path(), "0.1.0");
        let r = release("1.0.0", 2, false);
        let u = updater(dir.path(), &r);
        u.validate().await.unwrap();
        assert!(matches!(u.check(&client()).await.unwrap(), Checked::NeedsNewerApp(_)));
        assert_eq!(u.status(false)["available"]["compatible"], false);
        assert!(u.install(&client(), &r.manifest).await.is_err());
    }

    #[tokio::test]
    async fn offline_is_not_a_reason_to_skip() {
        let dir = tempfile::tempdir().unwrap();
        let u = Updater::new(dir.path().to_path_buf(), "http://127.0.0.1:9".into(), Some(keypair().1), None);
        assert!(matches!(u.check(&client()).await, Err(FetchError::Unreachable(_))));
        assert!(u.state().skipped.is_empty());
    }

    #[tokio::test]
    async fn seeds_from_the_bundle_and_falls_back_when_current_is_broken() {
        let dir = tempfile::tempdir().unwrap();
        let bundle = tempfile::tempdir().unwrap();
        unpack(&build(BUNDLED_VERSION, BUNDLED_CONTRACT), bundle.path()).unwrap();
        let r = release("9.9.9", 1, false);
        let u = updater(dir.path(), &r);
        u.seed(Some(bundle.path().join("jotted"))).await.unwrap();
        assert_eq!(current_version(dir.path()).as_deref(), Some(BUNDLED_VERSION));
        assert!(binary(dir.path(), BUNDLED_VERSION).exists());
        // Break it: `current` no longer runs, so the bundled copy does.
        fs::write(binary(dir.path(), BUNDLED_VERSION), "#!/bin/sh\nexit 3\n").unwrap();
        assert!(u.validate().await.is_err());
        assert!(u.active().is_none());
        assert_eq!(u.status(false)["active"]["version"], BUNDLED_VERSION);
    }

    #[tokio::test]
    async fn goes_back_when_serve_gives_up_right_after_a_switch() {
        let dir = tempfile::tempdir().unwrap();
        seed_with(dir.path(), "0.1.0");
        let r = release("0.2.0", 1, false);
        let u = updater(dir.path(), &r);
        u.validate().await.unwrap();
        u.install(&client(), &r.manifest).await.unwrap();
        assert_eq!(u.rollback().await, Some(("0.2.0".into(), "0.1.0".into())));
        assert_eq!(current_version(dir.path()).as_deref(), Some("0.1.0"));
        assert_eq!(u.state().skipped, vec!["0.2.0"]);
        assert_eq!(u.active().unwrap().version, "0.1.0");
        // Not twice, and not without a recent switch.
        assert_eq!(u.rollback().await, None);
    }
}

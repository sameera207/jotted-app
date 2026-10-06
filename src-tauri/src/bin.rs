//! Which `jotted` to run, and how every run of it starts.
//!
//! The app runs `cli/current/jotted/jotted` in its data folder: the bundled CLI copied there,
//! or a newer release it downloaded (cli_update.rs, specs/CLI-updates-spec.md). Until that
//! answers `version` (first launch, or a broken install), it runs the copy bundled in the app,
//! at `Contents/Resources/jotted/jotted` (see docs/bundling.md). Debug builds use `JOTTED_BIN`
//! when it is set: the fake CLI in tests/fake-jotted, or scripts/dev-jotted.sh for a
//! jotted-cli checkout; updates are then off.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::process::Command;

/// Where the bundled CLI sits inside the app's resources.
const BUNDLED: &str = "jotted/jotted";

pub fn jotted_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        if let Ok(bin) = std::env::var("JOTTED_BIN") {
            return Ok(resolve_dev_path(&bin));
        }
    }
    if let Some(current) = crate::cli_update::active_path(app) {
        return Ok(current);
    }
    bundled_path(app)
}

/// The copy inside the app bundle: the seed and the last resort.
pub fn bundled_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("can't find the app's resources: {e}"))?
        .join(BUNDLED);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!(
            "this build has no jotted inside ({}). For development, set JOTTED_BIN",
            path.display()
        ))
    }
}

/// `tauri dev` runs from src-tauri/, but JOTTED_BIN is usually written from the repo root.
fn resolve_dev_path(bin: &str) -> PathBuf {
    let path = Path::new(bin);
    if path.is_absolute() || path.exists() {
        return path.to_path_buf();
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(path)
}

/// macOS's certificate bundle. The frozen Python in a jotted release doesn't find any CA
/// certificates on its own, so its HTTPS downloads (rmapi in `setup prepare`) fail with
/// CERTIFICATE_VERIFY_FAILED unless it's pointed here.
const SYSTEM_CERTS: &str = "/etc/ssl/cert.pem";

/// A `jotted` command with the environment every run gets: `JOTTED_BUNDLED=1` (it never
/// updates itself; the app ships a new pin instead), no Python settings from the shell, and
/// the system's CA certificates unless `SSL_CERT_FILE` is already set.
pub fn command(path: &Path, args: &[String]) -> Command {
    let mut cmd = Command::new(path);
    cmd.args(args)
        .env("JOTTED_BUNDLED", "1")
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env_remove("VIRTUAL_ENV")
        .kill_on_drop(true);
    if std::env::var_os("SSL_CERT_FILE").is_none() && Path::new(SYSTEM_CERTS).exists() {
        cmd.env("SSL_CERT_FILE", SYSTEM_CERTS);
    }
    if !cfg!(debug_assertions) {
        // An app opened from the Finder doesn't get the shell's PATH; don't depend on it.
        cmd.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
    }
    cmd
}

/// Ask a child to stop the way `jotted serve` expects (SIGTERM), so it cleans up.
pub fn terminate(pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
    }
    #[cfg(not(unix))]
    let _ = pid;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_run_gets_the_system_certificates() {
        let cmd = command(Path::new("/bin/echo"), &[]);
        let envs: Vec<_> = cmd.as_std().get_envs().collect();
        let get = |k: &str| envs.iter().find(|(n, _)| *n == k).and_then(|(_, v)| *v).map(|v| v.to_owned());
        assert_eq!(get("JOTTED_BUNDLED").as_deref(), Some(std::ffi::OsStr::new("1")));
        if std::env::var_os("SSL_CERT_FILE").is_none() && Path::new(SYSTEM_CERTS).exists() {
            assert_eq!(get("SSL_CERT_FILE").as_deref(), Some(std::ffi::OsStr::new(SYSTEM_CERTS)));
        }
    }
}

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

/// A `jotted` command with the environment every run gets: `JOTTED_BUNDLED=1` (it never
/// updates itself; the app ships a new pin instead) and no Python settings from the shell.
pub fn command(path: &Path, args: &[String]) -> Command {
    let mut cmd = Command::new(path);
    cmd.args(args)
        .env("JOTTED_BUNDLED", "1")
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env_remove("VIRTUAL_ENV")
        .kill_on_drop(true);
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

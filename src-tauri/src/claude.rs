//! The path Claude Desktop runs, for `jotted claude connect --command PATH`
//! (specs/Claude-Desktop-spec.md, The Connect button). Claude keeps the path it is given, so it
//! must be one that lasts: `cli/current/jotted/jotted` in the app's data folder, which follows
//! every CLI update and doesn't move with the app (specs/CLI-updates-spec.md, Claude Desktop).
//! Only while that isn't there does it fall back to the copy inside the bundle, and then the
//! app must not be running from a disk image or a translocated copy. The commands themselves
//! still go through the runner.

use std::path::Path;
use tauri::AppHandle;

/// Why Claude couldn't keep running Jotted from this path, or None if it can.
pub fn refuse_location(exe: &Path) -> Option<&'static str> {
    let path = exe.to_string_lossy();
    // Still in the disk image, or run by macOS from a random temporary copy (a quarantined
    // app opened from Downloads): either path vanishes.
    if path.starts_with("/Volumes/") || path.contains("/AppTranslocation/") {
        return Some("Move Jotted to your Applications folder first, then open it from there.");
    }
    None
}

/// The bundled `jotted` the front end passes to `claude connect --command`, or None to pass
/// no `--command` (debug builds on `JOTTED_BIN`: the CLI then uses its own path, since
/// Claude Desktop can't run scripts/dev-jotted.sh). An Err is the message to show.
#[tauri::command]
pub fn claude_bundle_ok(app: AppHandle) -> Result<Option<String>, String> {
    if cfg!(debug_assertions) && std::env::var_os("JOTTED_BIN").is_some() {
        return Ok(None);
    }
    if let Some(current) = crate::cli_update::active_path(&app) {
        return Ok(Some(current.display().to_string()));
    }
    let exe = std::env::current_exe().map_err(|e| format!("can't tell where Jotted is running from: {e}"))?;
    if let Some(why) = refuse_location(&exe) {
        return Err(why.into());
    }
    Ok(Some(crate::bin::bundled_path(&app)?.display().to_string()))
}

/// The data-folder variables every `jotted` the app starts inherits (`bin::command` keeps
/// them), so the front end can tell whether Claude's entry reads the same data.
#[tauri::command]
pub fn jotted_env() -> serde_json::Value {
    let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
    serde_json::json!({ "config": var("JOTTED_CONFIG"), "home": var("JOTTED_HOME") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_paths_that_vanish() {
        assert!(refuse_location(Path::new("/Volumes/Jotted/Jotted.app/Contents/MacOS/jotted-app")).is_some());
        assert!(refuse_location(Path::new(
            "/private/var/folders/x1/abc/T/AppTranslocation/0F3A-11/d/Jotted.app/Contents/MacOS/jotted-app"
        ))
        .is_some());
    }

    #[test]
    fn allows_an_installed_app() {
        assert!(refuse_location(Path::new("/Applications/Jotted.app/Contents/MacOS/jotted-app")).is_none());
        assert!(refuse_location(Path::new("/Users/you/Applications/Jotted.app/Contents/MacOS/jotted-app")).is_none());
    }
}

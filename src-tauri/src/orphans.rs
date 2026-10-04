//! The long-running children's process ids, kept in the app's data folder, so a launch
//! after a crash (or a kill the app couldn't handle) stops the ones the last run left.

use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::Command, sync::Mutex};
use tauri::{AppHandle, Manager};

static LOCK: Mutex<()> = Mutex::new(());

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("children.json"))
}

fn read(app: &AppHandle) -> Value {
    file(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}))
}

/// Remember (or, with None, forget) the child running as `role` ("serve", "events").
pub fn record(app: &AppHandle, role: &str, pid: Option<u32>) {
    let Some(path) = file(app) else { return };
    let _guard = LOCK.lock();
    let mut pids = read(app);
    pids[role] = pid.map_or(Value::Null, Value::from);
    let _ = fs::create_dir_all(path.parent().unwrap());
    let _ = fs::write(path, pids.to_string());
}

/// SIGTERM the children a previous run left behind. Only processes that are still
/// `jotted serve` / `jotted events --follow` (the pid could have been reused) are touched.
pub fn stop_leftovers(app: &AppHandle) {
    let pids = read(app);
    for (role, marker) in [("serve", "serve"), ("events", "--follow")] {
        let Some(pid) = pids[role].as_u64() else { continue };
        let running = Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        if running.contains("jotted") && running.contains(marker) {
            crate::bin::terminate(Some(pid as u32));
            crate::log::write(app, &format!("stopped a {role} left by the last run (pid {pid})"), b"");
        }
        record(app, role, None);
    }
}

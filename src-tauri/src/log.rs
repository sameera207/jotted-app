//! A small rotating log of what `jotted` printed on stderr, in the app's log folder.
//! Never holds stdin (keys, codes): the runner doesn't pass it here.

use std::{fs, io::Write, sync::Mutex};
use tauri::{AppHandle, Manager};

const MAX_BYTES: u64 = 1_000_000;
const KEEP: usize = 3;
static LOCK: Mutex<()> = Mutex::new(());

pub fn write(app: &AppHandle, line: &str, stderr: &[u8]) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    let _guard = LOCK.lock();
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("jotted.log");
    if fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        for i in (1..KEEP).rev() {
            let _ = fs::rename(dir.join(format!("jotted.{i}.log")), dir.join(format!("jotted.{}.log", i + 1)));
        }
        let _ = fs::rename(&path, dir.join("jotted.1.log"));
    }
    let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) else { return };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = writeln!(f, "[{now}] {line}");
    if !stderr.is_empty() {
        let _ = f.write_all(stderr);
        if !stderr.ends_with(b"\n") {
            let _ = f.write_all(b"\n");
        }
    }
}

/// The log folder, for "Show log".
#[tauri::command]
pub fn log_path(app: AppHandle) -> Option<String> {
    app.path().app_log_dir().ok().map(|d| d.join("jotted.log").display().to_string())
}

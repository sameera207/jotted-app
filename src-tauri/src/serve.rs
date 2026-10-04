//! The serve supervisor: keeps `jotted serve --no-browser --port 0` running while the app
//! runs, so every other command hands its work to it and comes back quickly.
//!
//! It restarts the server with backoff (1 s, 5 s, 30 s). After three fast failures it gives
//! up and says so with a `jotted://serve` event; commands still work without it, slower.

use crate::bin;
use serde_json::json;
use std::{fs, path::PathBuf, process::Stdio, time::Duration, time::Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri::async_runtime::JoinHandle;
use tokio::sync::watch;

const BACKOFF: [u64; 3] = [1, 5, 30];
/// A server that exits sooner than this counts as a fast failure.
const FAST: Duration = Duration::from_secs(10);
const FAST_FAILURES: u32 = 3;
const STOP_WAIT: Duration = Duration::from_secs(5);

pub struct Supervisor {
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

fn emit(app: &AppHandle, state: &str) {
    let _ = app.emit("jotted://serve", json!({ "state": state }));
}

/// The server's own output goes to serve.log, next to the runner's log.
fn log_file(app: &AppHandle) -> Stdio {
    let file = app.path().app_log_dir().ok().and_then(|dir| {
        let _ = fs::create_dir_all(&dir);
        fs::OpenOptions::new().create(true).append(true).open(dir.join("serve.log")).ok()
    });
    file.map(Stdio::from).unwrap_or_else(Stdio::null)
}

pub fn start(app: AppHandle, path: PathBuf) -> Supervisor {
    let (stop, mut stopped) = watch::channel(false);
    let task = tauri::async_runtime::spawn(async move {
        let args: Vec<String> = ["serve", "--no-browser", "--port", "0"].map(String::from).to_vec();
        let (mut attempt, mut fast) = (0usize, 0u32);
        while !*stopped.borrow() {
            let mut cmd = bin::command(&path, &args);
            cmd.stdin(Stdio::null()).stdout(log_file(&app)).stderr(log_file(&app));
            let started = Instant::now();
            match cmd.spawn() {
                Ok(mut child) => {
                    crate::orphans::record(&app, "serve", child.id());
                    emit(&app, "running");
                    tokio::select! {
                        _ = child.wait() => {}
                        _ = stopped.changed() => {
                            bin::terminate(child.id());
                            if tokio::time::timeout(STOP_WAIT, child.wait()).await.is_err() {
                                let _ = child.kill().await;
                            }
                            crate::orphans::record(&app, "serve", None);
                            return;
                        }
                    }
                }
                Err(e) => crate::log::write(&app, &format!("jotted serve didn't start: {e}"), b""),
            }
            if started.elapsed() < FAST {
                fast += 1;
            } else {
                fast = 0;
                attempt = 0;
            }
            if fast >= FAST_FAILURES {
                emit(&app, "failed");
                // Right after a CLI update, that means the new jotted is broken: go back.
                crate::cli_update::on_serve_gave_up(&app);
                return;
            }
            emit(&app, "restarting");
            let wait = Duration::from_secs(BACKOFF[attempt.min(BACKOFF.len() - 1)]);
            attempt += 1;
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = stopped.changed() => return,
            }
        }
    });
    Supervisor { stop, task }
}

impl Supervisor {
    /// SIGTERM the server and wait for it (up to 5 s).
    pub async fn stop(self) {
        let _ = self.stop.send(true);
        let _ = self.task.await;
    }
}

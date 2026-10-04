//! The events follower: one `jotted events --follow` process, each line forwarded to the
//! window as the Tauri event `jotted://event`.
//!
//! It remembers the last cursor and passes it back with `--since` when it restarts, so a
//! crash in between loses nothing. The front end gives the first cursor: the one it read
//! just before loading the list (see src/store/startup.ts).

use crate::bin;
use serde_json::Value;
use std::{
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicI64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use tauri::async_runtime::JoinHandle;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    sync::watch,
};

const BACKOFF: [u64; 3] = [1, 5, 30];
/// A follower that ran this long was healthy: the next restart starts the backoff again.
const HEALTHY: Duration = Duration::from_secs(30);
const NO_CURSOR: i64 = -1;

pub struct Follower {
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
    cursor: Arc<AtomicI64>,
}

pub fn start(app: AppHandle, path: PathBuf, since: Option<i64>) -> Follower {
    let (stop, mut stopped) = watch::channel(false);
    let cursor = Arc::new(AtomicI64::new(since.unwrap_or(NO_CURSOR)));
    let shared = cursor.clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut attempt = 0usize;
        while !*stopped.borrow() {
            let mut args = vec!["--json".to_string(), "events".into(), "--follow".into()];
            let last = cursor.load(Ordering::SeqCst);
            if last != NO_CURSOR {
                args.extend(["--since".into(), last.to_string()]);
            }
            let mut cmd = bin::command(&path, &args);
            cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
            let started = Instant::now();
            match cmd.spawn() {
                Ok(mut child) => {
                    crate::orphans::record(&app, "events", child.id());
                    let mut lines = BufReader::new(child.stdout.take().expect("piped stdout")).lines();
                    loop {
                        tokio::select! {
                            line = lines.next_line() => match line {
                                Ok(Some(line)) => forward(&app, &cursor, &line),
                                _ => break, // it exited: restart below
                            },
                            _ = stopped.changed() => {
                                let _ = child.kill().await;
                                crate::orphans::record(&app, "events", None);
                                return;
                            }
                        }
                    }
                    let _ = child.wait().await;
                }
                Err(e) => crate::log::write(&app, &format!("jotted events didn't start: {e}"), b""),
            }
            if started.elapsed() > HEALTHY {
                attempt = 0;
            }
            let wait = Duration::from_secs(BACKOFF[attempt.min(BACKOFF.len() - 1)]);
            attempt += 1;
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = stopped.changed() => return,
            }
        }
    });
    Follower { stop, task, cursor: shared }
}

fn forward(app: &AppHandle, cursor: &AtomicI64, line: &str) {
    let Ok(event) = serde_json::from_str::<Value>(line) else {
        crate::log::write(app, "jotted events printed a line that isn't JSON", line.as_bytes());
        return;
    };
    if let Some(c) = event.get("cursor").and_then(Value::as_i64) {
        cursor.store(c, Ordering::SeqCst);
    }
    let _ = app.emit("jotted://event", event);
}

impl Follower {
    /// The last cursor it forwarded, to start another follower from.
    pub fn cursor(&self) -> Option<i64> {
        Some(self.cursor.load(Ordering::SeqCst)).filter(|c| *c != NO_CURSOR)
    }

    pub async fn stop(self) {
        let _ = self.stop.send(true);
        let _ = self.task.await;
    }
}

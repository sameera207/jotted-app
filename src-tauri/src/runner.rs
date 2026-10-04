//! The runner: the one way the front end runs `jotted`.
//!
//! `jotted(args, stdin?)` runs `jotted --json ARGS`, writes `stdin` (keys, one-time codes)
//! and closes it, and returns the envelope the CLI printed. Only commands in the vendored
//! schema.json can run, minus the ones the app must never start from the front end.

use crate::{bin, log};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

include!(concat!(env!("OUT_DIR"), "/schema_commands.rs"));

/// Long-running, interactive, or managed by the app itself.
const BLOCKED: &[&str] = &["serve", "start", "update", "mcp", "setup", "auth"];
/// Flags the front end can't pass: the follower owns `--follow`, and nothing writes files.
const BLOCKED_FLAGS: &[&str] = &["--follow", "-o", "--out"];
/// Commands that talk to the tablet or a model, and can take minutes.
const SLOW: &[&str] = &["check", "collect", "todo", "connect", "setup prepare"];

const TIMEOUT: Duration = Duration::from_secs(60);
const SLOW_TIMEOUT: Duration = Duration::from_secs(600);

/// The schema command these args run: the longest command whose words start the args.
pub fn command_of(args: &[String]) -> Option<&'static str> {
    SCHEMA_COMMANDS
        .iter()
        .filter(|name| {
            let words: Vec<&str> = name.split(' ').collect();
            words.len() <= args.len() && words.iter().zip(args).all(|(w, a)| w == a)
        })
        .max_by_key(|name| name.len())
        .copied()
}

/// A key pasted into an argument instead of stdin: an `sk-…` key, or a long token with no
/// spaces or slashes that isn't a document id (UUID).
pub fn looks_like_secret(arg: &str) -> bool {
    if arg.starts_with("sk-") {
        return true;
    }
    let tokenish = arg.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    let uuid = arg.len() == 36 && arg.chars().enumerate().all(|(i, c)| match i {
        8 | 13 | 18 | 23 => c == '-',
        _ => c.is_ascii_hexdigit(),
    });
    arg.len() >= 32 && tokenish && !uuid
}

/// Why these args can't run, or None if they can.
pub fn refuse(args: &[String]) -> Option<String> {
    let Some(name) = command_of(args) else {
        return Some(format!("`{}` isn't a jotted command", args.join(" ")));
    };
    if BLOCKED.contains(&name) {
        return Some(format!("the app doesn't run `jotted {name}`"));
    }
    if let Some(flag) = args.iter().find(|a| BLOCKED_FLAGS.contains(&a.as_str())) {
        return Some(format!("the app doesn't pass {flag}"));
    }
    if args.iter().any(|a| looks_like_secret(a)) {
        return Some("that looks like a key: keys go on stdin, never in arguments".into());
    }
    None
}

fn failure(code: &str, message: impl Into<String>) -> Value {
    json!({"v": 1, "ok": false, "error": {"code": code, "message": message.into()}})
}

/// Read the envelope from stdout. Anything else becomes an `internal` error.
pub fn parse_envelope(stdout: &[u8], exit: Option<i32>) -> Value {
    match serde_json::from_slice::<Value>(stdout) {
        Ok(v) if v.get("ok").and_then(Value::as_bool).is_some() => v,
        _ => failure(
            "internal",
            format!(
                "Jotted didn't answer as expected (exit {}). The log has the details.",
                exit.map_or("unknown".into(), |c| c.to_string())
            ),
        ),
    }
}

#[tauri::command]
pub async fn jotted(app: AppHandle, args: Vec<String>, stdin: Option<String>) -> Value {
    if let Some(why) = refuse(&args) {
        return failure("invalid", why);
    }
    let name = command_of(&args).unwrap_or_default();
    let path = match bin::jotted_path(&app) {
        Ok(p) => p,
        Err(e) => return failure("internal", e),
    };
    let mut full = vec!["--json".to_string()];
    full.extend(args.iter().filter(|a| *a != "--json").cloned());

    let mut cmd = bin::command(&path, &full);
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return failure("internal", format!("couldn't start jotted: {e}")),
    };
    if let Some(mut pipe) = child.stdin.take() {
        if let Some(text) = stdin {
            let _ = pipe.write_all(text.as_bytes()).await;
        }
        drop(pipe); // close it: under --json the CLI never waits for more
    }

    let limit = if SLOW.contains(&name) { SLOW_TIMEOUT } else { TIMEOUT };
    let output = match tokio::time::timeout(limit, child.wait_with_output()).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return failure("internal", format!("jotted {name} failed to run: {e}")),
        Err(_) => {
            log::write(&app, &format!("jotted {name}: no answer after {} s, stopped", limit.as_secs()), b"");
            return failure("internal", format!("`jotted {name}` took longer than {} s", limit.as_secs()));
        }
    };
    let exit = output.status.code();
    // Arguments are logged (they never hold secrets: see refuse); stdin never is.
    log::write(&app, &format!("jotted {} → exit {}", args.join(" "), exit.unwrap_or(-1)), &output.stderr);
    parse_envelope(&output.stdout, exit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(s: &str) -> Vec<String> {
        s.split(' ').map(String::from).collect()
    }

    #[test]
    fn finds_the_longest_command() {
        assert_eq!(command_of(&a("items done 12")), Some("items done"));
        assert_eq!(command_of(&a("items --status all")), Some("items"));
        assert_eq!(command_of(&a("setup status")), Some("setup status"));
        assert_eq!(command_of(&a("nope")), None);
    }

    #[test]
    fn refuses_what_the_front_end_cant_run() {
        assert!(refuse(&a("items done 12")).is_none());
        assert!(refuse(&a("setup status")).is_none());
        assert!(refuse(&a("connect --stdin --replace")).is_none());
        for blocked in ["serve --port 0", "setup", "update", "mcp", "auth --stdin", "start"] {
            assert!(refuse(&a(blocked)).is_some(), "{blocked}");
        }
        assert!(refuse(&a("events --follow")).is_some());
        assert!(refuse(&a("image page abc 1 -o /tmp/x.svg")).is_some());
        assert!(refuse(&a("rm -rf")).is_some());
    }

    #[test]
    fn runs_claude_connect_with_the_bundled_path() {
        assert!(refuse(&a("claude connect --command /Applications/Jotted.app/Contents/Resources/jotted/jotted")).is_none());
        assert!(refuse(&a("claude connect --command /Applications/Jotted.app/Contents/Resources/jotted/jotted --admin")).is_none());
        assert!(refuse(&a("claude status")).is_none());
        assert!(refuse(&a("claude disconnect")).is_none());
        assert!(!looks_like_secret("/Users/you/Applications/Jotted.app/Contents/Resources/jotted/jotted"));
        assert!(refuse(&a("mcp --admin")).is_some());
    }

    #[test]
    fn refuses_keys_in_arguments() {
        assert!(refuse(&a("ai key llm sk-ant-api03-abcdef")).is_some());
        assert!(looks_like_secret("ts_0123456789abcdefghijklmnopqrstuv"));
        assert!(!looks_like_secret("3f6c2a10-8d1e-4f5b-9a77-1c2d3e4f5a01"));
        assert!(!looks_like_secret("Book the retro room"));
        assert!(!looks_like_secret("https://example.com/a-very-long-path-that-goes-on-and-on"));
    }

    #[test]
    fn bad_output_becomes_internal() {
        assert_eq!(parse_envelope(b"", Some(1))["error"]["code"], "internal");
        assert_eq!(parse_envelope(b"Traceback (most recent call last)", Some(1))["error"]["code"], "internal");
        let ok = parse_envelope(br#"{"v":1,"ok":true,"data":[]}"#, Some(0));
        assert_eq!(ok["ok"], true);
    }
}

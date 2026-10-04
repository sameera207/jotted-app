mod bin;
mod claude;
mod cli_update;
mod events;
mod log;
mod orphans;
mod runner;
mod serve;
mod tray;

use tauri::{AppHandle, Manager, RunEvent};
use tokio::sync::Mutex;

/// The two long-running `jotted` processes, while they run.
#[derive(Default)]
struct Background(Mutex<Option<(serve::Supervisor, events::Follower)>>);

/// Start `jotted serve` and the events follower, once setup is complete. `since` is the
/// cursor read just before the front end loaded the list. Starting twice does nothing.
#[tauri::command]
async fn start_background(app: AppHandle, since: Option<i64>) -> Result<(), String> {
    start(&app, since).await
}

async fn start(app: &AppHandle, since: Option<i64>) -> Result<(), String> {
    let state = app.state::<Background>();
    let mut running = state.0.lock().await;
    if running.is_none() {
        orphans::stop_leftovers(app);
        let path = bin::jotted_path(app)?;
        let server = serve::start(app.clone(), path.clone());
        let follower = events::start(app.clone(), path, since);
        *running = Some((server, follower));
    }
    Ok(())
}

/// After a CLI update (or going back): stop both, then start them on the new `current`,
/// the follower from the last cursor it saw so no event is missed. Nothing if they weren't
/// running yet (setup isn't complete).
pub(crate) async fn restart_background(app: &AppHandle) {
    let taken = app.state::<Background>().0.lock().await.take();
    let Some((server, follower)) = taken else { return };
    let since = follower.cursor();
    follower.stop().await;
    server.stop().await;
    if let Err(e) = start(app, since).await {
        log::write(app, &format!("restarting jotted after an update: {e}"), b"");
    }
}

/// Stop the follower, then SIGTERM the server and wait for it (up to 5 s).
async fn stop_background(app: &AppHandle) {
    let taken = app.state::<Background>().0.lock().await.take();
    if let Some((server, follower)) = taken {
        follower.stop().await;
        server.stop().await;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Open at login starts Jotted with --hidden: only the menu bar, no window.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(Background::default())
        .manage(tray::KeepRunning::default())
        .on_window_event(tray::on_main_close)
        .invoke_handler(tauri::generate_handler![runner::jotted, start_background, log::log_path, claude::claude_bundle_ok, claude::jotted_env,
            tray::set_tray_title, tray::set_tray_state, tray::set_dock_icon, tray::set_keep_running, tray::show_main,
            cli_update::cli_update_status, cli_update::cli_update_check, cli_update::cli_update_install,
            cli_update::cli_update_retry, cli_update::cli_update_set_auto])
        .setup(|app| {
            cli_update::setup(app.handle());
            tray::build(app.handle())?;
            if !std::env::args().any(|a| a == "--hidden") {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.show();
                }
            }
            // A SIGTERM or Ctrl-C quits like the menu does, so the children are stopped too.
            #[cfg(unix)]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use tokio::signal::unix::{signal, SignalKind};
                    let (Ok(mut term), Ok(mut int)) = (signal(SignalKind::terminate()), signal(SignalKind::interrupt())) else {
                        return;
                    };
                    tokio::select! { _ = term.recv() => {}, _ = int.recv() => {} }
                    handle.exit(0);
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Jotted")
        .run(|app, event| {
            match event {
                RunEvent::Exit => tauri::async_runtime::block_on(stop_background(app)),
                // The Dock icon, clicked while the window is hidden.
                #[cfg(target_os = "macos")]
                RunEvent::Reopen { .. } => tray::show_main_window(app, None),
                _ => {}
            }
        });
}

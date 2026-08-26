use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::ShellExt;

struct SidecarChild(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

fn port_in_use(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}")
        .parse::<std::net::SocketAddr>()
        .unwrap_or_else(|_| std::net::SocketAddr::from(([127, 0, 0, 1], port)));
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
            let port = std::env::var("OPENHARNESS_PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(8787);

            // In `pnpm dev` the tsx dev server already owns the port; spawning the
            // sidecar then would crash with EADDRINUSE. Skip it and reuse the
            // external server. The sidecar still starts when the port is free
            // (standalone `tauri dev` or packaged builds).
            if port_in_use(&host, port) {
                println!(
                    "[sidecar] {host}:{port} already in use, skipping sidecar (external API server assumed)"
                );
                app.manage(SidecarChild(Mutex::new(None)));
                return Ok(());
            }

            let sidecar = app.shell().sidecar("open-harness-sidecar")?;
            let sidecar = sidecar
                .env("OPENHARNESS_DATA_DIR", &data_dir)
                .env("OPENHARNESS_PORT", port.to_string());

            let (mut rx, child) = sidecar.spawn()?;
            app.manage(SidecarChild(Mutex::new(Some(child))));

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                            println!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                            eprintln!("[sidecar] {}", String::from_utf8_lossy(&line));
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = app_handle
                .state::<SidecarChild>()
                .0
                .lock()
                .ok()
                .and_then(|mut child| child.take())
            {
                let _ = child.kill();
            }
        }
    });
}

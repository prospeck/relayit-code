use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};

use crate::CoreState;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
}

/// In debug builds we run core straight from the TypeScript sources with the developer's Node;
/// release builds ship a bundled `core/main.mjs` and a Node runtime as the `relayit-node` sidecar.
fn command(app: &AppHandle) -> Result<Command, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let mut cmd = if cfg!(debug_assertions) {
        let main = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/core/src/main.ts");
        let mut c = Command::new(std::env::var("RELAYIT_NODE").unwrap_or_else(|_| "node".into()));
        c.arg(main);
        c
    } else {
        let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().unwrap().to_path_buf();
        let node = exe_dir.join(if cfg!(windows) { "relayit-node.exe" } else { "relayit-node" });
        let script = app.path().resource_dir().map_err(|e| e.to_string())?.join("core").join("main.mjs");
        let mut c = Command::new(node);
        c.arg(script);
        c
    };
    cmd.arg("--data-dir").arg(&data_dir).arg("--key-from-stdin");
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    Ok(cmd)
}

pub fn spawn(app: &AppHandle, master_key_b64: &str) -> Result<(), String> {
    let mut child = command(app)?.spawn().map_err(|e| e.to_string())?;
    {
        let stdin = child.stdin.as_mut().ok_or("no stdin")?;
        writeln!(stdin, "RELAYIT_MASTER_KEY={master_key_b64}").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
    }
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(json) = line.strip_prefix("RELAYIT_READY ") {
                if let Ok(ep) = serde_json::from_str::<Endpoint>(json) {
                    *handle.state::<CoreState>().endpoint.lock().unwrap() = Some(ep);
                }
            } else {
                println!("[core] {line}");
            }
        }
        // stdout closed: core exited.
        let state = handle.state::<CoreState>();
        *state.endpoint.lock().unwrap() = None;
        if state.child.lock().unwrap().is_some() {
            *state.error.lock().unwrap() = Some("RelayIt's engine stopped unexpectedly. Please restart the app.".into());
        }
    });
    *app.state::<CoreState>().child.lock().unwrap() = Some(child);
    Ok(())
}

pub fn stop(app: &AppHandle) {
    if let Some(mut child) = app.state::<CoreState>().child.lock().unwrap().take() {
        // Closing stdin asks core to shut down cleanly; kill as a fallback.
        drop(child.stdin.take());
        for _ in 0..20 {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = child.kill();
    }
}

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager, State, Window};

use crate::models::{AppState, ShellCommandResult};
use crate::utils::{expand_tilde_path, generate_id};

#[tauri::command]
pub fn run_command(
    window: Window,
    command: String,
    cwd: String,
    state: State<'_, AppState>,
) -> ShellCommandResult {
    let command_id = generate_id("cmd");
    let run_cwd = if cwd.trim().is_empty() {
        state.config.lock().unwrap().cwd.clone()
    } else {
        cwd
    };
    let run_cwd = expand_tilde_path(&run_cwd);

    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", &command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", &command]);
        c
    };

    cmd.current_dir(run_cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            return ShellCommandResult {
                success: false,
                command_id,
                output: None,
                error_output: None,
                exit_code: Some(-1),
                error: Some(e.to_string()),
            }
        }
    };

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(e) => {
            return ShellCommandResult {
                success: false,
                command_id,
                output: None,
                error_output: None,
                exit_code: Some(-1),
                error: Some(e.to_string()),
            }
        }
    };

    let status = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !stdout.is_empty() {
        let _ = window.emit(
            "command-output",
            serde_json::json!({ "commandId": command_id.clone(), "type": "stdout", "data": stdout.clone() }),
        );
    }
    if !stderr.is_empty() {
        let _ = window.emit(
            "command-output",
            serde_json::json!({ "commandId": command_id.clone(), "type": "stderr", "data": stderr.clone() }),
        );
    }
    ShellCommandResult {
        success: status == 0,
        command_id,
        output: Some(stdout),
        error_output: Some(stderr),
        exit_code: Some(status),
        error: None,
    }
}

#[tauri::command]
pub fn kill_command(_command_id: String) -> serde_json::Value {
    serde_json::json!({ "success": false, "error": "Not supported in current Tauri runtime" })
}

#[tauri::command]
pub fn pty_create(
    window: Window,
    cwd: Option<String>,
    shell: Option<String>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let id = generate_id("pty");
    let shell_path = if let Some(value) = shell {
        value
    } else if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        "bash".to_string()
    };
    let run_cwd = cwd.unwrap_or_else(|| state.config.lock().unwrap().cwd.clone());
    let run_cwd = expand_tilde_path(&run_cwd);

    let mut cmd = Command::new(&shell_path);
    cmd.current_dir(run_cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let child_ref = Arc::new(Mutex::new(child));
    state
        .pty_terminals
        .lock()
        .unwrap()
        .insert(id.clone(), Arc::clone(&child_ref));

    if let Some(mut out) = stdout {
        let out_id = id.clone();
        let out_window = window.clone();
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                match out.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ = out_window.emit(
                            "pty-data",
                            serde_json::json!({ "id": out_id, "data": data }),
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    if let Some(mut err) = stderr {
        let err_id = id.clone();
        let err_window = window.clone();
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                match err.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ = err_window.emit(
                            "pty-data",
                            serde_json::json!({ "id": err_id, "data": data }),
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let app_handle = window.app_handle().clone();
    let monitor_id = id.clone();
    std::thread::spawn(move || loop {
        let mut should_break = false;
        let mut exit_code: Option<i32> = None;

        {
            let state = app_handle.state::<AppState>();
            let maybe_child = state
                .pty_terminals
                .lock()
                .unwrap()
                .get(&monitor_id)
                .cloned();
            match maybe_child {
                Some(child_ref) => {
                    if let Ok(mut child) = child_ref.lock() {
                        if let Ok(Some(status)) = child.try_wait() {
                            exit_code = Some(status.code().unwrap_or(-1));
                        }
                    }
                }
                None => {
                    should_break = true;
                }
            }
        }

        if let Some(code) = exit_code {
            let state = app_handle.state::<AppState>();
            state.pty_terminals.lock().unwrap().remove(&monitor_id);
            let _ = app_handle.emit(
                "pty-exit",
                serde_json::json!({ "id": monitor_id, "exitCode": code }),
            );
            break;
        }

        if should_break {
            break;
        }

        std::thread::sleep(std::time::Duration::from_millis(120));
    });

    Ok(serde_json::json!({ "id": id, "shell": shell_path }))
}

#[tauri::command]
pub fn pty_write(id: String, data: String, state: State<'_, AppState>) -> serde_json::Value {
    let maybe_child = state.pty_terminals.lock().unwrap().get(&id).cloned();
    if let Some(child_ref) = maybe_child {
        if let Ok(mut child) = child_ref.lock() {
            if let Some(stdin) = child.stdin.as_mut() {
                if stdin.write_all(data.as_bytes()).is_ok() {
                    return serde_json::json!({ "success": true });
                }
            }
        }
        return serde_json::json!({ "success": false, "error": "Failed to write to terminal" });
    }
    serde_json::json!({ "success": false, "error": "Terminal not found" })
}

#[tauri::command]
pub fn pty_kill(id: String, state: State<'_, AppState>) -> serde_json::Value {
    let maybe_child = state.pty_terminals.lock().unwrap().remove(&id);
    if let Some(child_ref) = maybe_child {
        if let Ok(mut child) = child_ref.lock() {
            if child.kill().is_ok() {
                return serde_json::json!({ "success": true });
            }
        }
        return serde_json::json!({ "success": false, "error": "Failed to stop terminal" });
    }
    serde_json::json!({ "success": false, "error": "Terminal not found" })
}

#[tauri::command]
pub fn pty_list(state: State<'_, AppState>) -> Vec<String> {
    state
        .pty_terminals
        .lock()
        .unwrap()
        .keys()
        .cloned()
        .collect()
}

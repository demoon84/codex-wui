use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{Emitter, Manager, State, Window};

use crate::models::{
    AppState, CliOptions, CommandResult, ModelInfo, PendingApproval, RunningCodexProcess,
};
use crate::utils::{
    build_codex_exec_args, clean_progress_text, command_for, expand_tilde_path,
    parse_codex_event, StreamParseCache,
};

#[tauri::command]
pub fn set_mode(mode: String, state: State<'_, AppState>) -> String {
    let mut cfg = state.config.lock().unwrap();
    cfg.mode = mode.clone();
    mode
}

#[tauri::command]
pub fn get_mode(state: State<'_, AppState>) -> String {
    state.config.lock().unwrap().mode.clone()
}

#[tauri::command]
pub fn set_yolo_mode(enabled: bool, state: State<'_, AppState>) -> bool {
    let mut cfg = state.config.lock().unwrap();
    cfg.yolo_mode = enabled;
    enabled
}

#[tauri::command]
pub fn get_yolo_mode(state: State<'_, AppState>) -> bool {
    state.config.lock().unwrap().yolo_mode
}

#[tauri::command]
pub fn get_models() -> Vec<ModelInfo> {
    crate::utils::default_models()
}

#[tauri::command]
pub fn get_model(state: State<'_, AppState>) -> String {
    state.config.lock().unwrap().model.clone()
}

#[tauri::command]
pub fn set_model(model_id: String, state: State<'_, AppState>) -> String {
    let mut cfg = state.config.lock().unwrap();
    cfg.model = model_id.clone();
    model_id
}

#[tauri::command]
pub fn set_cli_options(
    options: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<CliOptions, String> {
    let mut cfg = state.config.lock().unwrap();
    let mut merged = cfg.cli_options.clone();

    if let Some(v) = options.get("profile").and_then(|v| v.as_str()) {
        merged.profile = v.to_string();
    }
    if let Some(v) = options.get("sandbox").and_then(|v| v.as_str()) {
        merged.sandbox = v.to_string();
    }
    if let Some(v) = options
        .get("askForApproval")
        .or_else(|| options.get("ask_for_approval"))
        .and_then(|v| v.as_str())
    {
        merged.ask_for_approval = v.to_string();
    }
    if let Some(v) = options.get("skipGitRepoCheck").and_then(|v| v.as_bool()) {
        merged.skip_git_repo_check = v;
    }
    if let Some(v) = options.get("cwdOverride").and_then(|v| v.as_str()) {
        merged.cwd_override = v.to_string();
    }
    if let Some(v) = options.get("extraArgs").and_then(|v| v.as_str()) {
        merged.extra_args = v.to_string();
    }
    if let Some(v) = options.get("enableWebSearch").and_then(|v| v.as_bool()) {
        merged.enable_web_search = v;
    }

    cfg.cli_options = merged.clone();
    Ok(merged)
}

#[tauri::command]
pub fn get_cli_options(state: State<'_, AppState>) -> CliOptions {
    state.config.lock().unwrap().cli_options.clone()
}

#[tauri::command]
pub fn init_acp(window: Window) -> serde_json::Value {
    let _ = window.emit("acp-ready", true);
    serde_json::json!({ "success": true })
}

#[tauri::command]
pub fn switch_workspace(
    workspace_id: String,
    cwd: String,
    state: State<'_, AppState>,
) -> serde_json::Value {
    let mut cfg = state.config.lock().unwrap();
    cfg.cwd = expand_tilde_path(&cwd);
    serde_json::json!({ "success": true, "sessionId": workspace_id })
}

#[tauri::command]
pub fn debug_log(msg: String) {
    eprintln!("[FRONTEND] {}", msg);
}

#[tauri::command]
pub fn check_codex() -> serde_json::Value {
    let installed = command_for("codex")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    serde_json::json!({ "installed": installed })
}

#[tauri::command]
pub fn install_codex(window: Window) -> serde_json::Value {
    let _ = window.emit(
        "codex-install-progress",
        serde_json::json!({
            "status": "installing", "message": "Installing Codex CLI...", "percent": 0
        }),
    );

    let result = command_for("npm")
        .arg("install")
        .arg("-g")
        .arg("@openai/codex")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    match result {
        Ok(mut child) => {
            let stderr = child.stderr.take();
            let stdout = child.stdout.take();

            // Stream stderr (npm progress goes here)
            let win_err = window.clone();
            let stderr_thread = std::thread::spawn(move || {
                if let Some(err) = stderr {
                    let reader = BufReader::new(err);
                    let mut line_count = 0;
                    for line in reader.lines().map_while(Result::ok) {
                        if line.trim().is_empty() {
                            continue;
                        }
                        line_count += 1;
                        // npm install typically outputs 5-20 lines; map to 10-80%
                        let percent = std::cmp::min(10 + line_count * 5, 80);
                        let _ = win_err.emit(
                            "codex-install-progress",
                            serde_json::json!({
                                "status": "installing",
                                "message": line.trim(),
                                "percent": percent
                            }),
                        );
                    }
                }
            });

            // Stream stdout
            let win_out = window.clone();
            let stdout_thread = std::thread::spawn(move || {
                if let Some(out) = stdout {
                    let reader = BufReader::new(out);
                    for line in reader.lines().map_while(Result::ok) {
                        if line.trim().is_empty() {
                            continue;
                        }
                        let _ = win_out.emit(
                            "codex-install-progress",
                            serde_json::json!({
                                "status": "installing",
                                "message": line.trim(),
                                "percent": 85
                            }),
                        );
                    }
                }
            });

            let _ = stderr_thread.join();
            let _ = stdout_thread.join();

            // Wait for process to finish
            match child.wait() {
                Ok(exit_status) if exit_status.success() => {
                    let _ = window.emit("codex-install-progress", serde_json::json!({
                        "status": "complete", "message": "Codex CLI installed successfully", "percent": 100
                    }));
                    serde_json::json!({ "success": true })
                }
                Ok(exit_status) => {
                    let msg = format!("Install failed: exit {}", exit_status.code().unwrap_or(-1));
                    let _ = window.emit(
                        "codex-install-progress",
                        serde_json::json!({
                            "status": "error", "message": msg, "percent": 0
                        }),
                    );
                    serde_json::json!({ "success": false, "error": "Installation failed" })
                }
                Err(e) => {
                    let _ = window.emit(
                        "codex-install-progress",
                        serde_json::json!({
                            "status": "error", "message": e.to_string(), "percent": 0
                        }),
                    );
                    serde_json::json!({ "success": false, "error": e.to_string() })
                }
            }
        }
        Err(e) => {
            let msg = if e.kind() == std::io::ErrorKind::NotFound {
                "npm executable was not found. Please install Node.js and make sure npm is available in PATH.".to_string()
            } else {
                e.to_string()
            };
            let _ = window.emit(
                "codex-install-progress",
                serde_json::json!({
                    "status": "error", "message": msg, "percent": 0
                }),
            );
            serde_json::json!({ "success": false, "error": msg })
        }
    }
}

#[tauri::command]
pub fn open_workspace() -> Option<serde_json::Value> {
    let picked = rfd::FileDialog::new().pick_folder()?;
    let folder_path = picked.to_string_lossy().to_string();
    let folder_name = picked.file_name()?.to_string_lossy().to_string();
    Some(serde_json::json!({ "path": folder_path, "name": folder_name }))
}

#[tauri::command]
pub fn cancel_prompt(
    window: Window,
    conversation_id: String,
    state: State<'_, AppState>,
) -> serde_json::Value {
    let mut had_process = false;
    {
        let mut guard = state.running_codex.lock().unwrap();
        if let Some(mut process) = guard.remove(&conversation_id) {
            had_process = true;
            let _ = process.child.kill();
        }
    }
    state
        .pending_approvals
        .lock()
        .unwrap()
        .retain(|_, pending| pending.conversation_id != conversation_id);
    if had_process {
        let _ = window.emit(
            "codex-stream-end",
            serde_json::json!({ "cid": conversation_id, "cancelled": true }),
        );
    }
    serde_json::json!({ "success": true })
}

#[tauri::command]
pub fn stream_codex(
    window: Window,
    conversation_id: String,
    prompt: String,
    conversation_history: Option<Vec<HashMap<String, String>>>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Kill existing process for this conversation only
    {
        let mut guard = state.running_codex.lock().unwrap();
        if let Some(mut existing) = guard.remove(&conversation_id) {
            let _ = existing.child.kill();
        }
    }
    state
        .pending_approvals
        .lock()
        .unwrap()
        .retain(|_, pending| pending.conversation_id != conversation_id);

    let cfg = state.config.lock().unwrap().clone();
    let (_full_prompt, run_cwd, args) = build_codex_exec_args(&prompt, &cfg, conversation_history);

    let mut cmd = command_for("codex");
    cmd.args(&args)
        .current_dir(run_cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let stdin = child.stdin.take().map(|s| Arc::new(Mutex::new(s)));

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut guard = state.running_codex.lock().unwrap();
        guard.insert(
            conversation_id.clone(),
            RunningCodexProcess { child, stdin },
        );
    }

    let cid_out = conversation_id.clone();
    let cid_err = conversation_id.clone();
    let cid_wait = conversation_id.clone();
    let window_out = window.clone();
    let window_err = window.clone();
    let app_out = window.app_handle().clone();

    std::thread::spawn(move || {
        let mut cache = StreamParseCache::new();
        if let Some(out) = stdout {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if let Some(approval) =
                        parse_codex_event(&window_out, &cid_out, &value, &mut cache)
                    {
                        let state = app_out.state::<AppState>();
                        state.pending_approvals.lock().unwrap().insert(
                            approval.request_id.clone(),
                            PendingApproval {
                                conversation_id: cid_out.clone(),
                            },
                        );
                    }
                } else {
                    let _ = window_out.emit(
                        "codex-stream-token",
                        serde_json::json!({"cid": &cid_out, "data": line}),
                    );
                }
            }
        }
    });

    std::thread::spawn(move || {
        if let Some(err) = stderr {
            let reader = BufReader::new(err);
            for line in reader.lines().map_while(Result::ok) {
                let cleaned = clean_progress_text(&line);
                if !cleaned.is_empty() {
                    let _ = window_err.emit(
                        "codex-progress",
                        serde_json::json!({"cid": &cid_err, "data": cleaned}),
                    );
                }
            }
        }
    });

    let app_handle = window.app_handle().clone();
    std::thread::spawn(move || {
        loop {
            let mut done = false;
            let mut exit_code = 0;
            let mut should_cleanup_approvals = false;
            {
                let state = app_handle.state::<AppState>();
                let mut guard = state.running_codex.lock().unwrap();
                if let Some(process) = guard.get_mut(&cid_wait) {
                    if let Ok(Some(status)) = process.child.try_wait() {
                        done = true;
                        exit_code = status.code().unwrap_or(-1);
                    }
                } else {
                    break; // Process was removed (cancelled)
                }

                if done {
                    guard.remove(&cid_wait);
                    should_cleanup_approvals = true;
                }
            }

            if should_cleanup_approvals {
                let state = app_handle.state::<AppState>();
                state
                    .pending_approvals
                    .lock()
                    .unwrap()
                    .retain(|_, pending| pending.conversation_id != cid_wait);
            }

            if done {
                if exit_code == 0 {
                    let _ =
                        app_handle.emit("codex-stream-end", serde_json::json!({"cid": &cid_wait}));
                } else {
                    let _ = app_handle.emit("codex-stream-error", serde_json::json!({"cid": &cid_wait, "data": format!("Codex exited with code {}", exit_code)}));
                }
                break;
            }

            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });

    Ok(())
}

#[tauri::command]
pub fn run_codex_command(
    subcommand: String,
    args: Vec<String>,
    cwd: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult {
    let run_cwd = cwd.unwrap_or_else(|| state.config.lock().unwrap().cwd.clone());
    let run_cwd = expand_tilde_path(&run_cwd);

    match command_for("codex")
        .arg(subcommand)
        .args(args)
        .current_dir(run_cwd)
        .output()
    {
        Ok(out) => CommandResult {
            success: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
            exit_code: out.status.code().unwrap_or(-1),
            error: None,
        },
        Err(e) => CommandResult {
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: -1,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn update_title_bar_overlay(_color: String, _symbol_color: String) -> serde_json::Value {
    serde_json::json!({ "success": true })
}

#[tauri::command]
pub fn respond_to_approval(
    request_id: String,
    approved: bool,
    state: State<'_, AppState>,
) -> serde_json::Value {
    let pending = state.pending_approvals.lock().unwrap().remove(&request_id);
    let Some(pending) = pending else {
        return serde_json::json!({ "success": false, "error": "Approval request not found" });
    };

    let mut guard = state.running_codex.lock().unwrap();
    let Some(process) = guard.get_mut(&pending.conversation_id) else {
        return serde_json::json!({ "success": false, "error": "Conversation process not running" });
    };

    let Some(stdin) = process.stdin.clone() else {
        return serde_json::json!({ "success": false, "error": "Process stdin is not available" });
    };

    let payload = serde_json::json!({
        "request_id": request_id,
        "approved": approved
    })
    .to_string();

    let response = match stdin.lock() {
        Ok(mut handle) => {
            if let Err(error) = handle.write_all(payload.as_bytes()) {
                return serde_json::json!({ "success": false, "error": error.to_string() });
            }
            if let Err(error) = handle.write_all(b"\n") {
                return serde_json::json!({ "success": false, "error": error.to_string() });
            }
            serde_json::json!({ "success": true })
        }
        Err(error) => serde_json::json!({ "success": false, "error": error.to_string() }),
    };

    response
}

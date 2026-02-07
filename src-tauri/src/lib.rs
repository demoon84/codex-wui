use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State, Window};
use base64::Engine as _;

#[derive(Clone, Serialize, Deserialize)]
struct ModelInfo {
    id: String,
    name: String,
    description: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliOptions {
    profile: String,
    sandbox: String,
    ask_for_approval: String,
    skip_git_repo_check: bool,
    cwd_override: String,
    extra_args: String,
    enable_web_search: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    thinking: Option<String>,
    thinking_duration: Option<i64>,
    timestamp: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Conversation {
    id: String,
    workspace_id: String,
    title: String,
    created_at: String,
    updated_at: String,
    messages: Vec<Message>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Workspace {
    id: String,
    name: String,
    path: String,
    conversations: Vec<Conversation>,
}

#[derive(Clone, Serialize, Deserialize)]
struct DbState {
    workspaces: Vec<Workspace>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileSearchResult {
    name: String,
    path: String,
    relative_path: String,
    is_directory: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryEntry {
    name: String,
    path: String,
    is_directory: bool,
    size: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct SearchResult {
    title: String,
    url: String,
    snippet: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct CodexUser {
    id: String,
    email: String,
    name: String,
    picture: String,
    auth_mode: String,
    auth_provider: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommandResult {
    success: bool,
    stdout: String,
    stderr: String,
    exit_code: i32,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellCommandResult {
    success: bool,
    command_id: String,
    output: Option<String>,
    error_output: Option<String>,
    exit_code: Option<i32>,
    error: Option<String>,
}

#[derive(Clone)]
struct RuntimeConfig {
    mode: String,
    yolo_mode: bool,
    model: String,
    cwd: String,
    cli_options: CliOptions,
}

struct AppState {
    config: Mutex<RuntimeConfig>,
    db: Mutex<DbState>,
    running_codex: Mutex<Option<Child>>,
    pty_terminals: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
}

fn now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

fn generate_id(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}_{}_{}", prefix, millis, seq)
}

fn is_command_available(bin: &str) -> bool {
    let locator = if cfg!(target_os = "windows") { "where" } else { "which" };
    Command::new(locator)
        .arg(bin)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn command_for(bin: &str) -> Command {
    if cfg!(target_os = "windows") {
        let cmd = format!("{bin}.cmd");
        if is_command_available(&cmd) {
            return Command::new(cmd);
        }

        let exe = format!("{bin}.exe");
        if is_command_available(&exe) {
            return Command::new(exe);
        }
    }

    Command::new(bin)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}

fn codex_auth_path() -> Option<PathBuf> {
    let Some(home) = home_dir() else {
        return None;
    };
    Some(home.join(".codex").join("auth.json"))
}

fn parse_jwt_payload(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(payload))
        .ok()?;
    serde_json::from_slice::<Value>(&decoded).ok()
}

fn parse_codex_user(auth: &Value) -> Option<CodexUser> {
    let auth_mode = auth
        .get("auth_mode")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    let account_id = auth
        .get("tokens")
        .and_then(|v| v.get("account_id"))
        .and_then(Value::as_str)
        .unwrap_or("codex-user")
        .to_string();

    let mut email = String::new();
    let mut auth_provider = String::new();

    if let Some(id_token) = auth
        .get("tokens")
        .and_then(|v| v.get("id_token"))
        .and_then(Value::as_str)
    {
        if let Some(payload) = parse_jwt_payload(id_token) {
            email = payload
                .get("email")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            auth_provider = payload
                .get("auth_provider")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
        }
    }

    if auth_mode == "api_key" {
        auth_provider = "api_key".to_string();
    }

    let name = if !email.is_empty() {
        email.split('@').next().unwrap_or("codex-user").to_string()
    } else {
        format!("codex-{}", auth_mode)
    };

    Some(CodexUser {
        id: account_id,
        email,
        name,
        picture: String::new(),
        auth_mode,
        auth_provider,
    })
}

fn check_cached_credentials() -> Option<CodexUser> {
    let auth_path = codex_auth_path()?;
    if !auth_path.exists() {
        return None;
    }

    let content = fs::read_to_string(auth_path).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    parse_codex_user(&value)
}

fn default_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo { id: "codex".into(), name: "GPT-5.3-Codex".into(), description: "Most capable coding model".into() },
        ModelInfo { id: "o3".into(), name: "O3".into(), description: "Advanced reasoning model".into() },
        ModelInfo { id: "o4-mini".into(), name: "O4.1-mini".into(), description: "Fast and efficient".into() },
        ModelInfo { id: "gpt-4.1".into(), name: "GPT-4.1".into(), description: "General purpose model".into() },
    ]
}

fn parse_extra_args(raw: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for ch in raw.chars() {
        match quote {
            Some(q) => {
                if ch == q {
                    quote = None;
                } else {
                    current.push(ch);
                }
            }
            None => {
                if ch == '"' || ch == '\'' {
                    quote = Some(ch);
                } else if ch.is_whitespace() {
                    if !current.is_empty() {
                        args.push(current.clone());
                        current.clear();
                    }
                } else {
                    current.push(ch);
                }
            }
        }
    }

    if !current.is_empty() {
        args.push(current);
    }

    args
}

fn clean_progress_text(input: &str) -> String {
    let ansi_re = Regex::new(r"\x1B\[[0-9;]*[a-zA-Z]").unwrap();
    let stripped = ansi_re.replace_all(input, "");
    stripped
        .replace('\r', "\n")
        .split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_codex_event(window: &Window, event: &Value) {
    let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or_default();

    match event_type {
        "item.streaming" => {
            if let Some(item) = event.get("item") {
                let delta = item
                    .get("delta")
                    .and_then(|d| d.get("text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if !delta.is_empty() {
                    let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or_default();
                    if item_type == "reasoning" {
                        let _ = window.emit("codex-thinking-delta", delta.to_string());
                    } else {
                        let _ = window.emit("codex-stream-delta", delta.to_string());
                    }
                }
            }
        }
        "item.completed" => {
            if let Some(item) = event.get("item") {
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or_default();
                if item_type == "reasoning" || item_type == "agent_message" || item_type == "message" {
                    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                        let _ = window.emit("codex-stream-token", text.to_string());
                    }
                } else if item_type == "tool_call" {
                    let title = item.get("name").and_then(|v| v.as_str()).unwrap_or("Tool").to_string();
                    let output = item.get("output").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    let payload = serde_json::json!({
                        "title": title,
                        "status": "done",
                        "output": output,
                    });
                    let _ = window.emit("codex-tool-call", payload);
                }
            }
        }
        "error" => {
            let msg = event
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error")
                .to_string();
            let _ = window.emit("codex-stream-error", msg);
        }
        _ => {}
    }
}

fn build_codex_exec_args(prompt: &str, cfg: &RuntimeConfig, history: Option<Vec<HashMap<String, String>>>) -> (String, String, Vec<String>) {
    let mut full_prompt = prompt.to_string();
    if let Some(hist) = history {
        if !hist.is_empty() {
            let mut lines = Vec::new();
            for msg in hist.into_iter().rev().take(10).collect::<Vec<_>>().into_iter().rev() {
                let role = msg.get("role").cloned().unwrap_or_else(|| "user".into());
                let content = msg.get("content").cloned().unwrap_or_default();
                let prefix = if role == "assistant" { "Assistant" } else { "User" };
                lines.push(format!("{}: {}", prefix, content));
            }
            full_prompt = format!("[Previous conversation]\n{}\n\n[Current question]\n{}", lines.join("\n"), prompt);
        }
    }

    let run_cwd = if cfg.cli_options.cwd_override.trim().is_empty() {
        cfg.cwd.clone()
    } else {
        cfg.cli_options.cwd_override.clone()
    };

    let mut args: Vec<String> = vec!["exec".into(), "--json".into()];

    if !cfg.model.is_empty() {
        args.push("-m".into());
        args.push(cfg.model.clone());
    }

    if !cfg.cli_options.profile.trim().is_empty() {
        args.push("-p".into());
        args.push(cfg.cli_options.profile.trim().to_string());
    }

    if cfg.yolo_mode {
        args.push("--dangerously-bypass-approvals-and-sandbox".into());
    } else {
        args.push("-s".into());
        args.push(cfg.cli_options.sandbox.clone());
        args.push("-a".into());
        args.push(cfg.cli_options.ask_for_approval.clone());
    }

    if cfg.cli_options.enable_web_search {
        args.push("--search".into());
    }

    args.push("-C".into());
    args.push(run_cwd.clone());

    if cfg.cli_options.skip_git_repo_check {
        args.push("--skip-git-repo-check".into());
    }

    args.extend(parse_extra_args(&cfg.cli_options.extra_args));
    args.push("-".into());

    (full_prompt, run_cwd, args)
}

#[tauri::command]
fn set_mode(mode: String, state: State<'_, AppState>) -> String {
    let mut cfg = state.config.lock().unwrap();
    cfg.mode = mode.clone();
    mode
}

#[tauri::command]
fn get_mode(state: State<'_, AppState>) -> String {
    state.config.lock().unwrap().mode.clone()
}

#[tauri::command]
fn set_yolo_mode(enabled: bool, state: State<'_, AppState>) -> bool {
    let mut cfg = state.config.lock().unwrap();
    cfg.yolo_mode = enabled;
    enabled
}

#[tauri::command]
fn get_yolo_mode(state: State<'_, AppState>) -> bool {
    state.config.lock().unwrap().yolo_mode
}

#[tauri::command]
fn get_models() -> Vec<ModelInfo> {
    default_models()
}

#[tauri::command]
fn get_model(state: State<'_, AppState>) -> String {
    state.config.lock().unwrap().model.clone()
}

#[tauri::command]
fn set_model(model_id: String, state: State<'_, AppState>) -> String {
    let mut cfg = state.config.lock().unwrap();
    cfg.model = model_id.clone();
    model_id
}

#[tauri::command]
fn set_cli_options(options: serde_json::Value, state: State<'_, AppState>) -> Result<CliOptions, String> {
    let mut cfg = state.config.lock().unwrap();
    let mut merged = cfg.cli_options.clone();

    if let Some(v) = options.get("profile").and_then(|v| v.as_str()) {
        merged.profile = v.to_string();
    }
    if let Some(v) = options.get("sandbox").and_then(|v| v.as_str()) {
        merged.sandbox = v.to_string();
    }
    if let Some(v) = options.get("askForApproval").and_then(|v| v.as_str()) {
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
fn get_cli_options(state: State<'_, AppState>) -> CliOptions {
    state.config.lock().unwrap().cli_options.clone()
}

#[tauri::command]
fn init_acp(window: Window) -> serde_json::Value {
    let _ = window.emit("acp-ready", true);
    serde_json::json!({ "success": true })
}

#[tauri::command]
fn switch_workspace(workspace_id: String, cwd: String, state: State<'_, AppState>) -> serde_json::Value {
    let mut cfg = state.config.lock().unwrap();
    cfg.cwd = cwd;
    serde_json::json!({ "success": true, "sessionId": workspace_id })
}

#[tauri::command]
fn check_codex() -> serde_json::Value {
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
fn install_codex(window: Window) -> serde_json::Value {
    let _ = window.emit("codex-install-progress", serde_json::json!({ "status": "installing", "message": "Installing Codex CLI..." }));
    let status = command_for("npm")
        .arg("install")
        .arg("-g")
        .arg("@openai/codex")
        .status();

    match status {
        Ok(s) if s.success() => {
            let _ = window.emit("codex-install-progress", serde_json::json!({ "status": "complete", "message": "Codex CLI installed" }));
            serde_json::json!({ "success": true })
        }
        Ok(s) => {
            let msg = format!("Install failed: exit {}", s.code().unwrap_or(-1));
            let _ = window.emit("codex-install-progress", serde_json::json!({ "status": "error", "message": msg }));
            serde_json::json!({ "success": false, "error": "Installation failed" })
        }
        Err(e) => {
            let msg = if e.kind() == std::io::ErrorKind::NotFound {
                "npm executable was not found. Please install Node.js and make sure npm is available in PATH.".to_string()
            } else {
                e.to_string()
            };
            let _ = window.emit("codex-install-progress", serde_json::json!({ "status": "error", "message": msg }));
            serde_json::json!({ "success": false, "error": msg })
        }
    }
}

#[tauri::command]
fn open_workspace() -> Option<serde_json::Value> {
    let picked = rfd::FileDialog::new().pick_folder()?;
    let folder_path = picked.to_string_lossy().to_string();
    let folder_name = picked.file_name()?.to_string_lossy().to_string();
    Some(serde_json::json!({ "path": folder_path, "name": folder_name }))
}

#[tauri::command]
fn cancel_prompt(state: State<'_, AppState>) -> serde_json::Value {
    if let Some(mut child) = state.running_codex.lock().unwrap().take() {
        let _ = child.kill();
    }
    serde_json::json!({ "success": true })
}

#[tauri::command]
fn stream_codex(
    window: Window,
    prompt: String,
    conversation_history: Option<Vec<HashMap<String, String>>>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(mut existing) = state.running_codex.lock().unwrap().take() {
        let _ = existing.kill();
    }

    let cfg = state.config.lock().unwrap().clone();
    let (full_prompt, run_cwd, args) = build_codex_exec_args(&prompt, &cfg, conversation_history);

    let mut cmd = command_for("codex");
    cmd.args(&args)
        .current_dir(run_cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(full_prompt.as_bytes());
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut guard = state.running_codex.lock().unwrap();
        *guard = Some(child);
    }

    let window_out = window.clone();
    let window_err = window.clone();

    std::thread::spawn(move || {
        if let Some(out) = stdout {
            let reader = BufReader::new(out);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    parse_codex_event(&window_out, &value);
                } else {
                    let _ = window_out.emit("codex-stream-token", line);
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
                    let _ = window_err.emit("codex-progress", cleaned);
                }
            }
        }
    });

    let app_handle = window.app_handle().clone();
    std::thread::spawn(move || {
        loop {
            let mut done = false;
            let mut exit_code = 0;
            {
                let state = app_handle.state::<AppState>();
                let mut guard = state.running_codex.lock().unwrap();
                if let Some(child) = guard.as_mut() {
                    if let Ok(Some(status)) = child.try_wait() {
                        done = true;
                        exit_code = status.code().unwrap_or(-1);
                    }
                } else {
                    break;
                }

                if done {
                    guard.take();
                }
            }

            if done {
                if exit_code == 0 {
                    let _ = app_handle.emit("codex-stream-end", serde_json::json!({}));
                } else {
                    let _ = app_handle.emit("codex-stream-error", format!("Codex exited with code {}", exit_code));
                }
                break;
            }

            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });

    Ok(())
}

#[tauri::command]
fn run_codex_command(subcommand: String, args: Vec<String>, cwd: Option<String>, state: State<'_, AppState>) -> CommandResult {
    let run_cwd = cwd.unwrap_or_else(|| state.config.lock().unwrap().cwd.clone());

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
fn update_title_bar_overlay(_color: String, _symbol_color: String) -> serde_json::Value {
    serde_json::json!({ "success": true })
}

#[tauri::command]
fn respond_to_approval(_request_id: String, _approved: bool) -> serde_json::Value {
    serde_json::json!({ "success": true })
}

#[tauri::command]
fn run_command(window: Window, command: String, cwd: String, state: State<'_, AppState>) -> ShellCommandResult {
    let command_id = generate_id("cmd");
    let run_cwd = if cwd.trim().is_empty() {
        state.config.lock().unwrap().cwd.clone()
    } else {
        cwd
    };

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
fn kill_command(_command_id: String) -> serde_json::Value {
    serde_json::json!({ "success": false, "error": "Not supported in current Tauri runtime" })
}

#[tauri::command]
fn pty_create(
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
            let maybe_child = state.pty_terminals.lock().unwrap().get(&monitor_id).cloned();
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
fn pty_write(id: String, data: String, state: State<'_, AppState>) -> serde_json::Value {
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
fn pty_kill(id: String, state: State<'_, AppState>) -> serde_json::Value {
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
fn pty_list(state: State<'_, AppState>) -> Vec<String> {
    state
        .pty_terminals
        .lock()
        .unwrap()
        .keys()
        .cloned()
        .collect()
}

#[tauri::command]
fn codex_login(method: Option<String>, api_key: Option<String>) -> serde_json::Value {
    if let Some(user) = check_cached_credentials() {
        return serde_json::json!({ "success": true, "user": user });
    }

    let chosen = method.unwrap_or_else(|| "browser".to_string());
    let normalized = chosen.to_lowercase();

    if normalized == "api-key" {
        let Some(key) = api_key else {
            return serde_json::json!({ "success": false, "error": "API key is required for api-key login." });
        };

        let mut child = match command_for("codex")
            .arg("login")
            .arg("--with-api-key")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
        };

        if let Some(stdin) = child.stdin.as_mut() {
            if let Err(e) = stdin.write_all(format!("{}\n", key.trim()).as_bytes()) {
                return serde_json::json!({ "success": false, "error": e.to_string() });
            }
        }

        match child.wait_with_output() {
            Ok(output) if output.status.success() => {
                let user = check_cached_credentials();
                serde_json::json!({ "success": true, "user": user, "method": "api-key" })
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                serde_json::json!({ "success": false, "error": stderr })
            }
            Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
        }
    } else {
        let mut cmd = command_for("codex");
        cmd.arg("login");
        if normalized == "device-auth" {
            cmd.arg("--device-auth");
        }

        match cmd.status() {
            Ok(status) if status.success() => {
                let user = check_cached_credentials();
                serde_json::json!({ "success": true, "user": user, "method": normalized })
            }
            Ok(status) => serde_json::json!({
                "success": false,
                "error": format!("codex login failed with exit code {}", status.code().unwrap_or(-1))
            }),
            Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
        }
    }
}

#[tauri::command]
fn codex_logout() -> serde_json::Value {
    let status = command_for("codex")
        .arg("logout")
        .status();

    match status {
        Ok(s) if s.success() => serde_json::json!({ "success": true }),
        Ok(s) => serde_json::json!({
            "success": false,
            "error": format!("codex logout failed with exit code {}", s.code().unwrap_or(-1))
        }),
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn get_user() -> Option<CodexUser> {
    check_cached_credentials()
}

#[tauri::command]
fn codex_login_methods() -> serde_json::Value {
    serde_json::json!({
        "methods": [
            { "id": "browser", "label": "Browser OAuth" },
            { "id": "device-auth", "label": "Device Auth" },
            { "id": "api-key", "label": "API Key" }
        ]
    })
}

fn walk_files(dir: &Path, base: &Path, depth: usize, max_depth: usize, out: &mut Vec<FileSearchResult>) {
    if depth > max_depth {
        return;
    }

    let ignore_dirs = ["node_modules", ".git", "dist", "dist-electron", ".next", ".vite", "coverage", "__pycache__", ".cache"];

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let rel = path.strip_prefix(base).unwrap_or(&path).to_string_lossy().to_string();
            if path.is_dir() {
                if ignore_dirs.contains(&name.as_str()) || name.starts_with('.') {
                    continue;
                }
                out.push(FileSearchResult {
                    name: name.clone(),
                    path: path.to_string_lossy().to_string(),
                    relative_path: rel,
                    is_directory: true,
                });
                walk_files(&path, base, depth + 1, max_depth, out);
            } else {
                out.push(FileSearchResult {
                    name,
                    path: path.to_string_lossy().to_string(),
                    relative_path: rel,
                    is_directory: false,
                });
            }
        }
    }
}

#[tauri::command]
fn search_files(workspace_path: String, query: String) -> Vec<FileSearchResult> {
    let base = PathBuf::from(&workspace_path);
    let mut all_files = Vec::new();
    walk_files(&base, &base, 0, 4, &mut all_files);

    let q = query.to_lowercase();
    let mut filtered: Vec<FileSearchResult> = all_files
        .into_iter()
        .filter(|f| {
            f.relative_path.to_lowercase().contains(&q) || f.name.to_lowercase().contains(&q)
        })
        .collect();

    filtered.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            return b.is_directory.cmp(&a.is_directory);
        }
        let a_exact = a.name.to_lowercase() == q;
        let b_exact = b.name.to_lowercase() == q;
        if a_exact != b_exact {
            return b_exact.cmp(&a_exact);
        }
        a.relative_path.len().cmp(&b.relative_path.len())
    });

    filtered.into_iter().take(20).collect()
}

#[tauri::command]
fn read_file_content(file_path: String) -> serde_json::Value {
    match fs::read_to_string(&file_path) {
        Ok(content) => serde_json::json!({ "success": true, "content": content }),
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn write_file(file_path: String, content: String) -> serde_json::Value {
    match fs::write(&file_path, content) {
        Ok(_) => serde_json::json!({ "success": true }),
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn list_directory(dir_path: String) -> serde_json::Value {
    match fs::read_dir(&dir_path) {
        Ok(entries) => {
            let mut result = Vec::new();
            for entry in entries.flatten() {
                let path = entry.path();
                let metadata = fs::metadata(&path).ok();
                result.push(DirectoryEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                    is_directory: path.is_dir(),
                    size: metadata.map(|m| m.len()).unwrap_or(0),
                });
            }
            serde_json::json!({ "success": true, "entries": result })
        }
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn file_exists(file_path: String) -> bool {
    Path::new(&file_path).exists()
}

#[tauri::command]
async fn web_search(query: String) -> serde_json::Value {
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1",
        urlencoding::encode(&query)
    );

    match reqwest::get(url).await {
        Ok(res) => match res.json::<Value>().await {
            Ok(data) => {
                let mut results: Vec<SearchResult> = Vec::new();
                if let Some(abs) = data.get("Abstract").and_then(|v| v.as_str()) {
                    if !abs.is_empty() {
                        results.push(SearchResult {
                            title: data.get("Heading").and_then(|v| v.as_str()).unwrap_or(&query).to_string(),
                            url: data.get("AbstractURL").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            snippet: abs.to_string(),
                        });
                    }
                }
                if let Some(topics) = data.get("RelatedTopics").and_then(|v| v.as_array()) {
                    for topic in topics.iter().take(5) {
                        if let (Some(text), Some(url)) = (
                            topic.get("Text").and_then(|v| v.as_str()),
                            topic.get("FirstURL").and_then(|v| v.as_str()),
                        ) {
                            results.push(SearchResult {
                                title: text.split(" - ").next().unwrap_or(text).to_string(),
                                url: url.to_string(),
                                snippet: text.to_string(),
                            });
                        }
                    }
                }
                serde_json::json!({ "success": true, "results": results })
            }
            Err(e) => serde_json::json!({ "success": false, "error": e.to_string(), "results": [] }),
        },
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string(), "results": [] }),
    }
}

#[tauri::command]
fn db_get_state(state: State<'_, AppState>) -> DbState {
    state.db.lock().unwrap().clone()
}

#[tauri::command]
fn db_create_workspace(id: String, name: String, workspace_path: String, state: State<'_, AppState>) -> Workspace {
    let workspace = Workspace {
        id,
        name,
        path: workspace_path,
        conversations: Vec::new(),
    };
    state.db.lock().unwrap().workspaces.push(workspace.clone());
    workspace
}

#[tauri::command]
fn db_delete_workspace(id: String, state: State<'_, AppState>) -> serde_json::Value {
    let mut db = state.db.lock().unwrap();
    db.workspaces.retain(|w| w.id != id);
    serde_json::json!({ "success": true })
}

#[tauri::command]
fn db_get_conversations(workspace_id: String, state: State<'_, AppState>) -> Vec<Conversation> {
    state
        .db
        .lock()
        .unwrap()
        .workspaces
        .iter()
        .find(|w| w.id == workspace_id)
        .map(|w| w.conversations.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn db_create_conversation(id: String, workspace_id: String, title: String, state: State<'_, AppState>) -> Result<Conversation, String> {
    let mut db = state.db.lock().unwrap();
    let workspace = db.workspaces.iter_mut().find(|w| w.id == workspace_id).ok_or("Workspace not found")?;
    let now = now_iso();
    let conversation = Conversation {
        id,
        workspace_id,
        title,
        created_at: now.clone(),
        updated_at: now,
        messages: Vec::new(),
    };
    workspace.conversations.push(conversation.clone());
    Ok(conversation)
}

#[tauri::command]
fn db_update_conversation_title(id: String, title: String, state: State<'_, AppState>) -> serde_json::Value {
    let mut db = state.db.lock().unwrap();
    for ws in &mut db.workspaces {
        if let Some(conv) = ws.conversations.iter_mut().find(|c| c.id == id) {
            conv.title = title.clone();
            conv.updated_at = now_iso();
            break;
        }
    }
    serde_json::json!({ "success": true })
}

#[tauri::command]
fn db_delete_conversation(id: String, state: State<'_, AppState>) -> serde_json::Value {
    let mut db = state.db.lock().unwrap();
    for ws in &mut db.workspaces {
        ws.conversations.retain(|c| c.id != id);
    }
    serde_json::json!({ "success": true })
}

#[tauri::command]
fn db_get_messages(conversation_id: String, state: State<'_, AppState>) -> Vec<Message> {
    for ws in &state.db.lock().unwrap().workspaces {
        if let Some(conv) = ws.conversations.iter().find(|c| c.id == conversation_id) {
            return conv.messages.clone();
        }
    }
    Vec::new()
}

#[tauri::command]
fn db_create_message(message: Message, state: State<'_, AppState>) -> Result<Message, String> {
    let mut db = state.db.lock().unwrap();
    for ws in &mut db.workspaces {
        if let Some(conv) = ws.conversations.iter_mut().find(|c| c.id == message.conversation_id) {
            conv.messages.push(message.clone());
            conv.updated_at = now_iso();
            return Ok(message);
        }
    }
    Err("Conversation not found".into())
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            config: Mutex::new(RuntimeConfig {
                mode: "fast".into(),
                yolo_mode: true,
                model: String::new(),
                cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).to_string_lossy().to_string(),
                cli_options: CliOptions {
                    profile: String::new(),
                    sandbox: "workspace-write".into(),
                    ask_for_approval: "on-request".into(),
                    skip_git_repo_check: true,
                    cwd_override: String::new(),
                    extra_args: String::new(),
                    enable_web_search: false,
                },
            }),
            db: Mutex::new(DbState { workspaces: Vec::new() }),
            running_codex: Mutex::new(None),
            pty_terminals: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            set_mode,
            get_mode,
            set_yolo_mode,
            get_yolo_mode,
            get_models,
            get_model,
            set_model,
            set_cli_options,
            get_cli_options,
            init_acp,
            switch_workspace,
            check_codex,
            install_codex,
            open_workspace,
            cancel_prompt,
            stream_codex,
            run_codex_command,
            update_title_bar_overlay,
            respond_to_approval,
            run_command,
            kill_command,
            pty_create,
            pty_write,
            pty_kill,
            pty_list,
            codex_login,
            codex_logout,
            codex_login_methods,
            get_user,
            search_files,
            read_file_content,
            write_file,
            list_directory,
            file_exists,
            web_search,
            db_get_state,
            db_create_workspace,
            db_delete_workspace,
            db_get_conversations,
            db_create_conversation,
            db_update_conversation_title,
            db_delete_conversation,
            db_get_messages,
            db_create_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use regex::Regex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", now)
}

pub fn generate_id(prefix: &str) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}_{}_{}", prefix, millis, seq)
}

pub fn is_command_available(bin: &str) -> bool {
    let locator = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    Command::new(locator)
        .arg(bin)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn command_for(bin: &str) -> Command {
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

    let mut cmd = Command::new(bin);

    // Enrich PATH for macOS packaged apps which only inherit a minimal PATH
    if cfg!(target_os = "macos") {
        let current_path = std::env::var("PATH").unwrap_or_default();
        // Packaged apps may not inherit HOME; try multiple fallbacks
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| {
                // Last resort: derive from username
                if let Ok(user) = std::env::var("USER") {
                    format!("/Users/{}", user)
                } else {
                    "/Users/unknown".to_string()
                }
            });

        let mut extra_paths: Vec<String> = vec![
            "/opt/homebrew/bin".into(),
            "/opt/homebrew/sbin".into(),
            "/usr/local/bin".into(),
            "/usr/local/sbin".into(),
            "/usr/local/share/npm/bin".into(),   // Homebrew npm global
            format!("{home}/.local/bin"),         // pipx, etc.
            format!("{home}/.volta/bin"),         // volta
            format!("{home}/.fnm/aliases/default/bin"), // fnm
            format!("{home}/.cargo/bin"),         // cargo/rustup
            format!("{home}/.bun/bin"),           // bun
        ];

        // Always scan nvm versions (both NVM_DIR and default location)
        let nvm_dir = std::env::var("NVM_DIR")
            .unwrap_or_else(|_| format!("{home}/.nvm"));
        let nvm_versions = format!("{nvm_dir}/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("bin");
                if bin_path.exists() {
                    extra_paths.push(bin_path.to_string_lossy().to_string());
                }
            }
        }
        // Also check nvm default alias
        let default_bin = format!("{nvm_dir}/alias/default");
        if std::path::Path::new(&default_bin).exists() {
            extra_paths.push(default_bin);
        }

        // Build enriched PATH: extra paths first, then original
        let enriched = extra_paths
            .into_iter()
            .chain(current_path.split(':').map(String::from))
            .collect::<Vec<_>>()
            .join(":");

        cmd.env("PATH", enriched);
    }

    cmd
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}

pub fn expand_tilde_path(path: &str) -> String {
    if path == "~" {
        if let Some(home) = home_dir() {
            return home.to_string_lossy().to_string();
        }
        return path.to_string();
    }

    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home) = home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }

    path.to_string()
}

pub fn parse_extra_args(raw: &str) -> Vec<String> {
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

pub fn clean_progress_text(input: &str) -> String {
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

pub fn default_models() -> Vec<crate::models::ModelInfo> {
    use crate::models::ModelInfo;
    vec![
        ModelInfo {
            id: "codex".into(),
            name: "GPT-5.3-Codex".into(),
            description: "Most capable coding model".into(),
        },
        ModelInfo {
            id: "o3".into(),
            name: "O3".into(),
            description: "Advanced reasoning model".into(),
        },
        ModelInfo {
            id: "o4-mini".into(),
            name: "O4.1-mini".into(),
            description: "Fast and efficient".into(),
        },
        ModelInfo {
            id: "gpt-4.1".into(),
            name: "GPT-4.1".into(),
            description: "General purpose model".into(),
        },
    ]
}

pub struct StreamParseCache {
    item_text_by_id: HashMap<String, String>,
}

impl StreamParseCache {
    pub fn new() -> Self {
        Self {
            item_text_by_id: HashMap::new(),
        }
    }
}

#[derive(Clone)]
pub struct ApprovalRequestEvent {
    pub request_id: String,
    pub title: String,
    pub description: String,
}

fn value_as_object_text(value: &serde_json::Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    if value.is_null() {
        return String::new();
    }
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn extract_text_delta(
    cache: &mut StreamParseCache,
    item_id: &str,
    full_text: &str,
    is_terminal: bool,
) -> String {
    if full_text.is_empty() || item_id.is_empty() {
        return String::new();
    }

    let previous = cache
        .item_text_by_id
        .get(item_id)
        .cloned()
        .unwrap_or_default();
    let delta = if full_text.starts_with(&previous) {
        full_text[previous.len()..].to_string()
    } else {
        full_text.to_string()
    };

    if is_terminal {
        cache.item_text_by_id.remove(item_id);
    } else {
        cache
            .item_text_by_id
            .insert(item_id.to_string(), full_text.to_string());
    }

    delta
}

pub fn try_extract_approval_request(event: &serde_json::Value) -> Option<ApprovalRequestEvent> {
    let event_type = event
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let method = event
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    let maybe_approval = event_type.to_ascii_lowercase().contains("approval")
        || method.to_ascii_lowercase().contains("approval");
    if !maybe_approval {
        return None;
    }

    let request_id = event
        .get("requestId")
        .or_else(|| event.get("request_id"))
        .or_else(|| event.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if request_id.is_empty() {
        return None;
    }

    let title = event
        .get("title")
        .or_else(|| event.get("method"))
        .and_then(|v| v.as_str())
        .unwrap_or("Approval requested")
        .to_string();

    let description = if let Some(desc) = event.get("description") {
        value_as_object_text(desc)
    } else if let Some(params) = event.get("params") {
        value_as_object_text(params)
    } else {
        value_as_object_text(event)
    };

    Some(ApprovalRequestEvent {
        request_id,
        title,
        description,
    })
}

pub fn parse_codex_event(
    window: &tauri::Window,
    cid: &str,
    event: &serde_json::Value,
    cache: &mut StreamParseCache,
) -> Option<ApprovalRequestEvent> {
    use tauri::Emitter;

    if let Some(approval) = try_extract_approval_request(event) {
        let _ = window.emit(
            "codex-approval-request",
            serde_json::json!({
                "cid": cid,
                "requestId": approval.request_id.clone(),
                "title": approval.title.clone(),
                "description": approval.description.clone(),
            }),
        );
        return Some(approval);
    }

    let event_type = event
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    match event_type {
        "item.streaming" => {
            if let Some(item) = event.get("item") {
                let delta = item
                    .get("delta")
                    .and_then(|d| d.get("text"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if !delta.is_empty() {
                    let item_type = item
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    if item_type == "reasoning" {
                        let payload = serde_json::json!({"cid": cid, "data": delta});
                        let _ = window.emit("codex-thinking-delta", payload.clone());
                        let _ = window.emit("codex-thinking", payload);
                    } else {
                        let _ = window.emit(
                            "codex-stream-delta",
                            serde_json::json!({"cid": cid, "data": delta}),
                        );
                    }
                }
            }
        }
        "item.started" | "item.updated" | "item.completed" => {
            if let Some(item) = event.get("item") {
                let item_type = item
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let terminal = event_type == "item.completed";

                if item_type == "reasoning" {
                    let text = item
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let delta = extract_text_delta(cache, item_id, text, terminal);
                    if !delta.is_empty() {
                        let payload = serde_json::json!({"cid": cid, "data": delta});
                        let _ = window.emit("codex-thinking-delta", payload.clone());
                        let _ = window.emit("codex-thinking", payload);
                    }
                } else if item_type == "agent_message" || item_type == "message" {
                    let text = item
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let delta = extract_text_delta(cache, item_id, text, terminal);
                    if !delta.is_empty() {
                        let _ = window.emit(
                            "codex-stream-delta",
                            serde_json::json!({"cid": cid, "data": delta}),
                        );
                    }
                } else if item_type == "command_execution" {
                    let command = item
                        .get("command")
                        .and_then(|v| v.as_str())
                        .unwrap_or("command")
                        .to_string();
                    let output = item
                        .get("aggregated_output")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let status = item
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("in_progress")
                        .to_ascii_lowercase();
                    let exit_code =
                        if status == "completed" || status == "failed" || status == "declined" {
                            item.get("exit_code")
                                .and_then(|v| v.as_i64())
                                .map(|v| v as i32)
                                .or(Some(-1))
                        } else {
                            None
                        };
                    let terminal_id = if item_id.is_empty() {
                        format!("{cid}-command")
                    } else {
                        item_id.to_string()
                    };
                    let _ = window.emit(
                        "codex-terminal-output",
                        serde_json::json!({
                            "cid": cid,
                            "terminalId": terminal_id,
                            "output": output,
                            "exitCode": exit_code,
                        }),
                    );

                    let tool_status = match status.as_str() {
                        "completed" => "done",
                        "failed" => "error",
                        "declined" => "error",
                        _ => "running",
                    };
                    let _ = window.emit(
                        "codex-tool-call",
                        serde_json::json!({
                            "cid": cid,
                            "title": command,
                            "status": tool_status,
                            "output": output,
                        }),
                    );
                } else if item_type == "mcp_tool_call" {
                    let server = item.get("server").and_then(|v| v.as_str()).unwrap_or("mcp");
                    let tool = item.get("tool").and_then(|v| v.as_str()).unwrap_or("tool");
                    let status = item
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("in_progress")
                        .to_ascii_lowercase();
                    let output = item
                        .get("result")
                        .map(value_as_object_text)
                        .or_else(|| item.get("error").map(value_as_object_text))
                        .unwrap_or_default();
                    let tool_status = match status.as_str() {
                        "completed" => "done",
                        "failed" => "error",
                        _ => "running",
                    };
                    let _ = window.emit(
                        "codex-tool-call",
                        serde_json::json!({
                            "cid": cid,
                            "title": format!("{server}:{tool}"),
                            "status": tool_status,
                            "output": output,
                        }),
                    );
                } else if item_type == "file_change" {
                    let status = item
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("in_progress")
                        .to_ascii_lowercase();
                    let changes = item
                        .get("changes")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    let tool_status = match status.as_str() {
                        "completed" => "done",
                        "failed" => "error",
                        _ => "running",
                    };
                    let _ = window.emit(
                        "codex-tool-call",
                        serde_json::json!({
                            "cid": cid,
                            "title": "file_change",
                            "status": tool_status,
                            "output": value_as_object_text(&changes),
                        }),
                    );
                }
            }
        }
        "turn.failed" => {
            let msg = event
                .get("error")
                .and_then(|e| e.get("message").or_else(|| e.get("error")))
                .and_then(|v| v.as_str())
                .unwrap_or("Turn failed")
                .to_string();
            let _ = window.emit(
                "codex-stream-error",
                serde_json::json!({"cid": cid, "data": msg}),
            );
        }
        "error" => {
            let msg = event
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error")
                .to_string();
            let _ = window.emit(
                "codex-stream-error",
                serde_json::json!({"cid": cid, "data": msg}),
            );
        }
        _ => {}
    }

    None
}

pub fn build_codex_exec_args(
    prompt: &str,
    cfg: &crate::models::RuntimeConfig,
    history: Option<Vec<std::collections::HashMap<String, String>>>,
) -> (String, String, Vec<String>) {
    let mut full_prompt = prompt.to_string();
    if let Some(hist) = history {
        if !hist.is_empty() {
            let mut lines = Vec::new();
            for msg in hist
                .into_iter()
                .rev()
                .take(10)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
            {
                let role = msg.get("role").cloned().unwrap_or_else(|| "user".into());
                let content = msg.get("content").cloned().unwrap_or_default();
                let prefix = if role == "assistant" {
                    "Assistant"
                } else {
                    "User"
                };
                lines.push(format!("{}: {}", prefix, content));
            }
            full_prompt = format!(
                "[Previous conversation]\n{}\n\n[Current question]\n{}",
                lines.join("\n"),
                prompt
            );
        }
    }

    let requested_cwd = if cfg.cli_options.cwd_override.trim().is_empty() {
        cfg.cwd.clone()
    } else {
        cfg.cli_options.cwd_override.clone()
    };

    // Command::current_dir does not expand shell shortcuts like "~".
    let run_cwd = expand_tilde_path(&requested_cwd);

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
        let sandbox = match cfg.cli_options.sandbox.as_str() {
            "read-only" => "read-only",
            "danger-full-access" => "danger-full-access",
            _ => "workspace-write",
        };
        args.push("-s".into());
        args.push(sandbox.to_string());

        let approval_policy = match cfg.cli_options.ask_for_approval.as_str() {
            "untrusted" => "untrusted",
            "on-failure" => "on-failure",
            "never" => "never",
            _ => "on-request",
        };
        args.push("--config".into());
        args.push(format!("approval_policy=\"{}\"", approval_policy));
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
    args.push(full_prompt.clone());

    (full_prompt, run_cwd, args)
}

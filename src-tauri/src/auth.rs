use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;

use base64::Engine as _;
use serde_json::Value;

use crate::models::CodexUser;
use crate::utils::{command_for, home_dir};

fn codex_auth_path() -> Option<PathBuf> {
    let home = home_dir()?;
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

pub fn check_cached_credentials() -> Option<CodexUser> {
    let auth_path = codex_auth_path()?;
    if !auth_path.exists() {
        return None;
    }

    let content = fs::read_to_string(auth_path).ok()?;
    let value = serde_json::from_str::<Value>(&content).ok()?;
    parse_codex_user(&value)
}

#[tauri::command]
pub fn codex_login(method: Option<String>, api_key: Option<String>) -> serde_json::Value {
    if let Some(user) = check_cached_credentials() {
        return serde_json::json!({ "success": true, "user": user });
    }

    let chosen = method.unwrap_or_else(|| "browser".to_string());
    let normalized = chosen.to_lowercase();
    let api_key_value = if normalized == "api-key" {
        match api_key.and_then(|v| {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }) {
            Some(value) => Some(value),
            None => {
                return serde_json::json!({
                    "success": false,
                    "error": "API key login requires a non-empty apiKey value"
                })
            }
        }
    } else {
        None
    };

    let mut cmd = command_for("codex");
    cmd.arg("login");
    if normalized == "device-auth" {
        cmd.arg("--device-auth");
    } else if normalized == "api-key" {
        cmd.arg("--with-api-key");
        cmd.stdin(Stdio::piped());
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    match cmd.spawn() {
        Ok(mut child) => {
            if normalized == "api-key" {
                let Some(mut stdin) = child.stdin.take() else {
                    return serde_json::json!({ "success": false, "error": "Failed to open stdin for API key login" });
                };
                let key = api_key_value.unwrap_or_default();
                if stdin
                    .write_all(format!("{key}\n").as_bytes())
                    .and_then(|_| stdin.flush())
                    .is_err()
                {
                    return serde_json::json!({ "success": false, "error": "Failed to send API key to codex login" });
                }
            }

            match child.wait_with_output() {
                Ok(output) if output.status.success() => {
                    let user = check_cached_credentials();
                    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                    serde_json::json!({ "success": true, "user": user, "method": normalized, "output": stdout })
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                    serde_json::json!({
                        "success": false,
                        "error": if !stderr.is_empty() { stderr } else { stdout },
                    })
                }
                Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
            }
        }
        Err(e) => serde_json::json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
pub fn codex_logout() -> serde_json::Value {
    let status = command_for("codex").arg("logout").status();

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
pub fn get_user() -> Option<CodexUser> {
    check_cached_credentials()
}

#[tauri::command]
pub fn codex_login_methods() -> serde_json::Value {
    serde_json::json!({
        "methods": [
            { "id": "browser", "label": "Browser OAuth" },
            { "id": "device-auth", "label": "Device Auth" },
            { "id": "api-key", "label": "API Key" }
        ]
    })
}

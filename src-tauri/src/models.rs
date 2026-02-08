use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Child, ChildStdin};
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliOptions {
    pub profile: String,
    pub sandbox: String,
    pub ask_for_approval: String,
    pub skip_git_repo_check: bool,
    pub cwd_override: String,
    pub extra_args: String,
    pub enable_web_search: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub thinking: Option<String>,
    pub thinking_duration: Option<i64>,
    pub timestamp: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<Message>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub path: String,
    pub conversations: Vec<Conversation>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DbState {
    pub workspaces: Vec<Workspace>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub is_directory: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CodexUser {
    pub id: String,
    pub email: String,
    pub name: String,
    pub picture: String,
    pub auth_mode: String,
    pub auth_provider: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandResult {
    pub success: bool,
    pub command_id: String,
    pub output: Option<String>,
    pub error_output: Option<String>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct RuntimeConfig {
    pub mode: String,
    pub yolo_mode: bool,
    pub model: String,
    pub cwd: String,
    pub cli_options: CliOptions,
}

pub struct RunningCodexProcess {
    pub child: Child,
    pub stdin: Option<Arc<Mutex<ChildStdin>>>,
}

#[derive(Clone)]
pub struct PendingApproval {
    pub conversation_id: String,
}


pub struct AppState {
    pub config: Mutex<RuntimeConfig>,
    pub db: Mutex<Connection>,
    pub running_codex: Mutex<HashMap<String, RunningCodexProcess>>,
    pub pending_approvals: Mutex<HashMap<String, PendingApproval>>,
    pub pty_terminals: Mutex<HashMap<String, Arc<Mutex<Child>>>>,

}

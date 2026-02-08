pub mod auth;
pub mod codex;
pub mod db;
pub mod fs_ops;
pub mod models;
pub mod shell;
pub mod teams;
pub mod utils;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use models::{AppState, CliOptions, RuntimeConfig};

pub fn run() {
    let db = db::open_database().expect("failed to initialize sqlite database");

    tauri::Builder::default()
        .manage(AppState {
            config: Mutex::new(RuntimeConfig {
                mode: "fast".into(),
                yolo_mode: false,
                model: String::new(),
                cwd: std::env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .to_string_lossy()
                    .to_string(),
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
            db: Mutex::new(db),
            running_codex: Mutex::new(HashMap::new()),
            pending_approvals: Mutex::new(HashMap::new()),
            pty_terminals: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            codex::set_mode,
            codex::get_mode,
            codex::set_yolo_mode,
            codex::get_yolo_mode,
            codex::get_models,
            codex::get_model,
            codex::set_model,
            codex::set_cli_options,
            codex::get_cli_options,
            codex::init_acp,
            codex::switch_workspace,
            codex::check_codex,
            codex::install_codex,
            codex::open_workspace,
            codex::cancel_prompt,
            codex::stream_codex,
            codex::debug_log,
            codex::run_codex_command,
            codex::update_title_bar_overlay,
            codex::respond_to_approval,
            shell::run_command,
            shell::kill_command,
            shell::pty_create,
            shell::pty_write,
            shell::pty_kill,
            shell::pty_list,
            auth::codex_login,
            auth::codex_logout,
            auth::codex_login_methods,
            auth::get_user,
            fs_ops::search_files,
            fs_ops::read_file_content,
            fs_ops::write_file,
            fs_ops::list_directory,
            fs_ops::file_exists,
            fs_ops::web_search,
            fs_ops::open_in_editor,
            db::db_get_state,
            db::db_create_workspace,
            db::db_delete_workspace,
            db::db_get_conversations,
            db::db_create_conversation,
            db::db_update_conversation_title,
            db::db_delete_conversation,
            db::db_get_messages,
            db::db_create_message,
            teams::send_to_teams
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

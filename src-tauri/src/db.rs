use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{params, Connection};
use tauri::State;

use crate::models::{AppState, Conversation, DbState, Message, Workspace};
use crate::utils::{expand_tilde_path, home_dir, now_iso};

fn db_file_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Unable to resolve home directory".to_string())?;
    let dir = home.join(".codex-wui");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.sqlite3"))
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            thinking TEXT,
            thinking_duration INTEGER,
            timestamp TEXT NOT NULL,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON conversations(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
        "#,
    )
    .map_err(|e| e.to_string())
}

pub fn open_database() -> Result<Connection, String> {
    let path = db_file_path()?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    ensure_schema(&conn)?;
    Ok(conn)
}

fn load_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<Message>, String> {
    let mut stmt = conn
        .prepare(
            r#"
        SELECT id, conversation_id, role, content, thinking, thinking_duration, timestamp
        FROM messages
        WHERE conversation_id = ?1
        ORDER BY rowid ASC
        "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                thinking: row.get(4)?,
                thinking_duration: row.get(5)?,
                timestamp: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn load_conversations(conn: &Connection, workspace_id: &str) -> Result<Vec<Conversation>, String> {
    let mut stmt = conn
        .prepare(
            r#"
        SELECT id, workspace_id, title, created_at, updated_at
        FROM conversations
        WHERE workspace_id = ?1
        ORDER BY rowid ASC
        "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![workspace_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut conversations = Vec::new();
    for row in rows {
        let (id, workspace_id, title, created_at, updated_at) = row.map_err(|e| e.to_string())?;
        let messages = load_messages(conn, &id)?;
        conversations.push(Conversation {
            id,
            workspace_id,
            title,
            created_at,
            updated_at,
            messages,
        });
    }
    Ok(conversations)
}

fn load_state(conn: &Connection) -> Result<DbState, String> {
    let mut stmt = conn
        .prepare(
            r#"
        SELECT id, name, path
        FROM workspaces
        ORDER BY rowid ASC
        "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut workspaces = Vec::new();
    for row in rows {
        let (id, name, raw_path) = row.map_err(|e| e.to_string())?;
        let path = expand_tilde_path(&raw_path);
        let conversations = load_conversations(conn, &id)?;
        workspaces.push(Workspace {
            id,
            name,
            path,
            conversations,
        });
    }

    Ok(DbState { workspaces })
}

#[tauri::command]
pub fn db_get_state(state: State<'_, AppState>) -> DbState {
    let conn = state.db.lock().unwrap();
    match load_state(&conn) {
        Ok(data) => data,
        Err(error) => {
            eprintln!("[db] Failed to load state: {error}");
            DbState {
                workspaces: Vec::new(),
            }
        }
    }
}

#[tauri::command]
pub fn db_create_workspace(
    id: String,
    name: String,
    workspace_path: String,
    state: State<'_, AppState>,
) -> Result<Workspace, String> {
    let normalized_path = expand_tilde_path(&workspace_path);
    let conn = state.db.lock().unwrap();
    conn.execute(
        r#"
        INSERT INTO workspaces (id, name, path)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            path = excluded.path
        "#,
        params![&id, &name, &normalized_path],
    )
    .map_err(|e| e.to_string())?;

    Ok(Workspace {
        id,
        name,
        path: normalized_path,
        conversations: Vec::new(),
    })
}

#[tauri::command]
pub fn db_delete_workspace(
    id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().unwrap();
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub fn db_get_conversations(workspace_id: String, state: State<'_, AppState>) -> Vec<Conversation> {
    let conn = state.db.lock().unwrap();
    match load_conversations(&conn, &workspace_id) {
        Ok(items) => items,
        Err(error) => {
            eprintln!("[db] Failed to load conversations: {error}");
            Vec::new()
        }
    }
}

#[tauri::command]
pub fn db_create_conversation(
    id: String,
    workspace_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<Conversation, String> {
    let conn = state.db.lock().unwrap();
    let now = now_iso();
    conn.execute(
        r#"
        INSERT INTO conversations (id, workspace_id, title, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
        params![&id, &workspace_id, &title, &now, &now],
    )
    .map_err(|e| e.to_string())?;

    Ok(Conversation {
        id,
        workspace_id,
        title,
        created_at: now.clone(),
        updated_at: now,
        messages: Vec::new(),
    })
}

#[tauri::command]
pub fn db_update_conversation_title(
    id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().unwrap();
    let updated_at = now_iso();
    conn.execute(
        "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, updated_at, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub fn db_delete_conversation(
    id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let conn = state.db.lock().unwrap();
    conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub fn db_get_messages(conversation_id: String, state: State<'_, AppState>) -> Vec<Message> {
    let conn = state.db.lock().unwrap();
    match load_messages(&conn, &conversation_id) {
        Ok(messages) => messages,
        Err(error) => {
            eprintln!("[db] Failed to load messages: {error}");
            Vec::new()
        }
    }
}

#[tauri::command]
pub fn db_create_message(message: Message, state: State<'_, AppState>) -> Result<Message, String> {
    let mut conn = state.db.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        r#"
        INSERT INTO messages (id, conversation_id, role, content, thinking, thinking_duration, timestamp)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        "#,
        params![
            &message.id,
            &message.conversation_id,
            &message.role,
            &message.content,
            &message.thinking,
            message.thinking_duration,
            &message.timestamp
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), &message.conversation_id],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(message)
}

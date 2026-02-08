import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { Conversation, DbState, Message, Workspace } from './models';
import { expandTildePath, homeDir, nowIso } from './utils';

function dbFilePath(): string {
    const home = homeDir();
    if (!home) throw new Error('Unable to resolve home directory');
    const dir = path.join(home, '.codex-wui');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'state.sqlite3');
}

function ensureSchema(db: Database.Database): void {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');

    db.exec(`
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
  `);
}

export function openDatabase(): Database.Database {
    const dbPath = dbFilePath();
    const db = new Database(dbPath);
    ensureSchema(db);
    return db;
}

function loadMessages(db: Database.Database, conversationId: string): Message[] {
    const stmt = db.prepare(`
    SELECT id, conversation_id, role, content, thinking, thinking_duration, timestamp
    FROM messages
    WHERE conversation_id = ?
    ORDER BY rowid ASC
  `);

    return stmt.all(conversationId).map((row: any) => ({
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        content: row.content,
        thinking: row.thinking || undefined,
        thinkingDuration: row.thinking_duration || undefined,
        timestamp: row.timestamp,
    }));
}

function loadConversations(db: Database.Database, workspaceId: string): Conversation[] {
    const stmt = db.prepare(`
    SELECT id, workspace_id, title, created_at, updated_at
    FROM conversations
    WHERE workspace_id = ?
    ORDER BY rowid ASC
  `);

    return stmt.all(workspaceId).map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messages: loadMessages(db, row.id),
    }));
}

function loadState(db: Database.Database): DbState {
    const stmt = db.prepare(`
    SELECT id, name, path
    FROM workspaces
    ORDER BY rowid ASC
  `);

    const workspaces: Workspace[] = stmt.all().map((row: any) => ({
        id: row.id,
        name: row.name,
        path: expandTildePath(row.path),
        conversations: loadConversations(db, row.id),
    }));

    return { workspaces };
}

export function dbGetState(db: Database.Database): DbState {
    try {
        return loadState(db);
    } catch (error) {
        console.error('[db] Failed to load state:', error);
        return { workspaces: [] };
    }
}

export function dbCreateWorkspace(
    db: Database.Database,
    id: string,
    name: string,
    workspacePath: string,
): Workspace {
    const normalizedPath = expandTildePath(workspacePath);
    db.prepare(`
    INSERT INTO workspaces (id, name, path)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path
  `).run(id, name, normalizedPath);

    return { id, name, path: normalizedPath, conversations: [] };
}

export function dbDeleteWorkspace(db: Database.Database, id: string): { success: boolean } {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    return { success: true };
}

export function dbGetConversations(db: Database.Database, workspaceId: string): Conversation[] {
    try {
        return loadConversations(db, workspaceId);
    } catch (error) {
        console.error('[db] Failed to load conversations:', error);
        return [];
    }
}

export function dbCreateConversation(
    db: Database.Database,
    id: string,
    workspaceId: string,
    title: string,
): Conversation {
    const now = nowIso();
    db.prepare(`
    INSERT INTO conversations (id, workspace_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, workspaceId, title, now, now);

    return { id, workspaceId, title, createdAt: now, updatedAt: now, messages: [] };
}

export function dbUpdateConversationTitle(
    db: Database.Database,
    id: string,
    title: string,
): { success: boolean } {
    const updatedAt = nowIso();
    db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
        title,
        updatedAt,
        id,
    );
    return { success: true };
}

export function dbDeleteConversation(db: Database.Database, id: string): { success: boolean } {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return { success: true };
}

export function dbGetMessages(db: Database.Database, conversationId: string): Message[] {
    try {
        return loadMessages(db, conversationId);
    } catch (error) {
        console.error('[db] Failed to load messages:', error);
        return [];
    }
}

export function dbCreateMessage(db: Database.Database, message: Message): Message {
    const insertMsg = db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, thinking, thinking_duration, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

    const updateConv = db.prepare(
        'UPDATE conversations SET updated_at = ? WHERE id = ?',
    );

    const transaction = db.transaction(() => {
        insertMsg.run(
            message.id,
            message.conversationId,
            message.role,
            message.content,
            message.thinking || null,
            message.thinkingDuration || null,
            message.timestamp,
        );
        updateConv.run(nowIso(), message.conversationId);
    });

    transaction();
    return message;
}

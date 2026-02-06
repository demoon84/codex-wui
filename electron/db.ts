import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

// Types
export interface Message {
    id: string
    conversationId: string
    role: 'user' | 'assistant'
    content: string
    thinking?: string
    thinkingDuration?: number
    timestamp: string
}

export interface Conversation {
    id: string
    workspaceId: string
    title: string
    createdAt: string
    updatedAt: string
}

export interface Workspace {
    id: string
    name: string
    path: string
}

// Database singleton
let db: SqlJsDatabase | null = null
let dbPath: string = ''

function getDbPath(): string {
    const userDataPath = app.getPath('userData')
    return path.join(userDataPath, 'codex-ui.db')
}

// Save database to file
function saveDatabase(): void {
    if (db) {
        const data = db.export()
        const buffer = Buffer.from(data)
        fs.writeFileSync(dbPath, buffer)
    }
}

export async function initDatabase(): Promise<void> {
    if (db) return

    dbPath = getDbPath()
    console.log('[DB] Initializing database at:', dbPath)

    // Initialize sql.js
    const SQL = await initSqlJs()

    // Load existing database or create new one
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath)
        db = new SQL.Database(buffer)
        console.log('[DB] Loaded existing database')
    } else {
        db = new SQL.Database()
        console.log('[DB] Created new database')
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            workspaceId TEXT NOT NULL,
            title TEXT NOT NULL,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
            updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (workspaceId) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversationId TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            thinking TEXT,
            thinkingDuration INTEGER,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspaceId);
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId);
    `)

    saveDatabase()
    console.log('[DB] Database initialized successfully')
}

// Helper function to run query and get results
function queryAll<T>(sql: string, params: unknown[] = []): T[] {
    if (!db) return []
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const results: T[] = []
    while (stmt.step()) {
        results.push(stmt.getAsObject() as T)
    }
    stmt.free()
    return results
}

function queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
    const results = queryAll<T>(sql, params)
    return results[0]
}

function runSql(sql: string, params: unknown[] = []): void {
    if (!db) return
    db.run(sql, params)
    saveDatabase()
}

// Workspace operations
export function getAllWorkspaces(): Workspace[] {
    return queryAll<Workspace>('SELECT id, name, path FROM workspaces ORDER BY createdAt DESC')
}

// Get first workspace path (for initial ACP mount)
export function getFirstWorkspacePath(): string | null {
    const result = queryOne<{ path: string }>('SELECT path FROM workspaces ORDER BY createdAt ASC LIMIT 1')
    return result?.path || null
}

export function createWorkspace(id: string, name: string, workspacePath: string): Workspace {
    runSql('INSERT INTO workspaces (id, name, path) VALUES (?, ?, ?)', [id, name, workspacePath])
    return { id, name, path: workspacePath }
}

export function deleteWorkspace(id: string): void {
    // Delete related conversations and messages first (manual cascade for sql.js)
    const conversations = queryAll<{ id: string }>('SELECT id FROM conversations WHERE workspaceId = ?', [id])
    for (const conv of conversations) {
        runSql('DELETE FROM messages WHERE conversationId = ?', [conv.id])
    }
    runSql('DELETE FROM conversations WHERE workspaceId = ?', [id])
    runSql('DELETE FROM workspaces WHERE id = ?', [id])
}

// Conversation operations
export function getConversationsByWorkspace(workspaceId: string): Conversation[] {
    return queryAll<Conversation>(
        'SELECT id, workspaceId, title, createdAt, updatedAt FROM conversations WHERE workspaceId = ? ORDER BY updatedAt DESC',
        [workspaceId]
    )
}

export function createConversation(id: string, workspaceId: string, title: string): Conversation {
    const now = new Date().toISOString()
    runSql('INSERT INTO conversations (id, workspaceId, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', [id, workspaceId, title, now, now])
    return { id, workspaceId, title, createdAt: now, updatedAt: now }
}

export function updateConversationTitle(id: string, title: string): void {
    const now = new Date().toISOString()
    runSql('UPDATE conversations SET title = ?, updatedAt = ? WHERE id = ?', [title, now, id])
}

export function deleteConversation(id: string): void {
    runSql('DELETE FROM messages WHERE conversationId = ?', [id])
    runSql('DELETE FROM conversations WHERE id = ?', [id])
}

// Message operations
export function getMessagesByConversation(conversationId: string): Message[] {
    return queryAll<Message>(
        'SELECT id, conversationId, role, content, thinking, thinkingDuration, timestamp FROM messages WHERE conversationId = ? ORDER BY timestamp ASC',
        [conversationId]
    )
}

export function createMessage(message: Message): Message {
    runSql(
        'INSERT INTO messages (id, conversationId, role, content, thinking, thinkingDuration, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
            message.id,
            message.conversationId,
            message.role,
            message.content,
            message.thinking || null,
            message.thinkingDuration || null,
            message.timestamp
        ]
    )

    // Update conversation's updatedAt
    runSql('UPDATE conversations SET updatedAt = ? WHERE id = ?', [message.timestamp, message.conversationId])

    return message
}

export function deleteMessage(id: string): void {
    runSql('DELETE FROM messages WHERE id = ?', [id])
}

// Get full state for initial load
export function getFullState(): { workspaces: (Workspace & { conversations: (Conversation & { messages: Message[] })[] })[] } {
    const workspaces = getAllWorkspaces()

    return {
        workspaces: workspaces.map(workspace => ({
            ...workspace,
            conversations: getConversationsByWorkspace(workspace.id).map(conv => ({
                ...conv,
                messages: getMessagesByConversation(conv.id)
            }))
        }))
    }
}

// Close database connection
export function closeDatabase(): void {
    if (db) {
        saveDatabase()
        db.close()
        db = null
        console.log('[DB] Database closed')
    }
}

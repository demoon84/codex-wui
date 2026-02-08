// Shared types used across the application

export interface FileSearchResult {
    name: string
    path: string
    relativePath: string
    isDirectory: boolean
}

export interface Message {
    id: string
    conversationId: string
    role: 'user' | 'assistant'
    content: string
    thinking?: string
    thinkingDuration?: number
    timestamp: string
    needsApproval?: boolean
}

export interface Conversation {
    id: string
    workspaceId: string
    title: string
    createdAt: string
    updatedAt: string
    messages: Message[]
}

export interface Workspace {
    id: string
    name: string
    path: string
    conversations: Conversation[]
}

export interface AppState {
    workspaces: Workspace[]
    activeWorkspaceId: string | null
    activeConversationId: string | null
}

export interface CodexUser {
    id: string
    email: string
    name: string
    picture: string
    authMode: string
    authProvider: string
}

export interface ToolCall {
    title: string
    status: string
    output?: string
}

export interface ProgressUpdate {
    stepNumber: number
    title: string
    status: 'pending' | 'running' | 'done' | 'error'
    details?: string
    timestamp: number
}

export interface FileEdit {
    path: string
    action: 'create' | 'modify' | 'delete'
    linesChanged?: string
    timestamp: number
}

export interface BackgroundCommand {
    id: string
    command: string
    cwd: string
    output: string
    status: 'running' | 'done' | 'error'
    exitCode?: number
}

export interface TerminalOutputData {
    terminalId: string
    output: string
    exitCode: number | null
}

export interface ApprovalRequest {
    requestId: string
    title: string
    description: string
}

export interface TaskSummary {
    title: string
    summary: string
}

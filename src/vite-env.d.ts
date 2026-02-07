/// <reference types="vite/client" />

// This file is auto-generated from preload.ts types
// See electron/preload.ts for the source of truth

type ModelMode = 'planning' | 'fast'
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'

interface CliOptions {
    profile: string
    sandbox: SandboxMode
    askForApproval: ApprovalPolicy
    skipGitRepoCheck: boolean
    cwdOverride: string
    extraArgs: string
    enableWebSearch: boolean
}

interface DbMessage {
    id: string
    conversationId: string
    role: 'user' | 'assistant'
    content: string
    thinking?: string
    thinkingDuration?: number
    timestamp: string
}

interface DbConversation {
    id: string
    workspaceId: string
    title: string
    createdAt: string
    updatedAt: string
}

interface DbWorkspace {
    id: string
    name: string
    path: string
}

interface FileSearchResult {
    name: string
    path: string
    relativePath: string
    isDirectory: boolean
}

interface CodexUser {
    id: string
    email: string
    name: string
    picture: string
    authMode?: string
    authProvider?: string
}

interface Window {
    codexApi: {
        setMode: (mode: ModelMode) => Promise<ModelMode>
        getMode: () => Promise<ModelMode>
        getModels: () => Promise<Array<{ id: string; name: string; description: string }>>
        getModel: () => Promise<string>
        setModel: (modelId: string) => Promise<string>
        setCliOptions: (options: Partial<CliOptions>) => Promise<CliOptions>
        getCliOptions: () => Promise<CliOptions>
        setYoloMode: (enabled: boolean) => Promise<boolean>
        getYoloMode: () => Promise<boolean>
        // Codex CLI Installation
        checkCodex: () => Promise<{ installed: boolean }>
        installCodex: () => Promise<{ success: boolean; error?: string }>
        onCodexInstallProgress: (callback: (data: { status: string; message: string }) => void) => void
        initAcp: () => Promise<{ success: boolean; error?: string }>
        openWorkspace: () => Promise<{ path: string; name: string } | null>
        switchWorkspace: (workspaceId: string, cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
        streamCodex: (prompt: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<void>
        cancelPrompt: () => Promise<{ success: boolean; error?: string }>
        updateTitleBarOverlay: (color: string, symbolColor: string) => Promise<{ success: boolean; error?: string }>
        onStreamToken: (callback: (token: string) => void) => void
        onStreamDelta: (callback: (delta: string) => void) => void
        onThinking: (callback: (text: string) => void) => void
        onStreamEnd: (callback: () => void) => void
        onStreamError: (callback: (error: string) => void) => void
        onMode: (callback: (mode: ModelMode) => void) => void
        onAcpReady: (callback: (ready: boolean) => void) => void
        onToolCall: (callback: (data: { title: string; status: string }) => void) => void
        onTerminalOutput: (callback: (data: { terminalId: string; output: string; exitCode: number | null }) => void) => void
        onApprovalRequest: (callback: (data: { requestId: string; title: string; description: string }) => void) => void
        respondToApproval: (requestId: string, approved: boolean) => Promise<void>
        db: {
            getState: () => Promise<{ workspaces: (DbWorkspace & { conversations: (DbConversation & { messages: DbMessage[] })[] })[] }>
            createWorkspace: (id: string, name: string, path: string) => Promise<DbWorkspace>
            deleteWorkspace: (id: string) => Promise<{ success: boolean }>
            getConversations: (workspaceId: string) => Promise<DbConversation[]>
            createConversation: (id: string, workspaceId: string, title: string) => Promise<DbConversation>
            updateConversationTitle: (id: string, title: string) => Promise<{ success: boolean }>
            deleteConversation: (id: string) => Promise<{ success: boolean }>
            getMessages: (conversationId: string) => Promise<DbMessage[]>
            createMessage: (message: DbMessage) => Promise<DbMessage>
        }
        searchFiles: (workspacePath: string, query: string) => Promise<FileSearchResult[]>
        readFileContent: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
        // Auth API
        codexLogin: (method?: 'browser' | 'device-auth' | 'api-key', apiKey?: string) => Promise<{ success: boolean; user?: CodexUser; error?: string }>
        codexLogout: () => Promise<{ success: boolean; error?: string }>
        codexLoginMethods: () => Promise<{ methods: Array<{ id: 'browser' | 'device-auth' | 'api-key'; label: string }> }>
        getUser: () => Promise<CodexUser | null>
        // File System API
        writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
        listDirectory: (dirPath: string) => Promise<{ success: boolean; entries?: DirectoryEntry[]; error?: string }>
        fileExists: (filePath: string) => Promise<boolean>
        // Terminal API
        runCommand: (command: string, cwd: string) => Promise<CommandResult>
        runCodexCommand: (subcommand: string, args: string[], cwd?: string) => Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; error?: string }>
        killCommand: (commandId: string) => Promise<{ success: boolean; error?: string }>
        onCommandOutput: (callback: (data: CommandOutput) => void) => void
        // Web Search API
        webSearch: (query: string) => Promise<{ success: boolean; results: SearchResult[]; error?: string }>
    }
}

interface DirectoryEntry {
    name: string
    path: string
    isDirectory: boolean
    size: number
}

interface CommandResult {
    success: boolean
    commandId: string
    output?: string
    errorOutput?: string
    exitCode?: number
    error?: string
}

interface CommandOutput {
    commandId: string
    type: 'stdout' | 'stderr'
    data: string
}

interface SearchResult {
    title: string
    url: string
    snippet: string
}

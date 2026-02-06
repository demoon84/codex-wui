import { contextBridge, ipcRenderer } from 'electron'

// Mode types
type ModelMode = 'planning' | 'fast'

// Callback storage
let tokenCallback: ((token: string) => void) | null = null
let tokenDeltaCallback: ((delta: string) => void) | null = null
let thinkingCallback: ((text: string) => void) | null = null
let thinkingDeltaCallback: ((delta: string) => void) | null = null
let endCallback: (() => void) | null = null
let errorCallback: ((error: string) => void) | null = null
let modeCallback: ((mode: ModelMode) => void) | null = null
let acpReadyCallback: ((ready: boolean) => void) | null = null
let toolCallCallback: ((data: { title: string; status: string }) => void) | null = null
let terminalOutputCallback: ((data: { terminalId: string; output: string; exitCode: number | null }) => void) | null = null
let approvalRequestCallback: ((data: { requestId: string; title: string; description: string }) => void) | null = null
let progressCallback: ((text: string) => void) | null = null
let ptyDataCallback: ((id: string, data: string) => void) | null = null
let ptyExitCallback: ((id: string, exitCode: number) => void) | null = null

// Listen for stream events
ipcRenderer.on('gemini-stream-token', (_, token: string) => {
    if (tokenCallback) tokenCallback(token)
})

ipcRenderer.on('gemini-thinking', (_, text: string) => {
    if (thinkingCallback) thinkingCallback(text)
})

ipcRenderer.on('gemini-thinking-delta', (_, delta: string) => {
    if (thinkingDeltaCallback) thinkingDeltaCallback(delta)
})

ipcRenderer.on('gemini-stream-delta', (_, delta: string) => {
    if (tokenDeltaCallback) tokenDeltaCallback(delta)
})

ipcRenderer.on('gemini-stream-end', () => {
    if (endCallback) endCallback()
})

ipcRenderer.on('gemini-stream-error', (_, error: string) => {
    if (errorCallback) errorCallback(error)
})

ipcRenderer.on('gemini-mode', (_, mode: ModelMode) => {
    if (modeCallback) modeCallback(mode)
})

ipcRenderer.on('acp-ready', (_, ready: boolean) => {
    if (acpReadyCallback) acpReadyCallback(ready)
})

ipcRenderer.on('gemini-tool-call', (_, data: { title: string; status: string; output?: string }) => {
    if (toolCallCallback) toolCallCallback(data)
})

ipcRenderer.on('gemini-terminal-output', (_, data: { terminalId: string; output: string; exitCode: number | null }) => {
    if (terminalOutputCallback) terminalOutputCallback(data)
})

ipcRenderer.on('gemini-approval-request', (_, data: { requestId: string; title: string; description: string }) => {
    if (approvalRequestCallback) approvalRequestCallback(data)
})

ipcRenderer.on('gemini-progress', (_, text: string) => {
    if (progressCallback) progressCallback(text)
})

ipcRenderer.on('pty-data', (_, { id, data }: { id: string; data: string }) => {
    if (ptyDataCallback) ptyDataCallback(id, data)
})

ipcRenderer.on('pty-exit', (_, { id, exitCode }: { id: string; exitCode: number }) => {
    if (ptyExitCallback) ptyExitCallback(id, exitCode)
})

// Expose API to renderer
contextBridge.exposeInMainWorld('geminiApi', {
    // Set model mode
    setMode: (mode: ModelMode): Promise<ModelMode> => {
        return ipcRenderer.invoke('set-mode', mode)
    },

    // Get current mode
    getMode: (): Promise<ModelMode> => {
        return ipcRenderer.invoke('get-mode')
    },

    // Set YOLO mode (auto-approve)
    setYoloMode: (enabled: boolean): Promise<boolean> => {
        return ipcRenderer.invoke('set-yolo-mode', enabled)
    },

    // Get YOLO mode status
    getYoloMode: (): Promise<boolean> => {
        return ipcRenderer.invoke('get-yolo-mode')
    },

    // Get available models
    getModels: (): Promise<Array<{ id: string; name: string; description: string }>> => {
        return ipcRenderer.invoke('get-models')
    },

    // Get current model
    getModel: (): Promise<string> => {
        return ipcRenderer.invoke('get-model')
    },

    // Set model
    setModel: (modelId: string): Promise<string> => {
        return ipcRenderer.invoke('set-model', modelId)
    },

    // ===== Codex CLI Installation API =====
    checkCodex: (): Promise<{ installed: boolean }> => {
        return ipcRenderer.invoke('check-codex')
    },

    installCodex: (): Promise<{ success: boolean; error?: string }> => {
        return ipcRenderer.invoke('install-codex')
    },

    onCodexInstallProgress: (callback: (data: { status: string; message: string }) => void) => {
        ipcRenderer.on('codex-install-progress', (_, data) => callback(data))
    },

    // Initialize ACP
    initAcp: (): Promise<{ success: boolean; error?: string }> => {
        return ipcRenderer.invoke('init-acp')
    },

    // Open workspace folder dialog
    openWorkspace: (): Promise<{ path: string; name: string } | null> => {
        return ipcRenderer.invoke('open-workspace')
    },

    // Switch workspace - creates new ACP session with workspace cwd
    switchWorkspace: (workspaceId: string, cwd: string): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
        return ipcRenderer.invoke('switch-workspace', workspaceId, cwd)
    },

    // Stream gemini response
    streamGemini: (prompt: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void> => {
        return ipcRenderer.invoke('stream-gemini', prompt, conversationHistory)
    },

    // Cancel current prompt
    cancelPrompt: (): Promise<{ success: boolean; error?: string }> => {
        return ipcRenderer.invoke('cancel-prompt')
    },

    // Update title bar overlay color (Windows only)
    updateTitleBarOverlay: (color: string, symbolColor: string): Promise<{ success: boolean; error?: string }> => {
        return ipcRenderer.invoke('update-title-bar-overlay', { color, symbolColor })
    },

    // Register token callback
    onStreamToken: (callback: (token: string) => void) => {
        tokenCallback = callback
    },

    // Register token delta callback (real-time streaming)
    onStreamDelta: (callback: (delta: string) => void) => {
        tokenDeltaCallback = callback
    },

    // Register thinking callback
    onThinking: (callback: (text: string) => void) => {
        thinkingCallback = callback
    },

    // Register thinking delta callback (real-time streaming)
    onThinkingDelta: (callback: (delta: string) => void) => {
        thinkingDeltaCallback = callback
    },

    // Register stream end callback
    onStreamEnd: (callback: () => void) => {
        endCallback = callback
    },

    // Register error callback
    onStreamError: (callback: (error: string) => void) => {
        errorCallback = callback
    },

    // Register mode callback
    onMode: (callback: (mode: ModelMode) => void) => {
        modeCallback = callback
    },

    // Register progress callback (terminal-style output from stderr)
    onProgress: (callback: (text: string) => void) => {
        progressCallback = callback
    },

    // Register ACP ready callback
    onAcpReady: (callback: (ready: boolean) => void) => {
        acpReadyCallback = callback
    },

    // Register tool call callback
    onToolCall: (callback: (data: { title: string; status: string; output?: string }) => void) => {
        toolCallCallback = callback
    },

    // Register terminal output callback
    onTerminalOutput: (callback: (data: { terminalId: string; output: string; exitCode: number | null }) => void) => {
        terminalOutputCallback = callback
    },

    // Register approval request callback
    onApprovalRequest: (callback: (data: { requestId: string; title: string; description: string }) => void) => {
        approvalRequestCallback = callback
    },

    // Send approval response
    respondToApproval: (requestId: string, approved: boolean) =>
        ipcRenderer.invoke('gemini:approval-response', { requestId, approved }),

    // ===== Database API =====
    db: {
        getState: () => ipcRenderer.invoke('db-get-state'),
        createWorkspace: (id: string, name: string, path: string) =>
            ipcRenderer.invoke('db-create-workspace', id, name, path),
        deleteWorkspace: (id: string) =>
            ipcRenderer.invoke('db-delete-workspace', id),
        getConversations: (workspaceId: string) =>
            ipcRenderer.invoke('db-get-conversations', workspaceId),
        createConversation: (id: string, workspaceId: string, title: string) =>
            ipcRenderer.invoke('db-create-conversation', id, workspaceId, title),
        updateConversationTitle: (id: string, title: string) =>
            ipcRenderer.invoke('db-update-conversation-title', id, title),
        deleteConversation: (id: string) =>
            ipcRenderer.invoke('db-delete-conversation', id),
        getMessages: (conversationId: string) =>
            ipcRenderer.invoke('db-get-messages', conversationId),
        createMessage: (message: { id: string; conversationId: string; role: string; content: string; thinking?: string; thinkingDuration?: number; timestamp: string }) =>
            ipcRenderer.invoke('db-create-message', message),
    },

    // ===== Auth API =====
    googleLogin: (): Promise<{ success: boolean; user?: GoogleUser; error?: string }> =>
        ipcRenderer.invoke('google-login'),

    googleLogout: (): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('google-logout'),

    getUser: (): Promise<GoogleUser | null> =>
        ipcRenderer.invoke('get-user'),

    // ===== File Search API =====
    searchFiles: (workspacePath: string, query: string): Promise<FileSearchResult[]> =>
        ipcRenderer.invoke('search-files', workspacePath, query),

    readFileContent: (filePath: string): Promise<{ success: boolean; content?: string; error?: string }> =>
        ipcRenderer.invoke('read-file-content', filePath),

    // ===== File System API =====
    writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('write-file', filePath, content),

    listDirectory: (dirPath: string): Promise<{ success: boolean; entries?: Array<{ name: string; path: string; isDirectory: boolean; size: number }>; error?: string }> =>
        ipcRenderer.invoke('list-directory', dirPath),

    fileExists: (filePath: string): Promise<boolean> =>
        ipcRenderer.invoke('file-exists', filePath),

    // ===== Terminal API =====
    runCommand: (command: string, cwd: string): Promise<{ success: boolean; commandId: string; output?: string; errorOutput?: string; exitCode?: number; error?: string }> =>
        ipcRenderer.invoke('run-command', command, cwd),

    killCommand: (commandId: string): Promise<{ success: boolean; error?: string }> =>
        ipcRenderer.invoke('kill-command', commandId),

    onCommandOutput: (callback: (data: { commandId: string; type: 'stdout' | 'stderr'; data: string }) => void) => {
        ipcRenderer.on('command-output', (_, data) => callback(data))
    },

    // ===== Interactive PTY Terminal API =====
    pty: {
        create: (cwd?: string, shell?: string): Promise<{ id: string; shell: string }> =>
            ipcRenderer.invoke('pty-create', { cwd, shell }),
        write: (id: string, data: string): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('pty-write', { id, data }),
        kill: (id: string): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('pty-kill', { id }),
        list: (): Promise<string[]> =>
            ipcRenderer.invoke('pty-list'),
        onData: (callback: (id: string, data: string) => void) => {
            ptyDataCallback = callback
        },
        onExit: (callback: (id: string, exitCode: number) => void) => {
            ptyExitCallback = callback
        }
    },

    // ===== Web Search API =====
    webSearch: (query: string): Promise<{ success: boolean; results: Array<{ title: string; url: string; snippet: string }>; error?: string }> =>
        ipcRenderer.invoke('web-search', query),
})

// Google User type
interface GoogleUser {
    id: string
    email: string
    name: string
    picture: string
}

// Message type for database
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

// File search result interface
interface FileSearchResult {
    name: string
    path: string
    relativePath: string
    isDirectory: boolean
}

// Type declaration for window
declare global {
    interface Window {
        geminiApi: {
            setMode: (mode: ModelMode) => Promise<ModelMode>
            getMode: () => Promise<ModelMode>
            getModels: () => Promise<Array<{ id: string; name: string; description: string }>>
            getModel: () => Promise<string>
            setModel: (modelId: string) => Promise<string>
            initAcp: () => Promise<{ success: boolean; error?: string }>
            openWorkspace: () => Promise<{ path: string; name: string } | null>
            switchWorkspace: (workspaceId: string, cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
            streamGemini: (prompt: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<void>
            cancelPrompt: () => Promise<{ success: boolean; error?: string }>
            updateTitleBarOverlay: (color: string, symbolColor: string) => Promise<{ success: boolean; error?: string }>
            onStreamToken: (callback: (token: string) => void) => void
            onThinking: (callback: (text: string) => void) => void
            onStreamEnd: (callback: () => void) => void
            onStreamError: (callback: (error: string) => void) => void
            onMode: (callback: (mode: ModelMode) => void) => void
            onAcpReady: (callback: (ready: boolean) => void) => void
            onToolCall: (callback: (data: { title: string; status: string }) => void) => void
            onTerminalOutput: (callback: (data: { terminalId: string; output: string; exitCode: number | null }) => void) => void
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
            pty: {
                create: (cwd?: string, shell?: string) => Promise<{ id: string; shell: string }>
                write: (id: string, data: string) => Promise<{ success: boolean; error?: string }>
                kill: (id: string) => Promise<{ success: boolean; error?: string }>
                list: () => Promise<string[]>
                onData: (callback: (id: string, data: string) => void) => void
                onExit: (callback: (id: string, exitCode: number) => void) => void
            }
        }
    }
}


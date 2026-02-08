import { contextBridge, ipcRenderer } from 'electron';

type UnlistenFn = () => void;

function onEvent<T>(channel: string, callback: (payload: T) => void): UnlistenFn {
    const handler = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('codexApi', {
    // Mode / Model / Config
    setMode: (mode: string) => ipcRenderer.invoke('set-mode', mode),
    getMode: () => ipcRenderer.invoke('get-mode'),
    setYoloMode: (enabled: boolean) => ipcRenderer.invoke('set-yolo-mode', enabled),
    getYoloMode: () => ipcRenderer.invoke('get-yolo-mode'),
    getModels: () => ipcRenderer.invoke('get-models'),
    getModel: () => ipcRenderer.invoke('get-model'),
    setModel: (modelId: string) => ipcRenderer.invoke('set-model', modelId),
    setCliOptions: (options: any) => ipcRenderer.invoke('set-cli-options', options),
    getCliOptions: () => ipcRenderer.invoke('get-cli-options'),

    // ACP / Workspace
    initAcp: () => ipcRenderer.invoke('init-acp'),
    openWorkspace: () => ipcRenderer.invoke('open-workspace'),
    switchWorkspace: (workspaceId: string, cwd: string) =>
        ipcRenderer.invoke('switch-workspace', workspaceId, cwd),

    // Codex
    checkCodex: () => ipcRenderer.invoke('check-codex'),
    installCodex: () => ipcRenderer.invoke('install-codex'),
    streamCodex: (conversationId: string, prompt: string, conversationHistory?: any[]) =>
        ipcRenderer.invoke('stream-codex', conversationId, prompt, conversationHistory),
    cancelPrompt: (conversationId: string) => ipcRenderer.invoke('cancel-prompt', conversationId),
    debugLog: (msg: string) => ipcRenderer.invoke('debug-log', msg),
    runCodexCommand: (subcommand: string, args: string[], cwd?: string) =>
        ipcRenderer.invoke('run-codex-command', subcommand, args, cwd),
    updateTitleBarOverlay: (color: string, symbolColor: string) =>
        ipcRenderer.invoke('update-title-bar-overlay', color, symbolColor),
    respondToApproval: (requestId: string, approved: boolean) =>
        ipcRenderer.invoke('respond-to-approval', requestId, approved),

    // Auth
    codexLogin: (method?: string, apiKey?: string) => ipcRenderer.invoke('codex-login', method, apiKey),
    codexLogout: () => ipcRenderer.invoke('codex-logout'),
    codexLoginMethods: () => ipcRenderer.invoke('codex-login-methods'),
    getUser: () => ipcRenderer.invoke('get-user'),

    // File System
    searchFiles: (workspacePath: string, query: string) =>
        ipcRenderer.invoke('search-files', workspacePath, query),
    readFileContent: (filePath: string, workspacePath?: string) =>
        ipcRenderer.invoke('read-file-content', filePath, workspacePath),
    writeFile: (filePath: string, content: string, workspacePath?: string) =>
        ipcRenderer.invoke('write-file', filePath, content, workspacePath),
    listDirectory: (dirPath: string, workspacePath?: string) =>
        ipcRenderer.invoke('list-directory', dirPath, workspacePath),
    fileExists: (filePath: string, workspacePath?: string) =>
        ipcRenderer.invoke('file-exists', filePath, workspacePath),
    openInEditor: (filePath: string, editor?: string) =>
        ipcRenderer.invoke('open-in-editor', filePath, editor),

    // Web Search
    webSearch: (query: string) => ipcRenderer.invoke('web-search', query),

    // Shell
    runCommand: (command: string, cwd: string) => ipcRenderer.invoke('run-command', command, cwd),
    killCommand: (commandId: string) => ipcRenderer.invoke('kill-command', commandId),

    // PTY
    pty: {
        create: (cwd?: string, shell?: string) => ipcRenderer.invoke('pty-create', cwd, shell),
        write: (id: string, data: string) => ipcRenderer.invoke('pty-write', id, data),
        kill: (id: string) => ipcRenderer.invoke('pty-kill', id),
        list: () => ipcRenderer.invoke('pty-list'),
        onData: (callback: (id: string, data: string) => void): UnlistenFn =>
            onEvent<{ id: string; data: string }>('pty-data', (p) => callback(p.id, p.data)),
        onExit: (callback: (id: string, exitCode: number) => void): UnlistenFn =>
            onEvent<{ id: string; exitCode: number }>('pty-exit', (p) => callback(p.id, p.exitCode)),
    },

    // Teams
    sendToTeams: (webhookUrl: string, title: string, content: string) =>
        ipcRenderer.invoke('send-to-teams', webhookUrl, title, content),

    // Database
    db: {
        getState: () => ipcRenderer.invoke('db-get-state'),
        createWorkspace: (id: string, name: string, path: string) =>
            ipcRenderer.invoke('db-create-workspace', id, name, path),
        deleteWorkspace: (id: string) => ipcRenderer.invoke('db-delete-workspace', id),
        getConversations: (workspaceId: string) =>
            ipcRenderer.invoke('db-get-conversations', workspaceId),
        createConversation: (id: string, workspaceId: string, title: string) =>
            ipcRenderer.invoke('db-create-conversation', id, workspaceId, title),
        updateConversationTitle: (id: string, title: string) =>
            ipcRenderer.invoke('db-update-conversation-title', id, title),
        deleteConversation: (id: string) => ipcRenderer.invoke('db-delete-conversation', id),
        getMessages: (conversationId: string) =>
            ipcRenderer.invoke('db-get-messages', conversationId),
        createMessage: (message: any) => ipcRenderer.invoke('db-create-message', message),
    },

    // Event Listeners (return cleanup functions)
    onStreamToken: (callback: (cid: string, token: string) => void): UnlistenFn =>
        onEvent<{ cid: string; data: string }>('codex-stream-token', (p) => callback(p.cid, p.data)),
    onStreamDelta: (callback: (cid: string, delta: string) => void): UnlistenFn =>
        onEvent<{ cid: string; data: string }>('codex-stream-delta', (p) => callback(p.cid, p.data)),
    onThinking: (callback: (cid: string, text: string) => void): UnlistenFn =>
        onEvent<{ cid: string; data: string }>('codex-thinking', (p) => callback(p.cid, p.data)),
    onThinkingDelta: (callback: (cid: string, delta: string) => void): UnlistenFn =>
        onEvent<{ cid: string; data: string }>('codex-thinking-delta', (p) => callback(p.cid, p.data)),
    onStreamEnd: (callback: (cid: string) => void): UnlistenFn =>
        onEvent<{ cid: string }>('codex-stream-end', (p) => callback(p.cid)),
    onStreamError: (callback: (cid: string, error: string) => void): UnlistenFn =>
        onEvent<{ cid: string; data: string }>('codex-stream-error', (p) => callback(p.cid, p.data)),
    onMode: (callback: (mode: string) => void): UnlistenFn =>
        onEvent<string>('codex-mode', callback),
    onAcpReady: (callback: (ready: boolean) => void): UnlistenFn =>
        onEvent<boolean>('acp-ready', callback),
    onToolCall: (
        callback: (cid: string, data: { title: string; status: string; output?: string }) => void,
    ): UnlistenFn =>
        onEvent<{ cid: string; title: string; status: string; output?: string }>('codex-tool-call', (p) => {
            const { cid, ...rest } = p;
            callback(cid, rest);
        }),
    onTerminalOutput: (
        callback: (cid: string, data: { terminalId: string; output: string; exitCode: number | null }) => void,
    ): UnlistenFn =>
        onEvent<{ cid: string; terminalId: string; output: string; exitCode: number | null }>(
            'codex-terminal-output',
            (p) => {
                const { cid, ...rest } = p;
                callback(cid, rest);
            },
        ),
    onApprovalRequest: (
        callback: (cid: string, data: { requestId: string; title: string; description: string }) => void,
    ): UnlistenFn =>
        onEvent<{ cid: string; requestId: string; title: string; description: string }>(
            'codex-approval-request',
            (p) => {
                const { cid, ...rest } = p;
                callback(cid, rest);
            },
        ),
    onProgress: (callback: (cid: string, text: string) => void): UnlistenFn =>
        onEvent<{ cid: string; data: string }>('codex-progress', (p) => callback(p.cid, p.data)),
    onCodexInstallProgress: (callback: (data: { status: string; message: string }) => void): UnlistenFn =>
        onEvent<{ status: string; message: string }>('codex-install-progress', callback),
    onCommandOutput: (
        callback: (data: { commandId: string; type: 'stdout' | 'stderr'; data: string }) => void,
    ): UnlistenFn =>
        onEvent<{ commandId: string; type: 'stdout' | 'stderr'; data: string }>('command-output', callback),
});

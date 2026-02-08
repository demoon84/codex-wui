/**
 * Tauri API Bridge Layer
 * 
 * Replaces Electron's window.codexApi with Tauri invoke/listen calls.
 * Provides the same interface so frontend code requires minimal changes.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// ===== Types =====
export type ModelMode = 'planning' | 'fast'
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'

export interface CliOptions {
    profile: string
    sandbox: SandboxMode
    askForApproval: ApprovalPolicy
    skipGitRepoCheck: boolean
    cwdOverride: string
    extraArgs: string
    enableWebSearch: boolean
}

export interface CodexUser {
    id: string
    email: string
    name: string
    picture: string
}

export interface FileSearchResult {
    name: string
    path: string
    relativePath: string
    isDirectory: boolean
}


// ===== Commands (invoke) =====

export async function setMode(mode: ModelMode): Promise<ModelMode> {
    return invoke('set_mode', { mode })
}

export async function getMode(): Promise<ModelMode> {
    return invoke('get_mode')
}

export async function setYoloMode(enabled: boolean): Promise<boolean> {
    return invoke('set_yolo_mode', { enabled })
}

export async function getYoloMode(): Promise<boolean> {
    return invoke('get_yolo_mode')
}

export async function getModels(): Promise<Array<{ id: string; name: string; description: string }>> {
    return invoke('get_models')
}

export async function getModel(): Promise<string> {
    return invoke('get_model')
}

export async function setModel(modelId: string): Promise<string> {
    return invoke('set_model', { modelId })
}

export async function setCliOptions(options: Partial<CliOptions>): Promise<CliOptions> {
    return invoke('set_cli_options', { options })
}

export async function getCliOptions(): Promise<CliOptions> {
    return invoke('get_cli_options')
}

export async function checkCodex(): Promise<{ installed: boolean }> {
    return invoke('check_codex')
}

export async function installCodex(): Promise<{ success: boolean; error?: string }> {
    return invoke('install_codex')
}

export async function initAcp(): Promise<{ success: boolean; error?: string }> {
    return invoke('init_acp')
}

export async function openWorkspace(): Promise<{ path: string; name: string } | null> {
    return invoke('open_workspace')
}

export async function switchWorkspace(workspaceId: string, cwd: string): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    return invoke('switch_workspace', { workspaceId, cwd })
}

export async function streamCodex(conversationId: string, prompt: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void> {
    return invoke('stream_codex', { conversationId, prompt, conversationHistory })
}

export async function debugLog(msg: string): Promise<void> {
    return invoke('debug_log', { msg })
}

export async function cancelPrompt(conversationId: string): Promise<{ success: boolean; error?: string }> {
    return invoke('cancel_prompt', { conversationId })
}

export async function updateTitleBarOverlay(color: string, symbolColor: string): Promise<{ success: boolean; error?: string }> {
    return invoke('update_title_bar_overlay', { color, symbolColor })
}

export async function respondToApproval(requestId: string, approved: boolean): Promise<{ success: boolean }> {
    return invoke('respond_to_approval', { requestId, approved })
}

export async function codexLogin(method?: 'browser' | 'device-auth' | 'api-key', apiKey?: string): Promise<{ success: boolean; user?: CodexUser; error?: string }> {
    return invoke('codex_login', { method, apiKey })
}

export async function codexLogout(): Promise<{ success: boolean; error?: string }> {
    return invoke('codex_logout')
}

export async function codexLoginMethods(): Promise<{ methods: Array<{ id: 'browser' | 'device-auth' | 'api-key'; label: string }> }> {
    return invoke('codex_login_methods')
}

export async function getUser(): Promise<CodexUser | null> {
    return invoke('get_user')
}

// ===== File System =====

export async function searchFiles(workspacePath: string, query: string): Promise<FileSearchResult[]> {
    return invoke('search_files', { workspacePath, query })
}

export async function readFileContent(filePath: string, workspacePath?: string): Promise<{ success: boolean; content?: string; error?: string }> {
    return invoke('read_file_content', { filePath, workspacePath })
}

export async function writeFile(filePath: string, content: string, workspacePath?: string): Promise<{ success: boolean; error?: string }> {
    return invoke('write_file', { filePath, content, workspacePath })
}

export async function listDirectory(dirPath: string, workspacePath?: string): Promise<{ success: boolean; entries?: Array<{ name: string; path: string; isDirectory: boolean; size: number }>; error?: string }> {
    return invoke('list_directory', { dirPath, workspacePath })
}

export async function fileExists(filePath: string, workspacePath?: string): Promise<boolean> {
    return invoke('file_exists', { filePath, workspacePath })
}

export async function openInEditor(filePath: string, editor?: string): Promise<{ success: boolean; editor?: string; error?: string }> {
    return invoke('open_in_editor', { filePath, editor })
}

// ===== Terminal =====

export async function runCommand(command: string, cwd: string): Promise<{ success: boolean; commandId: string; output?: string; errorOutput?: string; exitCode?: number; error?: string }> {
    return invoke('run_command', { command, cwd })
}

export async function runCodexCommand(subcommand: string, args: string[], cwd?: string): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; error?: string }> {
    return invoke('run_codex_command', { subcommand, args, cwd })
}

export async function killCommand(commandId: string): Promise<{ success: boolean; error?: string }> {
    return invoke('kill_command', { commandId })
}

// ===== Teams Integration =====

export async function sendToTeams(webhookUrl: string, title: string, content: string): Promise<{ success: boolean; status?: number; error?: string }> {
    return invoke('send_to_teams', { webhookUrl, title, content })
}



// ===== PTY Terminal =====

export const pty = {
    create: (cwd?: string, shell?: string): Promise<{ id: string; shell: string }> =>
        invoke('pty_create', { cwd, shell }),
    write: (id: string, data: string): Promise<{ success: boolean; error?: string }> =>
        invoke('pty_write', { id, data }),
    kill: (id: string): Promise<{ success: boolean; error?: string }> =>
        invoke('pty_kill', { id }),
    list: (): Promise<string[]> =>
        invoke('pty_list'),
    onData: (callback: (id: string, data: string) => void): Promise<UnlistenFn> =>
        listen<{ id: string; data: string }>('pty-data', (event) => callback(event.payload.id, event.payload.data)),
    onExit: (callback: (id: string, exitCode: number) => void): Promise<UnlistenFn> =>
        listen<{ id: string; exitCode: number }>('pty-exit', (event) => callback(event.payload.id, event.payload.exitCode)),
}

// ===== Web Search =====

export async function webSearch(query: string): Promise<{ success: boolean; results: Array<{ title: string; url: string; snippet: string }>; error?: string }> {
    return invoke('web_search', { query })
}

// ===== Database =====

export const db = {
    getState: (): Promise<{ workspaces: any[] }> =>
        invoke('db_get_state'),
    createWorkspace: (id: string, name: string, path: string) =>
        invoke('db_create_workspace', { id, name, workspacePath: path }),
    deleteWorkspace: (id: string) =>
        invoke('db_delete_workspace', { id }),
    getConversations: (workspaceId: string) =>
        invoke('db_get_conversations', { workspaceId }),
    createConversation: (id: string, workspaceId: string, title: string) =>
        invoke('db_create_conversation', { id, workspaceId, title }),
    updateConversationTitle: (id: string, title: string) =>
        invoke('db_update_conversation_title', { id, title }),
    deleteConversation: (id: string) =>
        invoke('db_delete_conversation', { id }),
    getMessages: (conversationId: string) =>
        invoke('db_get_messages', { conversationId }),
    createMessage: (message: { id: string; conversationId: string; role: string; content: string; thinking?: string; thinkingDuration?: number; timestamp: string }) =>
        invoke('db_create_message', { message }),
}

// ===== Events (listen) =====
// These return UnlistenFn for cleanup in useEffect

export function onStreamToken(callback: (cid: string, token: string) => void): Promise<UnlistenFn> {
    return listen<{ cid: string; data: string }>('codex-stream-token', (event) => callback(event.payload.cid, event.payload.data))
}

export function onStreamDelta(callback: (cid: string, delta: string) => void): Promise<UnlistenFn> {
    return listen<{ cid: string; data: string }>('codex-stream-delta', (event) => callback(event.payload.cid, event.payload.data))
}

export function onThinking(callback: (cid: string, text: string) => void): Promise<UnlistenFn> {
    return listen<{ cid: string; data: string }>('codex-thinking', (event) => callback(event.payload.cid, event.payload.data))
}

export function onThinkingDelta(callback: (cid: string, delta: string) => void): Promise<UnlistenFn> {
    return listen<{ cid: string; data: string }>('codex-thinking-delta', (event) => callback(event.payload.cid, event.payload.data))
}

export function onStreamEnd(callback: (cid: string) => void): Promise<UnlistenFn> {
    return listen<{ cid: string }>('codex-stream-end', (event) => callback(event.payload.cid))
}

export function onStreamError(callback: (cid: string, error: string) => void): Promise<UnlistenFn> {
    return listen<{ cid: string; data: string }>('codex-stream-error', (event) => callback(event.payload.cid, event.payload.data))
}

export function onMode(callback: (mode: ModelMode) => void): Promise<UnlistenFn> {
    return listen<ModelMode>('codex-mode', (event) => callback(event.payload))
}

export function onAcpReady(callback: (ready: boolean) => void): Promise<UnlistenFn> {
    return listen<boolean>('acp-ready', (event) => callback(event.payload))
}

export function onToolCall(callback: (cid: string, data: { title: string; status: string; output?: string }) => void): Promise<UnlistenFn> {
    return listen<{ cid: string; title: string; status: string; output?: string }>('codex-tool-call', (event) => {
        const { cid, ...rest } = event.payload
        callback(cid, rest)
    })
}

export function onTerminalOutput(callback: (cid: string, data: { terminalId: string; output: string; exitCode: number | null }) => void): Promise<UnlistenFn> {
    return listen<{ cid: string; terminalId: string; output: string; exitCode: number | null }>('codex-terminal-output', (event) => {
        const { cid, ...rest } = event.payload
        callback(cid, rest)
    })
}

export function onApprovalRequest(callback: (cid: string, data: { requestId: string; title: string; description: string }) => void): Promise<UnlistenFn> {
    return listen<{ cid: string; requestId: string; title: string; description: string }>('codex-approval-request', (event) => {
        const { cid, ...rest } = event.payload
        callback(cid, rest)
    })
}

export function onProgress(callback: (cid: string, text: string) => void): Promise<UnlistenFn> {
    return listen<{ cid: string; data: string }>('codex-progress', (event) => callback(event.payload.cid, event.payload.data))
}

export function onCodexInstallProgress(callback: (data: { status: string; message: string }) => void): Promise<UnlistenFn> {
    return listen<{ status: string; message: string }>('codex-install-progress', (event) => callback(event.payload))
}

export function onCommandOutput(callback: (data: { commandId: string; type: 'stdout' | 'stderr'; data: string }) => void): Promise<UnlistenFn> {
    return listen<{ commandId: string; type: 'stdout' | 'stderr'; data: string }>('command-output', (event) => callback(event.payload))
}



// ===== Convenience: codexApi-compatible object =====
// For minimal diff in App.tsx, export as a single object
export const codexApi = {
    setMode,
    getMode,
    setYoloMode,
    getYoloMode,
    getModels,
    getModel,
    setModel,
    setCliOptions,
    getCliOptions,
    checkCodex,
    installCodex,
    initAcp,
    openWorkspace,
    switchWorkspace,
    streamCodex,
    debugLog,
    cancelPrompt,
    updateTitleBarOverlay,
    respondToApproval,
    codexLogin,
    codexLogout,
    codexLoginMethods,
    getUser,
    searchFiles,
    readFileContent,
    writeFile,
    listDirectory,
    fileExists,
    openInEditor,
    runCommand,
    runCodexCommand,
    killCommand,
    sendToTeams,
    pty,
    webSearch,
    db,
    // Event listeners
    onStreamToken,
    onStreamDelta,
    onThinking,
    onThinkingDelta,
    onStreamEnd,
    onStreamError,
    onMode,
    onAcpReady,
    onToolCall,
    onTerminalOutput,
    onApprovalRequest,
    onProgress,
    onCodexInstallProgress,
    onCommandOutput,
}

export default codexApi

/**
 * Electron API Bridge Layer
 *
 * Replaces the Tauri API bridge. All calls go through window.codexApi
 * which is exposed by the Electron preload script via contextBridge.
 */

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

type UnlistenFn = () => void

// ===== Get codexApi from preload =====
const api = () => (window as any).codexApi

// ===== Commands =====

export async function setMode(mode: ModelMode): Promise<ModelMode> {
    return api().setMode(mode)
}

export async function getMode(): Promise<ModelMode> {
    return api().getMode()
}

export async function setYoloMode(enabled: boolean): Promise<boolean> {
    return api().setYoloMode(enabled)
}

export async function getYoloMode(): Promise<boolean> {
    return api().getYoloMode()
}

export async function getModels(): Promise<Array<{ id: string; name: string; description: string }>> {
    return api().getModels()
}

export async function getModel(): Promise<string> {
    return api().getModel()
}

export async function setModel(modelId: string): Promise<string> {
    return api().setModel(modelId)
}

export async function setCliOptions(options: Partial<CliOptions>): Promise<CliOptions> {
    return api().setCliOptions(options)
}

export async function getCliOptions(): Promise<CliOptions> {
    return api().getCliOptions()
}

export async function checkCodex(): Promise<{ installed: boolean }> {
    return api().checkCodex()
}

export async function installCodex(): Promise<{ success: boolean; error?: string }> {
    return api().installCodex()
}

export async function initAcp(): Promise<{ success: boolean; error?: string }> {
    return api().initAcp()
}

export async function openWorkspace(): Promise<{ path: string; name: string } | null> {
    return api().openWorkspace()
}

export async function switchWorkspace(workspaceId: string, cwd: string): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    return api().switchWorkspace(workspaceId, cwd)
}

export async function streamCodex(conversationId: string, prompt: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void> {
    return api().streamCodex(conversationId, prompt, conversationHistory)
}

export async function debugLog(msg: string): Promise<void> {
    return api().debugLog(msg)
}

export async function cancelPrompt(conversationId: string): Promise<{ success: boolean; error?: string }> {
    return api().cancelPrompt(conversationId)
}

export async function updateTitleBarOverlay(color: string, symbolColor: string): Promise<{ success: boolean; error?: string }> {
    return api().updateTitleBarOverlay(color, symbolColor)
}

export async function respondToApproval(requestId: string, approved: boolean): Promise<{ success: boolean }> {
    return api().respondToApproval(requestId, approved)
}

export async function codexLogin(method?: 'browser' | 'device-auth' | 'api-key', apiKey?: string): Promise<{ success: boolean; user?: CodexUser; error?: string }> {
    return api().codexLogin(method, apiKey)
}

export async function codexLogout(): Promise<{ success: boolean; error?: string }> {
    return api().codexLogout()
}

export async function codexLoginMethods(): Promise<{ methods: Array<{ id: 'browser' | 'device-auth' | 'api-key'; label: string }> }> {
    return api().codexLoginMethods()
}

export async function getUser(): Promise<CodexUser | null> {
    return api().getUser()
}

// ===== File System =====

export async function searchFiles(workspacePath: string, query: string): Promise<FileSearchResult[]> {
    return api().searchFiles(workspacePath, query)
}

export async function readFileContent(filePath: string, workspacePath?: string): Promise<{ success: boolean; content?: string; error?: string }> {
    return api().readFileContent(filePath, workspacePath)
}

export async function writeFile(filePath: string, content: string, workspacePath?: string): Promise<{ success: boolean; error?: string }> {
    return api().writeFile(filePath, content, workspacePath)
}

export async function listDirectory(dirPath: string, workspacePath?: string): Promise<{ success: boolean; entries?: Array<{ name: string; path: string; isDirectory: boolean; size: number }>; error?: string }> {
    return api().listDirectory(dirPath, workspacePath)
}

export async function fileExists(filePath: string, workspacePath?: string): Promise<boolean> {
    return api().fileExists(filePath, workspacePath)
}

export async function openInEditor(filePath: string, editor?: string): Promise<{ success: boolean; editor?: string; error?: string }> {
    return api().openInEditor(filePath, editor)
}

// ===== Terminal =====

export async function runCommand(command: string, cwd: string): Promise<{ success: boolean; commandId: string; output?: string; errorOutput?: string; exitCode?: number; error?: string }> {
    return api().runCommand(command, cwd)
}

export async function runCodexCommand(subcommand: string, args: string[], cwd?: string): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; error?: string }> {
    return api().runCodexCommand(subcommand, args, cwd)
}

export async function killCommand(commandId: string): Promise<{ success: boolean; error?: string }> {
    return api().killCommand(commandId)
}

// ===== Teams Integration =====

export async function sendToTeams(webhookUrl: string, title: string, content: string): Promise<{ success: boolean; status?: number; error?: string }> {
    return api().sendToTeams(webhookUrl, title, content)
}

// ===== PTY Terminal =====

export const pty = {
    create: (cwd?: string, shell?: string): Promise<{ id: string; shell: string }> =>
        api().pty.create(cwd, shell),
    write: (id: string, data: string): Promise<{ success: boolean; error?: string }> =>
        api().pty.write(id, data),
    kill: (id: string): Promise<{ success: boolean; error?: string }> =>
        api().pty.kill(id),
    list: (): Promise<string[]> =>
        api().pty.list(),
    onData: (callback: (id: string, data: string) => void): UnlistenFn =>
        api().pty.onData(callback),
    onExit: (callback: (id: string, exitCode: number) => void): UnlistenFn =>
        api().pty.onExit(callback),
}

// ===== Web Search =====

export async function webSearch(query: string): Promise<{ success: boolean; results: Array<{ title: string; url: string; snippet: string }>; error?: string }> {
    return api().webSearch(query)
}

// ===== Database =====

export const db = {
    getState: (): Promise<{ workspaces: any[] }> =>
        api().db.getState(),
    createWorkspace: (id: string, name: string, path: string) =>
        api().db.createWorkspace(id, name, path),
    deleteWorkspace: (id: string) =>
        api().db.deleteWorkspace(id),
    updateWorkspaceName: (id: string, name: string) =>
        api().db.updateWorkspaceName(id, name),
    getConversations: (workspaceId: string) =>
        api().db.getConversations(workspaceId),
    createConversation: (id: string, workspaceId: string, title: string) =>
        api().db.createConversation(id, workspaceId, title),
    updateConversationTitle: (id: string, title: string) =>
        api().db.updateConversationTitle(id, title),
    deleteConversation: (id: string) =>
        api().db.deleteConversation(id),
    getMessages: (conversationId: string) =>
        api().db.getMessages(conversationId),
    createMessage: (message: { id: string; conversationId: string; role: string; content: string; thinking?: string; thinkingDuration?: number; timestamp: string }) =>
        api().db.createMessage(message),
}

// ===== Events =====

export function onStreamToken(callback: (cid: string, token: string) => void): UnlistenFn {
    return api().onStreamToken(callback)
}

export function onStreamDelta(callback: (cid: string, delta: string) => void): UnlistenFn {
    return api().onStreamDelta(callback)
}

export function onThinking(callback: (cid: string, text: string) => void): UnlistenFn {
    return api().onThinking(callback)
}

export function onThinkingDelta(callback: (cid: string, delta: string) => void): UnlistenFn {
    return api().onThinkingDelta(callback)
}

export function onStreamEnd(callback: (cid: string) => void): UnlistenFn {
    return api().onStreamEnd(callback)
}

export function onStreamError(callback: (cid: string, error: string) => void): UnlistenFn {
    return api().onStreamError(callback)
}

export function onMode(callback: (mode: ModelMode) => void): UnlistenFn {
    return api().onMode(callback)
}

export function onAcpReady(callback: (ready: boolean) => void): UnlistenFn {
    return api().onAcpReady(callback)
}

export function onToolCall(callback: (cid: string, data: { title: string; status: string; output?: string }) => void): UnlistenFn {
    return api().onToolCall(callback)
}

export function onTerminalOutput(callback: (cid: string, data: { terminalId: string; output: string; exitCode: number | null }) => void): UnlistenFn {
    return api().onTerminalOutput(callback)
}

export function onApprovalRequest(callback: (cid: string, data: { requestId: string; title: string; description: string }) => void): UnlistenFn {
    return api().onApprovalRequest(callback)
}

export function onProgress(callback: (cid: string, text: string) => void): UnlistenFn {
    return api().onProgress(callback)
}

export function onCodexInstallProgress(callback: (data: { status: string; message: string }) => void): UnlistenFn {
    return api().onCodexInstallProgress(callback)
}

export function onCommandOutput(callback: (data: { commandId: string; type: 'stdout' | 'stderr'; data: string }) => void): UnlistenFn {
    return api().onCommandOutput(callback)
}

// ===== Convenience codexApi-compatible object =====
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

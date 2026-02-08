/// <reference types="vite/client" />

// Shared type definitions for the Codex UI application
// These types are used by the API layer and components

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

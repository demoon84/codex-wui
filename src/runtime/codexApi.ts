import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

type ModelMode = 'planning' | 'fast'
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'

type CliOptions = {
  profile: string
  sandbox: SandboxMode
  askForApproval: ApprovalPolicy
  skipGitRepoCheck: boolean
  cwdOverride: string
  extraArgs: string
  enableWebSearch: boolean
}

const DEFAULT_CLI_OPTIONS: CliOptions = {
  profile: '',
  sandbox: 'workspace-write',
  askForApproval: 'on-request',
  skipGitRepoCheck: true,
  cwdOverride: '',
  extraArgs: '',
  enableWebSearch: false,
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function bridgeEvent<T>(name: string, callback: (payload: T) => void) {
  await listen<T>(name, (event) => callback(event.payload))
}

export async function setupRuntimeCodexApi(): Promise<void> {
  if (typeof window === 'undefined' || (window as any).codexApi || !isTauriRuntime()) {
    return
  }

  ; (window as any).codexApi = {
    setMode: (mode: ModelMode) => invoke<ModelMode>('set_mode', { mode }),
    getMode: () => invoke<ModelMode>('get_mode'),
    setYoloMode: (enabled: boolean) => invoke<boolean>('set_yolo_mode', { enabled }),
    getYoloMode: () => invoke<boolean>('get_yolo_mode'),
    getModels: () => invoke<Array<{ id: string; name: string; description: string }>>('get_models'),
    getModel: () => invoke<string>('get_model'),
    setModel: (modelId: string) => invoke<string>('set_model', { model_id: modelId }),
    setCliOptions: (options: Partial<CliOptions>) => invoke<CliOptions>('set_cli_options', { options }),
    getCliOptions: () => invoke<CliOptions>('get_cli_options'),

    checkCodex: () => invoke<{ installed: boolean }>('check_codex'),
    installCodex: () => invoke<{ success: boolean; error?: string }>('install_codex'),
    onCodexInstallProgress: (callback: (data: { status: string; message: string }) => void) => {
      void bridgeEvent('codex-install-progress', callback)
    },

    initAcp: () => invoke<{ success: boolean; error?: string }>('init_acp'),
    openWorkspace: () => invoke<{ path: string; name: string } | null>('open_workspace'),
    switchWorkspace: (workspaceId: string, cwd: string) =>
      invoke<{ success: boolean; sessionId?: string; error?: string }>('switch_workspace', { workspace_id: workspaceId, cwd }),

    streamCodex: (conversationId: string, prompt: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>) =>
      invoke<void>('stream_codex', { conversation_id: conversationId, prompt, conversation_history: conversationHistory }),
    cancelPrompt: (conversationId: string) => invoke<{ success: boolean; error?: string }>('cancel_prompt', { conversation_id: conversationId }),

    updateTitleBarOverlay: (color: string, symbolColor: string) =>
      invoke('update_title_bar_overlay', { color, symbol_color: symbolColor }),

    onStreamToken: (callback: (cid: string, token: string) => void) => {
      void bridgeEvent<{ cid: string; data: string }>('codex-stream-token', (p) => callback(p.cid, p.data))
    },
    onStreamDelta: (callback: (cid: string, delta: string) => void) => {
      void bridgeEvent<{ cid: string; data: string }>('codex-stream-delta', (p) => callback(p.cid, p.data))
    },
    onThinking: (callback: (cid: string, text: string) => void) => {
      void bridgeEvent<{ cid: string; data: string }>('codex-thinking', (p) => callback(p.cid, p.data))
    },
    onThinkingDelta: (callback: (cid: string, delta: string) => void) => {
      void bridgeEvent<{ cid: string; data: string }>('codex-thinking-delta', (p) => callback(p.cid, p.data))
    },
    onStreamEnd: (callback: (cid: string) => void) => {
      void bridgeEvent<{ cid: string }>('codex-stream-end', (p) => callback(p.cid))
    },
    onStreamError: (callback: (cid: string, error: string) => void) => {
      void bridgeEvent<{ cid: string; data: string }>('codex-stream-error', (p) => callback(p.cid, p.data))
    },
    onMode: (callback: (mode: ModelMode) => void) => {
      void bridgeEvent<ModelMode>('codex-mode', callback)
    },
    onAcpReady: (callback: (ready: boolean) => void) => {
      void bridgeEvent<boolean>('acp-ready', callback)
    },
    onToolCall: (callback: (cid: string, data: { title: string; status: string; output?: string }) => void) => {
      void bridgeEvent<{ cid: string; title: string; status: string; output?: string }>('codex-tool-call', (p) => {
        const { cid, ...rest } = p
        callback(cid, rest)
      })
    },
    onTerminalOutput: (callback: (cid: string, data: { terminalId: string; output: string; exitCode: number | null }) => void) => {
      void bridgeEvent<{ cid: string; terminalId: string; output: string; exitCode: number | null }>('codex-terminal-output', (p) => {
        const { cid, ...rest } = p
        callback(cid, rest)
      })
    },
    onApprovalRequest: (callback: (cid: string, data: { requestId: string; title: string; description: string }) => void) => {
      void bridgeEvent<{ cid: string; requestId: string; title: string; description: string }>('codex-approval-request', (p) => {
        const { cid, ...rest } = p
        callback(cid, rest)
      })
    },
    onProgress: (callback: (cid: string, text: string) => void) => {
      void bridgeEvent<{ cid: string; data: string }>('codex-progress', (p) => callback(p.cid, p.data))
    },
    respondToApproval: (requestId: string, approved: boolean) =>
      invoke('respond_to_approval', { request_id: requestId, approved }),

    db: {
      getState: () => invoke('db_get_state'),
      createWorkspace: (id: string, name: string, path: string) => invoke('db_create_workspace', { id, name, workspace_path: path }),
      deleteWorkspace: (id: string) => invoke('db_delete_workspace', { id }),
      getConversations: (workspaceId: string) => invoke('db_get_conversations', { workspace_id: workspaceId }),
      createConversation: (id: string, workspaceId: string, title: string) => invoke('db_create_conversation', { id, workspace_id: workspaceId, title }),
      updateConversationTitle: (id: string, title: string) => invoke('db_update_conversation_title', { id, title }),
      deleteConversation: (id: string) => invoke('db_delete_conversation', { id }),
      getMessages: (conversationId: string) => invoke('db_get_messages', { conversation_id: conversationId }),
      createMessage: (message: { id: string; conversationId: string; role: string; content: string; thinking?: string; thinkingDuration?: number; timestamp: string }) =>
        invoke('db_create_message', { message }),
    },

    codexLogin: (method?: 'browser' | 'device-auth' | 'api-key', apiKey?: string) =>
      invoke<{ success: boolean; user?: { id: string; email: string; name: string; picture: string; authMode?: string; authProvider?: string }; error?: string }>('codex_login', { method, api_key: apiKey }),
    codexLogout: () => invoke<{ success: boolean; error?: string }>('codex_logout'),
    codexLoginMethods: () => invoke<{ methods: Array<{ id: 'browser' | 'device-auth' | 'api-key'; label: string }> }>('codex_login_methods'),
    getUser: () => invoke<{ id: string; email: string; name: string; picture: string; authMode?: string; authProvider?: string } | null>('get_user'),

    searchFiles: (workspacePath: string, query: string) => invoke('search_files', { workspace_path: workspacePath, query }),
    readFileContent: (filePath: string, workspacePath?: string) =>
      invoke('read_file_content', { file_path: filePath, workspace_path: workspacePath }),
    writeFile: (filePath: string, content: string, workspacePath?: string) =>
      invoke('write_file', { file_path: filePath, content, workspace_path: workspacePath }),
    listDirectory: (dirPath: string, workspacePath?: string) =>
      invoke('list_directory', { dir_path: dirPath, workspace_path: workspacePath }),
    fileExists: (filePath: string, workspacePath?: string) =>
      invoke('file_exists', { file_path: filePath, workspace_path: workspacePath }),

    runCommand: (command: string, cwd: string) => invoke('run_command', { command, cwd }),
    runCodexCommand: (subcommand: string, args: string[], cwd?: string) => invoke('run_codex_command', { subcommand, args, cwd }),
    killCommand: (commandId: string) => invoke('kill_command', { command_id: commandId }),
    appServerOpen: (cwd?: string, args?: string[]) => invoke('app_server_open', { cwd, args }),
    appServerClose: (sessionId: string) => invoke('app_server_close', { session_id: sessionId }),
    appServerListSessions: () => invoke('app_server_list_sessions'),
    appServerRequest: (sessionId: string, method: string, params?: Record<string, unknown> | null, timeoutMs?: number) =>
      invoke('app_server_request', { session_id: sessionId, method, params: params ?? null, timeout_ms: timeoutMs }),
    onCommandOutput: (callback: (data: { commandId: string; type: 'stdout' | 'stderr'; data: string }) => void) => {
      void bridgeEvent('command-output', callback)
    },
    onAppServerNotification: (callback: (data: { sessionId: string; message: any }) => void) => {
      void bridgeEvent('app-server-notification', callback)
    },
    onAppServerLog: (callback: (data: { sessionId: string; stream: 'stdout' | 'stderr'; line: string }) => void) => {
      void bridgeEvent('app-server-log', callback)
    },
    onAppServerExit: (callback: (data: { sessionId: string; exitCode?: number | null }) => void) => {
      void bridgeEvent('app-server-exit', callback)
    },

    pty: {
      create: (cwd?: string, shell?: string) => invoke<{ id: string; shell: string }>('pty_create', { cwd, shell }),
      write: (id: string, data: string) => invoke<{ success: boolean; error?: string }>('pty_write', { id, data }),
      kill: (id: string) => invoke<{ success: boolean; error?: string }>('pty_kill', { id }),
      list: () => invoke<string[]>('pty_list'),
      onData: (callback: (id: string, data: string) => void) => {
        void bridgeEvent<{ id: string; data: string }>('pty-data', (payload) => callback(payload.id, payload.data))
      },
      onExit: (callback: (id: string, exitCode: number) => void) => {
        void bridgeEvent<{ id: string; exitCode: number }>('pty-exit', (payload) => callback(payload.id, payload.exitCode))
      },
    },

    webSearch: (query: string) => invoke('web_search', { query }),
  }

  await (window as any).codexApi.setCliOptions(DEFAULT_CLI_OPTIONS)
}

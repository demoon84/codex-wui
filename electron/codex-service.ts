import { spawn, ChildProcess } from 'node:child_process'

export type ModelMode = 'planning' | 'fast'
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'

export interface CodexCliOptions {
    profile: string
    sandbox: SandboxMode
    askForApproval: ApprovalPolicy
    skipGitRepoCheck: boolean
    cwdOverride: string
    extraArgs: string
    enableWebSearch: boolean
}

// Available Codex models
export const CODEX_MODELS = [
    { id: 'codex', name: 'GPT-5.3-Codex', description: 'Most capable coding model' },
    { id: 'o3', name: 'O3', description: 'Advanced reasoning model' },
    { id: 'o4-mini', name: 'O4.1-mini', description: 'Fast and efficient' },
    { id: 'gpt-4.1', name: 'GPT-4.1', description: 'General purpose model' },
]

export interface StreamCallbacks {
    onThinking?: (text: string) => void
    onThinkingDelta?: (delta: string) => void  // Real-time thinking tokens
    onContent?: (text: string) => void
    onContentDelta?: (delta: string) => void   // Real-time content tokens
    onToolCall?: (title: string, status: string, output?: string) => void
    onTerminalOutput?: (terminalId: string, output: string, exitCode: number | null) => void
    onError?: (error: Error) => void
    onComplete?: () => void
    onApprovalRequest?: (title: string, description: string, resolve: (approved: boolean) => void) => void
    onUsage?: (usage: { inputTokens: number; outputTokens: number; cachedTokens: number }) => void
    onProgress?: (text: string) => void  // Terminal-style progress info from stderr
}

interface CodexEvent {
    type: string
    content?: string
    tool?: string
    status?: string
    output?: string
    [key: string]: any
}

export class CodexService {
    private process: ChildProcess | null = null
    private currentCwd: string = process.cwd()
    private currentMode: ModelMode = 'fast'
    private currentModel: string = '' // Empty = use Codex default
    private yoloMode: boolean = true
    private cliOptions: CodexCliOptions = {
        profile: '',
        sandbox: 'workspace-write',
        askForApproval: 'on-request',
        skipGitRepoCheck: true,
        cwdOverride: '',
        extraArgs: '',
        enableWebSearch: false
    }
    private callbacks: StreamCallbacks = {}

    setMode(mode: ModelMode) {
        this.currentMode = mode
    }

    getMode(): ModelMode {
        return this.currentMode
    }

    getCwd(): string {
        return this.currentCwd
    }

    // Model selection
    setModel(modelId: string) {
        this.currentModel = modelId
        console.log(`[Codex] Model set to: ${modelId}`)
    }

    getModel(): string {
        return this.currentModel
    }

    getAvailableModels() {
        return CODEX_MODELS
    }

    setYoloMode(enabled: boolean) {
        this.yoloMode = enabled
        console.log(`[Codex] YOLO mode: ${enabled ? 'ON' : 'OFF'}`)
    }

    isYoloMode(): boolean {
        return this.yoloMode
    }

    setCallbacks(callbacks: StreamCallbacks) {
        this.callbacks = callbacks
    }

    setCliOptions(options: Partial<CodexCliOptions>) {
        this.cliOptions = {
            ...this.cliOptions,
            ...options
        }
        console.log('[Codex] CLI options updated:', this.cliOptions)
    }

    getCliOptions(): CodexCliOptions {
        return { ...this.cliOptions }
    }

    async initialize(cwd?: string): Promise<boolean> {
        this.currentCwd = cwd || process.cwd()
        console.log(`[Codex] Initialized with cwd: ${this.currentCwd}`)
        return true
    }

    async switchWorkspace(workspaceId: string, cwd: string): Promise<string | null> {
        this.currentCwd = cwd
        console.log(`[Codex] Switched workspace to: ${cwd}`)
        return workspaceId
    }

    async warmup(): Promise<void> {
        // Codex doesn't need warmup like ACP
        console.log('[Codex] Warmup: Ready')
    }

    // Maximum number of previous messages to include as context
    private readonly MAX_CONTEXT_MESSAGES = 10

    async prompt(text: string, callbacks: StreamCallbacks, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<void> {
        this.callbacks = callbacks

        // Build context from conversation history
        let fullPrompt = text
        if (conversationHistory && conversationHistory.length > 0) {
            // Take last N messages
            const recentHistory = conversationHistory.slice(-this.MAX_CONTEXT_MESSAGES)
            const contextParts = recentHistory.map(msg =>
                `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
            )
            fullPrompt = `[Previous conversation]\n${contextParts.join('\n')}\n\n[Current question]\n${text}`
            console.log(`[Codex] Including ${recentHistory.length} previous messages as context`)
        }

        // Build command arguments
        const args = ['exec', '--json']

        // Add model selection (only if explicitly set)
        if (this.currentModel) {
            args.push('-m', this.currentModel)
        }

        // Apply optional profile
        if (this.cliOptions.profile.trim()) {
            args.push('-p', this.cliOptions.profile.trim())
        }

        // Add YOLO mode if enabled
        if (this.yoloMode) {
            // Full access: bypass all approvals and sandbox
            args.push('--dangerously-bypass-approvals-and-sandbox')
        } else {
            args.push('-s', this.cliOptions.sandbox)
            args.push('-a', this.cliOptions.askForApproval)
        }

        if (this.cliOptions.enableWebSearch) {
            args.push('--search')
        }

        // Set working directory
        const runCwd = this.cliOptions.cwdOverride.trim() || this.currentCwd
        args.push('-C', runCwd)

        // Skip git repo check (optional)
        if (this.cliOptions.skipGitRepoCheck) {
            args.push('--skip-git-repo-check')
        }

        // Append any raw extra args from advanced mode
        const parsedExtraArgs = this.parseExtraArgs(this.cliOptions.extraArgs)
        if (parsedExtraArgs.length > 0) {
            args.push(...parsedExtraArgs)
        }

        // Use '-' to read prompt from stdin (avoids command line encoding issues)
        args.push('-')

        console.log(`[Codex] Executing: codex ${args.join(' ')}`)

        try {
            this.process = spawn('codex', args, {
                shell: true,
                cwd: runCwd,
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                    LANG: 'en_US.UTF-8',
                    CHCP: '65001'
                },
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true
            })

            // Send prompt via stdin to avoid encoding issues
            if (this.process.stdin) {
                this.process.stdin.write(fullPrompt, 'utf-8')
                this.process.stdin.end()
            }

            let buffer = ''

            this.process.stdout?.on('data', (data: Buffer) => {
                buffer += data.toString('utf-8')

                // Parse JSONL events
                const lines = buffer.split('\n')
                buffer = lines.pop() || '' // Keep incomplete line in buffer

                for (const line of lines) {
                    if (!line.trim()) continue
                    try {
                        const event: CodexEvent = JSON.parse(line)
                        this.handleEvent(event)
                    } catch (e) {
                        // Not JSON, treat as raw output
                        console.log('[Codex] Raw output:', line)
                        callbacks.onContent?.(line + '\n')
                    }
                }
            })

            this.process.stderr?.on('data', (data: Buffer) => {
                const rawText = data.toString('utf-8')
                console.log('[Codex] stderr:', rawText)

                // Clean up ANSI escape codes and control characters
                const cleanText = rawText
                    .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')  // ANSI escape sequences
                    .replace(/\x1B\].*?\x07/g, '')          // OSC sequences
                    .replace(/\r/g, '\n')                    // Carriage returns to newlines
                    .replace(/\*+/g, ' ')                    // Spinner characters
                    .replace(/\n{2,}/g, '\n')               // Multiple newlines to single
                    .trim()

                // Forward cleaned progress info
                if (cleanText) {
                    callbacks.onProgress?.(cleanText)
                }
            })

            this.process.on('close', (code: number | null) => {
                console.log(`[Codex] Process closed with code: ${code}`)
                if (code === 0) {
                    callbacks.onComplete?.()
                } else {
                    callbacks.onError?.(new Error(`Codex exited with code ${code}`))
                }
            })

            this.process.on('error', (err: Error) => {
                console.error('[Codex] Process error:', err)
                callbacks.onError?.(err)
            })

        } catch (error) {
            callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
        }
    }

    private parseExtraArgs(raw: string): string[] {
        const input = raw.trim()
        if (!input) return []

        const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
        return matches.map(token => token.replace(/^['"]|['"]$/g, ''))
    }

    private handleEvent(event: CodexEvent) {
        console.log('[Codex] Event:', event.type)

        switch (event.type) {
            // Real-time streaming - tokens as they're generated
            case 'item.streaming':
                if (event.item) {
                    // Send delta text for real-time display
                    const delta = event.item.delta?.text || event.delta?.text || ''
                    if (delta) {
                        if (event.item.type === 'reasoning') {
                            this.callbacks.onThinkingDelta?.(delta)
                        } else {
                            this.callbacks.onContentDelta?.(delta)
                        }
                    }
                }
                break

            // Codex uses item.completed for both thinking and messages
            case 'item.completed':
                if (event.item) {
                    // Codex reasoning is actually the main response content
                    if (event.item.type === 'reasoning' || event.item.type === 'agent_message' || event.item.type === 'message') {
                        this.callbacks.onContent?.(event.item.text || '')
                    } else if (event.item.type === 'tool_call') {
                        this.callbacks.onToolCall?.(
                            event.item.name || 'Tool',
                            'done',
                            event.item.output || undefined
                        )
                    }
                }
                break

            // Ignore thread/turn lifecycle events
            case 'thread.started':
            case 'turn.started':
                break

            case 'turn.completed':
                // Extract usage information
                if (event.usage) {
                    this.callbacks.onUsage?.({
                        inputTokens: event.usage.input_tokens || 0,
                        outputTokens: event.usage.output_tokens || 0,
                        cachedTokens: event.usage.cached_input_tokens || 0
                    })
                }
                break

            case 'thinking':
            case 'thought':
                this.callbacks.onThinking?.(event.content || '')
                break

            case 'message':
            case 'content':
            case 'text':
                this.callbacks.onContent?.(event.content || '')
                break

            case 'tool_call':
            case 'tool_start':
                this.callbacks.onToolCall?.(
                    event.tool || event.name || 'Tool',
                    'running',
                    event.input || undefined
                )
                break

            case 'tool_result':
            case 'tool_end':
                this.callbacks.onToolCall?.(
                    event.tool || event.name || 'Tool',
                    'done',
                    event.output || event.result || undefined
                )
                break

            case 'terminal_output':
            case 'shell':
                this.callbacks.onTerminalOutput?.(
                    event.id || 'terminal',
                    event.output || event.content || '',
                    event.exit_code ?? null
                )
                break

            case 'approval_request':
                if (!this.yoloMode && this.callbacks.onApprovalRequest) {
                    this.callbacks.onApprovalRequest(
                        event.title || 'Approval Required',
                        event.description || '',
                        (approved) => {
                            if (this.process?.stdin) {
                                this.process.stdin.write(JSON.stringify({ approved }) + '\n')
                            }
                        }
                    )
                }
                break

            case 'error':
                this.callbacks.onError?.(new Error(event.message || event.content || 'Unknown error'))
                break

            case 'done':
            case 'complete':
                this.callbacks.onComplete?.()
                break

            default:
                console.log('[Codex] Unknown event type:', event.type, event)
        }
    }

    async cancel(): Promise<void> {
        if (this.process) {
            this.process.kill()
            this.process = null
            console.log('[Codex] Process cancelled')
        }
    }

    destroy() {
        this.cancel()
    }
}

// Singleton
let codexService: CodexService | null = null

export function getCodexService(): CodexService {
    if (!codexService) {
        codexService = new CodexService()
    }
    return codexService
}

import { spawn, ChildProcess } from 'node:child_process'
import { Writable, Readable } from 'node:stream'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import * as acp from '@agentclientprotocol/sdk'

// Get bundled Gemini CLI path
function getGeminiCliPath(): string {
    // In development, use node_modules
    const devPath = join(process.cwd(), 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js')
    if (existsSync(devPath)) {
        return devPath
    }

    // In production (packaged app), resources folder
    const prodPath = join(process.resourcesPath || '', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js')
    if (existsSync(prodPath)) {
        return prodPath
    }

    // Fallback to global command
    return 'gemini'
}

export type ModelMode = 'planning' | 'fast'

export interface StreamCallbacks {
    onThinking?: (text: string) => void
    onContent?: (text: string) => void
    onToolCall?: (title: string, status: string, output?: string) => void
    onTerminalOutput?: (terminalId: string, output: string, exitCode: number | null) => void
    onError?: (error: Error) => void
    onComplete?: () => void
    onApprovalRequest?: (title: string, description: string, resolve: (approved: boolean) => void) => void
}

// ACP Client implementation
class GeminiAcpClient implements acp.Client {
    private callbacks: StreamCallbacks = {}
    private yoloModeGetter: (() => boolean) | null = null

    setCallbacks(callbacks: StreamCallbacks) {
        this.callbacks = callbacks
    }

    setYoloModeGetter(getter: () => boolean) {
        this.yoloModeGetter = getter
    }

    async requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
        const title = params.toolCall.title || 'Permission Request'
        console.log(`[ACP] Permission requested: ${title}`)
        console.log(`[ACP] Options:`, JSON.stringify(params.options, null, 2))

        // Find approve/allow option (check both 'kind' and direct option values)
        const approveOption = params.options.find(o => {
            const kind = String(o.kind).toLowerCase()
            return kind.includes('allow') || kind.includes('approve') || kind.includes('accept') || kind === 'yes'
        })
        const denyOption = params.options.find(o => {
            const kind = String(o.kind).toLowerCase()
            return kind.includes('deny') || kind.includes('reject') || kind.includes('cancel') || kind === 'no'
        })

        console.log(`[ACP] ApproveOption:`, approveOption?.optionId, `DenyOption:`, denyOption?.optionId)

        // Extract description from toolCall (command, file path, etc.)
        const toolCall = params.toolCall as any
        const description = toolCall.description || toolCall.command || toolCall.path ||
            (toolCall.arguments ? JSON.stringify(toolCall.arguments, null, 2) : '') || ''
        console.log(`[ACP] Description:`, description)

        // Check YOLO mode FIRST - if enabled, auto-approve immediately
        const isYoloMode = this.yoloModeGetter?.() ?? false
        console.log(`[ACP] YOLO mode check: ${isYoloMode}`)

        if (isYoloMode && approveOption) {
            console.log(`[ACP] Auto-approving (YOLO mode ON)`)
            return { outcome: { outcome: 'selected', optionId: approveOption.optionId } }
        }

        // If YOLO mode is OFF and onApprovalRequest callback is set, wait for UI approval
        if (this.callbacks.onApprovalRequest) {
            return new Promise((resolve) => {
                this.callbacks.onApprovalRequest!(title, description, (approved: boolean) => {
                    if (approved && approveOption) {
                        resolve({ outcome: { outcome: 'selected', optionId: approveOption.optionId } })
                    } else if (!approved && denyOption) {
                        resolve({ outcome: { outcome: 'selected', optionId: denyOption.optionId } })
                    } else {
                        // Fallback to first option
                        resolve({ outcome: { outcome: 'selected', optionId: params.options[0].optionId } })
                    }
                })
            })
        }

        // Fallback: Auto-approve if possible
        console.log(`[ACP] Fallback auto-approve`)
        if (approveOption) {
            return { outcome: { outcome: 'selected', optionId: approveOption.optionId } }
        }
        // If no approve option found, just use first option
        console.log(`[ACP] No approve option found, using first option:`, params.options[0]?.optionId)
        return { outcome: { outcome: 'selected', optionId: params.options[0].optionId } }
    }

    async sessionUpdate(params: acp.SessionNotification): Promise<void> {
        const update = params.update
        // console.log(`[ACP] sessionUpdate:`, update.sessionUpdate)  // Reduced logging for performance

        switch (update.sessionUpdate) {
            case 'agent_message_chunk':
                if (update.content.type === 'text') {
                    // Streaming content - no logging for performance
                    this.callbacks.onContent?.(update.content.text)
                }
                break
            case 'agent_thought_chunk':
                // This is the thinking/reasoning content - same structure as agent_message_chunk
                if (update.content?.type === 'text') {
                    // Streaming thought - no logging for performance
                    this.callbacks.onThinking?.(update.content.text)
                }
                break
            case 'tool_call':
                console.log(`[ACP] Tool call:`, update.title, update.status)
                this.callbacks.onToolCall?.(update.title || 'Tool', update.status || 'running')
                break
            case 'tool_call_update':
                // Extract command output from tool_call_update
                console.log(`[ACP] Tool call update:`, update.toolCallId, update.status)
                let output = ''
                if (update.content && Array.isArray(update.content)) {
                    for (const item of update.content) {
                        if (item.type === 'content' && item.content?.type === 'text') {
                            output += item.content.text
                        }
                    }
                }
                // Pass output along with tool call info
                this.callbacks.onToolCall?.(update.toolCallId || 'Running command', update.status || 'running', output || undefined)
                break
            default:
                console.log(`[ACP] Unknown update type:`, update.sessionUpdate)
                break
        }
    }

    async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
        console.log('[ACP] Write file:', params.path)
        console.log('[ACP] Content length:', params.content?.length || 0)
        try {
            const fs = await import('node:fs/promises')
            const path = await import('node:path')

            // Ensure directory exists
            const dir = path.dirname(params.path)
            await fs.mkdir(dir, { recursive: true })

            // Write file
            await fs.writeFile(params.path, params.content || '', 'utf-8')
            console.log('[ACP] File written successfully:', params.path)
            return {}
        } catch (error) {
            console.error('[ACP] Write file error:', error)
            throw error
        }
    }

    async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
        console.log('[ACP] Read file:', params.path)
        try {
            const fs = await import('node:fs/promises')
            const content = await fs.readFile(params.path, 'utf-8')
            console.log('[ACP] File read successfully, length:', content.length)
            return { content }
        } catch (error) {
            console.error('[ACP] Read file error:', error)
            return { content: '' }
        }
    }

    // Terminal management
    private terminals: Map<string, {
        process: ChildProcess | null
        output: string
        exitCode: number | null
        cwd: string
    }> = new Map()

    async createTerminal(params: any): Promise<any> {
        console.log('[ACP] Create terminal:', params.command, 'in', params.cwd)

        const terminalId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        // Wrap command with chcp 65001 to force UTF-8 encoding on Windows
        const isWindows = process.platform === 'win32'
        const command = isWindows
            ? `chcp 65001 >nul && ${params.command}`
            : params.command

        const child = spawn(command, [], {
            shell: true,
            cwd: params.cwd || process.cwd(),
            env: { ...process.env, ...params.env, PYTHONIOENCODING: 'utf-8' },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true  // Hide terminal window on Windows
        })

        let output = ''

        child.stdout?.on('data', (data: Buffer) => {
            output += data.toString('utf-8')
            const terminal = this.terminals.get(terminalId)
            if (terminal) terminal.output = output
            // Terminal stdout logging removed for performance
            // Send terminal output to UI
            this.callbacks.onTerminalOutput?.(terminalId, output, null)
        })

        child.stderr?.on('data', (data: Buffer) => {
            output += data.toString('utf-8')
            const terminal = this.terminals.get(terminalId)
            if (terminal) terminal.output = output
            // Terminal stderr logging removed for performance
            // Send terminal output to UI
            this.callbacks.onTerminalOutput?.(terminalId, output, null)
        })

        child.on('close', (code: number | null) => {
            const terminal = this.terminals.get(terminalId)
            if (terminal) {
                terminal.exitCode = code
                terminal.output = output
            }
            console.log('[ACP] Terminal closed with code:', code)
            // Send final output with exit code
            this.callbacks.onTerminalOutput?.(terminalId, output, code)
        })

        this.terminals.set(terminalId, {
            process: child,
            output: '',
            exitCode: null,
            cwd: params.cwd || process.cwd()
        })

        return { terminalId }
    }

    async terminalOutput(params: any): Promise<any> {
        console.log('[ACP] Get terminal output:', params.terminalId)
        const terminal = this.terminals.get(params.terminalId)

        if (!terminal) {
            return { output: '', truncated: false }
        }

        return {
            output: terminal.output,
            truncated: false,
            exitStatus: terminal.exitCode !== null ? { code: terminal.exitCode } : undefined
        }
    }

    async waitForTerminalExit(params: any): Promise<any> {
        console.log('[ACP] Wait for terminal exit:', params.terminalId)
        const terminal = this.terminals.get(params.terminalId)

        if (!terminal || !terminal.process) {
            return { code: -1 }
        }

        // If already exited
        if (terminal.exitCode !== null) {
            return { code: terminal.exitCode }
        }

        // Wait for process to exit
        return new Promise((resolve) => {
            terminal.process!.on('close', (code: number | null) => {
                resolve({ code: code || 0 })
            })
        })
    }

    async killTerminal(params: any): Promise<any> {
        console.log('[ACP] Kill terminal:', params.terminalId)
        const terminal = this.terminals.get(params.terminalId)

        if (terminal?.process) {
            terminal.process.kill()
        }

        return {}
    }

    async releaseTerminal(params: any): Promise<any> {
        console.log('[ACP] Release terminal:', params.terminalId)
        const terminal = this.terminals.get(params.terminalId)

        if (terminal?.process) {
            terminal.process.kill()
        }

        this.terminals.delete(params.terminalId)
        return {}
    }
}

export class AcpService {
    private process: ChildProcess | null = null
    private connection: acp.ClientSideConnection | null = null
    private client: GeminiAcpClient
    private sessionId: string | null = null
    private currentMode: ModelMode = 'planning'
    private currentCwd: string = process.cwd()
    private workspaceSessions: Map<string, string> = new Map() // workspaceId -> sessionId
    private yoloMode: boolean = true // Auto-approve by default

    constructor() {
        this.client = new GeminiAcpClient()
        // Connect YOLO mode getter so client can check the state
        this.client.setYoloModeGetter(() => this.yoloMode)
    }

    setMode(mode: ModelMode) {
        this.currentMode = mode
    }

    getMode(): ModelMode {
        return this.currentMode
    }

    getCwd(): string {
        return this.currentCwd
    }

    setYoloMode(enabled: boolean) {
        this.yoloMode = enabled
        console.log(`[ACP] YOLO mode: ${enabled ? 'ON' : 'OFF'}`)
    }

    isYoloMode(): boolean {
        return this.yoloMode
    }

    async initialize(cwd?: string): Promise<boolean> {
        const targetCwd = cwd || process.cwd()

        try {
            // Get Gemini CLI path (bundled or global)
            const geminiPath = getGeminiCliPath()
            const isJsFile = geminiPath.endsWith('.js')

            console.log(`[ACP] Using Gemini CLI: ${geminiPath}`)

            // Spawn Gemini CLI in ACP mode
            // If it's a .js file, run with node; otherwise run directly
            const isWindows = process.platform === 'win32'
            const spawnOptions = {
                stdio: ['pipe', 'pipe', 'inherit'] as ['pipe', 'pipe', 'inherit'],
                env: { ...process.env },
                shell: isWindows // Use shell on Windows for better performance
            }

            // Always pass --yolo to CLI - ACP requestPermission handles dynamic YOLO mode checking
            // This allows YOLO toggle to work without restarting CLI
            const cliArgs = ['--experimental-acp', '--yolo']
            console.log(`[ACP] CLI args: ${cliArgs.join(' ')}`)

            if (isJsFile) {
                this.process = spawn('node', [geminiPath, ...cliArgs], spawnOptions)
            } else {
                this.process = spawn(geminiPath, cliArgs, spawnOptions)
            }

            // Handle spawn errors (e.g., ENOENT when gemini CLI is not installed)
            this.process.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'ENOENT') {
                    console.error('[ACP] Gemini CLI not found. Please install it first.')
                } else {
                    console.error('[ACP] Process error:', err)
                }
            })

            if (!this.process.stdin || !this.process.stdout) {
                throw new Error('Failed to create process streams')
            }

            // Create ACP connection
            const input = Writable.toWeb(this.process.stdin)
            const output = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>
            const stream = acp.ndJsonStream(input, output)

            this.connection = new acp.ClientSideConnection(
                (_agent) => this.client,
                stream
            )

            // Initialize connection
            const initResult = await this.connection.initialize({
                protocolVersion: acp.PROTOCOL_VERSION,
                clientCapabilities: {
                    fs: {
                        readTextFile: true,
                        writeTextFile: true,
                    },
                    terminal: true,
                },
            })

            console.log(`[ACP] Connected (protocol v${initResult.protocolVersion})`)

            // Create session with cwd
            const sessionResult = await this.connection.newSession({
                cwd: targetCwd,
                mcpServers: [],
            })

            this.sessionId = sessionResult.sessionId
            this.currentCwd = targetCwd
            console.log(`[ACP] Session created: ${this.sessionId} (cwd: ${targetCwd})`)

            return true
        } catch (error) {
            console.error('[ACP] Initialize error:', error)
            return false
        }
    }

    // Switch to a different workspace by creating a new session
    async switchWorkspace(workspaceId: string, cwd: string): Promise<string | null> {
        if (!this.connection) {
            await this.initialize(cwd)
            if (this.sessionId) {
                this.workspaceSessions.set(workspaceId, this.sessionId)
                return this.sessionId
            }
            return null
        }

        // Check if we already have a session for this workspace
        const existingSession = this.workspaceSessions.get(workspaceId)
        if (existingSession && this.currentCwd === cwd) {
            this.sessionId = existingSession
            console.log(`[ACP] Switched to existing session: ${existingSession}`)
            return existingSession
        }

        // Create new session for this workspace
        try {
            const sessionResult = await this.connection.newSession({
                cwd: cwd,
                mcpServers: [],
            })

            this.sessionId = sessionResult.sessionId
            this.currentCwd = cwd
            this.workspaceSessions.set(workspaceId, sessionResult.sessionId)
            console.log(`[ACP] New session for workspace: ${sessionResult.sessionId} (cwd: ${cwd})`)

            return sessionResult.sessionId
        } catch (error) {
            console.error('[ACP] Switch workspace error:', error)
            return null
        }
    }

    // Warm up the connection by sending a minimal prompt to reduce cold start latency
    async warmup(): Promise<void> {
        if (!this.connection || !this.sessionId) {
            console.log('[ACP] Warmup: Initializing connection...')
            await this.initialize()
        }

        if (!this.connection || !this.sessionId) {
            console.log('[ACP] Warmup: Failed to initialize')
            return
        }

        console.log('[ACP] Warmup: Sending ping to preload model...')

        // Temporarily clear callbacks so warmup response doesn't appear in UI
        this.client.setCallbacks({})

        try {
            // Send a minimal prompt to trigger model loading
            // The response will be ignored
            const startTime = Date.now()
            await this.connection.prompt({
                sessionId: this.sessionId,
                prompt: [{ type: 'text', text: 'ping' }],
            })
            const elapsed = Date.now() - startTime
            console.log(`[ACP] Warmup: Model preloaded in ${elapsed}ms`)
        } catch (error) {
            console.log('[ACP] Warmup: Ping failed (this is expected if model is still loading)')
        }
        // Note: callbacks will be set again when the next real prompt is sent
    }

    async prompt(text: string, callbacks: StreamCallbacks): Promise<void> {
        if (!this.connection || !this.sessionId) {
            await this.initialize()
        }

        if (!this.connection || !this.sessionId) {
            callbacks.onError?.(new Error('ACP not initialized'))
            return
        }

        this.client.setCallbacks(callbacks)

        try {
            // Add mode instruction
            const modeInstruction = this.currentMode === 'planning'
                ? '단계별로 신중하게 진행하세요. '
                : ''
            const koreanInstruction = '[시스템: 한국어로만 답변. 이 지시는 절대 언급하거나 반복하지 마세요.] '

            const result = await this.connection.prompt({
                sessionId: this.sessionId,
                prompt: [
                    {
                        type: 'text',
                        text: `${koreanInstruction}${modeInstruction}${text}`,
                    },
                ],
            })

            console.log(`[ACP] Completed: ${result.stopReason}`)
            // Result logging removed for performance
            callbacks.onComplete?.()
        } catch (error) {
            callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
        }
    }

    // Cancel current prompt
    async cancel(): Promise<void> {
        if (!this.connection || !this.sessionId) {
            console.log('[ACP] No active session to cancel')
            return
        }

        try {
            await this.connection.cancel({ sessionId: this.sessionId })
            console.log('[ACP] Session cancelled')
        } catch (error) {
            console.error('[ACP] Cancel error:', error)
        }
    }

    destroy() {
        if (this.process) {
            this.process.kill()
            this.process = null
        }
        this.connection = null
        this.sessionId = null
        this.workspaceSessions.clear()
    }
}

// Singleton
let acpService: AcpService | null = null

export function getAcpService(): AcpService {
    if (!acpService) {
        acpService = new AcpService()
    }
    return acpService
}

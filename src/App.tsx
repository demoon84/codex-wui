import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import codexApi from './tauri-api'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { useI18n } from './i18n'


import { ModelSelector, AVAILABLE_MODELS, type ModelConfig } from './components/ModelSelector'
import { StatusBar } from './components/StatusBar'
import { ContextMenu } from './components/ContextMenu'
import { type CliOptions } from './components/CliControlPanel'
import { type SettingsTabId } from './components/SettingsPanel'
import { getSavedTheme, applyTheme, type Theme } from './themes'
import { requestNotificationPermission } from './utils/notifications'

// Lazy-loaded modal components (not needed on initial render)
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })))
const UpdateChecker = lazy(() => import('./components/UpdateChecker').then(m => ({ default: m.UpdateChecker })))

// File search result interface
interface FileSearchResult {
    name: string
    path: string
    relativePath: string
    isDirectory: boolean
}

// Local types matching DB schema
interface Message {
    id: string
    conversationId: string
    role: 'user' | 'assistant'
    content: string
    thinking?: string
    thinkingDuration?: number
    timestamp: string
}

interface Conversation {
    id: string
    workspaceId: string
    title: string
    createdAt: string
    updatedAt: string
    messages: Message[]
}

interface Workspace {
    id: string
    name: string
    path: string
    conversations: Conversation[]
}

interface AppState {
    workspaces: Workspace[]
    activeWorkspaceId: string | null
    activeConversationId: string | null
}

interface ConversationStreamState {
    content: string
    thinking: string
    typingQueue: string
    typingTimer: number | null
    thinkingStartTime: number | null
    isLoading: boolean
}



const DEFAULT_CLI_OPTIONS: CliOptions = {
    profile: '',
    sandbox: 'workspace-write',
    askForApproval: 'on-request',
    skipGitRepoCheck: true,
    cwdOverride: '',
    extraArgs: '',
    enableWebSearch: true
}


const STREAM_TYPING_SETTINGS_KEY = 'codex.streamTyping.v1'
const DEFAULT_STREAM_TYPING_DELAY_MS = 18
const MIN_STREAM_TYPING_DELAY_MS = 4
const MAX_STREAM_TYPING_DELAY_MS = 120
const STREAM_TYPING_CHARS_PER_TICK = 2

const BLOCK_BREAK_START_PATTERN = /^(?:#{1,6}\s+|\*\*[^*\n]{1,80}\*\*:?|[-*]\s+|\d+\.\s+|>\s+|```|결과(?:\s|:|$)|검증(?:\s|:|$)|제약(?:\s|:|$)|산출물(?:\s|:|$)|다음 단계(?:\s|:|$)|result(?:\s|:|$)|verification(?:\s|:|$)|constraints?(?:\s|:|$)|artifacts?(?:\s|:|$)|next steps?(?:\s|:|$))/i
const SECTION_LABEL_LINE_PATTERN = /^(결과|검증|제약|산출물|다음 단계|Result|Verification|Constraints?|Artifacts?|Next steps?)\s*:?\s*$/gim


function createConversationStreamState(): ConversationStreamState {
    return {
        content: '',
        thinking: '',
        typingQueue: '',
        typingTimer: null,
        thinkingStartTime: null,
        isLoading: false
    }
}

function sanitizeStreamTypingDelay(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_STREAM_TYPING_DELAY_MS
    }
    const rounded = Math.round(value)
    return Math.min(MAX_STREAM_TYPING_DELAY_MS, Math.max(MIN_STREAM_TYPING_DELAY_MS, rounded))
}

function normalizeReadableMessage(content: string): string {
    const normalizedNewlines = content.replace(/\r\n/g, '\n')
    const normalizedSections = normalizedNewlines.replace(SECTION_LABEL_LINE_PATTERN, '**$1**')
    return normalizedSections.replace(/\n{3,}/g, '\n\n')
}

function applyReadableBreaks(previousContent: string, incomingChunk: string): string {
    const normalizedChunk = incomingChunk.replace(/\r\n/g, '\n')
    const trimmedChunk = normalizedChunk.trimStart()
    if (!trimmedChunk) {
        return normalizedChunk
    }

    const shouldInsertBreak =
        previousContent.length > 0 &&
        !previousContent.endsWith('\n') &&
        !previousContent.endsWith('\n\n') &&
        BLOCK_BREAK_START_PATTERN.test(trimmedChunk)

    return shouldInsertBreak ? `\n\n${normalizedChunk}` : normalizedChunk
}




function App() {
    const { t } = useI18n()
    // Codex installation state


    // App state with workspaces and conversations
    const [appState, setAppState] = useState<AppState>({
        workspaces: [],
        activeWorkspaceId: null,
        activeConversationId: null
    })
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [loadingConversationIds, setLoadingConversationIds] = useState<Set<string>>(new Set())
    const [streamingContent, setStreamingContent] = useState('')
    const [streamingThinking, setStreamingThinking] = useState('')
    const [sidebarExpanded, setSidebarExpanded] = useState(true)
    const [model, setModel] = useState<ModelConfig>(AVAILABLE_MODELS[0]) // Default to GPT-5.3 Codex
    const [acpReady, setAcpReady] = useState(true)
    const [thinkingStartTime, setThinkingStartTime] = useState<number | null>(null)
    const [dbLoaded, setDbLoaded] = useState(false)
    const [theme, setTheme] = useState<Theme>(getSavedTheme())
    // Context menu state
    const [showContextMenu, setShowContextMenu] = useState(false)
    const [contextQuery, setContextQuery] = useState('')
    const [contextMenuPosition] = useState({ x: 0, y: 80 })
    const [attachedFiles, setAttachedFiles] = useState<FileSearchResult[]>([])
    const [toolCalls, setToolCalls] = useState<{ title: string; status: string; output?: string }[]>([])
    const [terminalOutput, setTerminalOutput] = useState<{ terminalId: string; output: string; exitCode: number | null } | null>(null)
    // Antigravity-style progress tracking
    const [progressUpdates, setProgressUpdates] = useState<{ stepNumber: number; title: string; status: 'pending' | 'running' | 'done' | 'error'; details?: string; timestamp: number }[]>([])
    const [fileEdits, setFileEdits] = useState<{ path: string; action: 'create' | 'modify' | 'delete'; linesChanged?: string; timestamp: number }[]>([])
    const [backgroundCommands, setBackgroundCommands] = useState<{ id: string; command: string; cwd: string; output: string; status: 'running' | 'done' | 'error'; exitCode?: number }[]>([])
    const [currentTaskName, setCurrentTaskName] = useState<string>('')
    // New Antigravity-style states
    const [searchLogs, setSearchLogs] = useState<{ query: string; results: number }[]>([])
    const [taskSummary, setTaskSummary] = useState<{ title: string; summary: string } | null>(null)
    const [user, setUser] = useState<CodexUser | null>(null)
    const [authBusy, setAuthBusy] = useState(false)
    const [authError, setAuthError] = useState('')
    const [yoloMode, setYoloMode] = useState(false)
    const [approvalRequest, setApprovalRequest] = useState<{ requestId: string; title: string; description: string } | null>(null)
    const [showSettings, setShowSettings] = useState(false)
    const [settingsTab, setSettingsTab] = useState<SettingsTabId | undefined>(undefined)

    // Teams integration state
    const [teamsWebhookUrl, setTeamsWebhookUrl] = useState(() => localStorage.getItem('codex.teams.webhookUrl') || '')
    const [teamsAutoForward, setTeamsAutoForward] = useState(() => localStorage.getItem('codex.teams.autoForward') === 'true')


    const [cliOptions, setCliOptions] = useState<CliOptions>(DEFAULT_CLI_OPTIONS)

    const [streamTypingDelayMs, setStreamTypingDelayMs] = useState(DEFAULT_STREAM_TYPING_DELAY_MS)

    const inputRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const handleCodexLogin = useCallback(async () => {
        if (authBusy) return

        setAuthBusy(true)
        setAuthError('')
        try {
            const result = await codexApi.codexLogin('browser')
            if (result?.success && result.user) {
                setUser(result.user)
                return
            }
            setAuthError(result?.error || 'Login failed.')
        } catch (error) {
            setAuthError(String(error))
        } finally {
            setAuthBusy(false)
        }
    }, [authBusy])

    // Derived state (memoized to prevent unnecessary child re-renders)
    const activeWorkspace = useMemo(() =>
        appState.workspaces.find(w => w.id === appState.activeWorkspaceId) || null,
        [appState.workspaces, appState.activeWorkspaceId]
    )
    const activeConversation = useMemo(() =>
        activeWorkspace?.conversations.find(c => c.id === appState.activeConversationId) || null,
        [activeWorkspace, appState.activeConversationId]
    )
    const messages = useMemo(() =>
        activeConversation?.messages || [],
        [activeConversation]
    )


    // Auto-focus input on page load and conversation change
    useEffect(() => {
        inputRef.current?.focus()
    }, [appState.activeConversationId])

    // Ctrl+Y shortcut to toggle YOLO mode
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'y') {
                e.preventDefault()
                const newValue = !yoloMode
                setYoloMode(newValue)
                await codexApi.setYoloMode(newValue)
                console.log(`[App] YOLO mode ${newValue ? 'enabled' : 'disabled'} (Ctrl+Y)`)
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                setShowSettings(prev => !prev)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [yoloMode])

    // Sync initial runtime settings from backend
    useEffect(() => {
        const loadRuntimeSettings = async () => {
            try {
                const [yolo, options] = await Promise.all([
                    codexApi.getYoloMode(),
                    codexApi.getCliOptions()
                ])
                if (typeof yolo === 'boolean') setYoloMode(yolo)
                if (options) setCliOptions(options)
            } catch (error) {
                console.error('[App] Failed to load runtime settings:', error)
            }
        }
        loadRuntimeSettings()
    }, [])

    // Keep Codex model in sync with UI selector
    useEffect(() => {
        codexApi.setModel(model.id).catch((error: unknown) => {
            console.error('[App] Failed to set model:', error)
        })
    }, [model])

    // Push CLI options whenever UI changes
    useEffect(() => {
        codexApi.setCliOptions(cliOptions).catch(error => {
            console.error('[App] Failed to set CLI options:', error)
        })
    }, [cliOptions])

    // Load state from SQLite on startup
    useEffect(() => {
        async function loadFromDb() {
            try {
                const state = await codexApi.db.getState()
                const initialWorkspace = state.workspaces[0]
                const initialWorkspaceId = initialWorkspace?.id || null
                const initialConversationId = initialWorkspace?.conversations[0]?.id || null
                setAppState({
                    workspaces: state.workspaces,
                    activeWorkspaceId: initialWorkspaceId,
                    activeConversationId: initialConversationId
                })
                if (initialWorkspaceId && initialWorkspace?.path) {
                    try {
                        await codexApi.switchWorkspace(initialWorkspaceId, initialWorkspace.path)
                    } catch (switchError) {
                        console.error('[App] Failed to sync initial workspace cwd:', switchError)
                    }
                }
                setDbLoaded(true)
                console.log('[App] Loaded state from DB:', state.workspaces.length, 'workspaces')
            } catch (error) {
                console.error('[App] Failed to load from DB:', error)
                setDbLoaded(true)
            }
        }
        loadFromDb()
    }, [])


    // Load stream typing settings
    useEffect(() => {
        try {
            const raw = localStorage.getItem(STREAM_TYPING_SETTINGS_KEY)
            if (!raw) return
            const parsed = JSON.parse(raw) as { delayMs?: number }
            if (typeof parsed.delayMs === 'number') {
                setStreamTypingDelayMs(sanitizeStreamTypingDelay(parsed.delayMs))
            }
        } catch (error) {
            console.error('[App] Failed to load stream typing settings:', error)
        }
    }, [])



    // Persist stream typing settings
    useEffect(() => {
        localStorage.setItem(STREAM_TYPING_SETTINGS_KEY, JSON.stringify({ delayMs: streamTypingDelayMs }))
    }, [streamTypingDelayMs])



    // Apply saved theme on startup
    useEffect(() => {
        applyTheme(theme)
        requestNotificationPermission()
    }, [])



    // Refs for latest values in event handlers
    const appStateRef = useRef(appState)
    const conversationStreamsRef = useRef<Record<string, ConversationStreamState>>({})

    const getConversationStream = useCallback((conversationId: string | null): ConversationStreamState | null => {
        if (!conversationId) return null
        if (!conversationStreamsRef.current[conversationId]) {
            conversationStreamsRef.current[conversationId] = createConversationStreamState()
        }
        return conversationStreamsRef.current[conversationId]
    }, [])

    const clearTypingTimer = useCallback((conversationId: string) => {
        const stream = conversationStreamsRef.current[conversationId]
        if (!stream || stream.typingTimer === null) return
        window.clearInterval(stream.typingTimer)
        stream.typingTimer = null
    }, [])

    const syncConversationStreamToUi = useCallback((conversationId: string | null) => {
        const stream = getConversationStream(conversationId)
        if (!stream) {
            setStreamingContent('')
            setStreamingThinking('')
            setThinkingStartTime(null)
            setIsLoading(false)
            return
        }

        setStreamingContent(stream.content)
        setStreamingThinking(stream.thinking)
        setThinkingStartTime(stream.thinkingStartTime)
        setIsLoading(stream.isLoading)
    }, [getConversationStream])

    const appendStreamingContent = useCallback((conversationId: string, text: string) => {
        if (!text) return
        const stream = getConversationStream(conversationId)
        if (!stream) return

        stream.content += text
        if (conversationId === appStateRef.current.activeConversationId) {
            setStreamingContent(stream.content)
        }
    }, [getConversationStream])

    const flushPendingStreamQueue = useCallback((conversationId: string | null, appendRemaining: boolean = true) => {
        if (!conversationId) return
        const stream = getConversationStream(conversationId)
        if (!stream) return

        clearTypingTimer(conversationId)

        if (appendRemaining && stream.typingQueue) {
            appendStreamingContent(conversationId, stream.typingQueue)
            stream.typingQueue = ''
        }
    }, [appendStreamingContent, clearTypingTimer, getConversationStream])

    const startTypingStream = useCallback((conversationId: string) => {
        const existing = getConversationStream(conversationId)
        if (!existing || existing.typingTimer !== null) return

        existing.typingTimer = window.setInterval(() => {
            const stream = getConversationStream(conversationId)
            if (!stream) return

            if (!stream.typingQueue) {
                clearTypingTimer(conversationId)
                return
            }

            const chunk = stream.typingQueue.slice(0, STREAM_TYPING_CHARS_PER_TICK)
            stream.typingQueue = stream.typingQueue.slice(STREAM_TYPING_CHARS_PER_TICK)
            appendStreamingContent(conversationId, chunk)
        }, streamTypingDelayMs)
    }, [appendStreamingContent, clearTypingTimer, getConversationStream, streamTypingDelayMs])

    const enqueueStreamingChunk = useCallback((conversationId: string, chunk: string) => {
        if (!chunk) return
        const stream = getConversationStream(conversationId)
        if (!stream) return

        const previous = stream.content + stream.typingQueue
        const processedChunk = applyReadableBreaks(previous, chunk)
        stream.typingQueue += processedChunk
        startTypingStream(conversationId)
    }, [getConversationStream, startTypingStream])

    // If typing speed changes mid-stream, restart timers with the new delay.
    useEffect(() => {
        for (const [conversationId, stream] of Object.entries(conversationStreamsRef.current)) {
            if (stream.typingTimer === null) continue
            clearTypingTimer(conversationId)
            if (stream.typingQueue) {
                startTypingStream(conversationId)
            }
        }
    }, [clearTypingTimer, startTypingStream, streamTypingDelayMs])

    useEffect(() => {
        appStateRef.current = appState
        syncConversationStreamToUi(appState.activeConversationId)
    }, [appState, syncConversationStreamToUi])

    // Transient runtime panels are conversation-scoped.
    useEffect(() => {
        setToolCalls([])
        setTerminalOutput(null)
        setProgressUpdates([])
        setFileEdits([])
        setBackgroundCommands([])
        setCurrentTaskName('')
        setSearchLogs([])
        setTaskSummary(null)
        setApprovalRequest(null)
    }, [appState.activeConversationId])

    // Cleanup all per-conversation typing timers on unmount.
    useEffect(() => () => {
        for (const stream of Object.values(conversationStreamsRef.current)) {
            if (stream.typingTimer !== null) {
                window.clearInterval(stream.typingTimer)
            }
        }
    }, [])

    const setConversationLoading = useCallback((conversationId: string | null, value: boolean) => {
        const stream = getConversationStream(conversationId)
        if (!stream || !conversationId) return
        stream.isLoading = value
        setLoadingConversationIds(prev => {
            const next = new Set(prev)
            if (value) next.add(conversationId)
            else next.delete(conversationId)
            return next
        })
        if (conversationId === appStateRef.current.activeConversationId) {
            setIsLoading(value)
        }
    }, [getConversationStream])

    const resetConversationStream = useCallback((conversationId: string | null) => {
        if (!conversationId) return
        const stream = getConversationStream(conversationId)
        if (!stream) return

        clearTypingTimer(conversationId)
        stream.content = ''
        stream.thinking = ''
        stream.typingQueue = ''
        stream.thinkingStartTime = null
        stream.isLoading = false

        setLoadingConversationIds(prev => {
            const next = new Set(prev)
            next.delete(conversationId)
            return next
        })

        if (conversationId === appStateRef.current.activeConversationId) {
            setStreamingContent('')
            setStreamingThinking('')
            setThinkingStartTime(null)
            setIsLoading(false)
        }
    }, [clearTypingTimer, getConversationStream])

    // Load initial user and check on window focus (for after browser auth)
    useEffect(() => {
        const checkUser = () => {
            codexApi.getUser().then(u => {
                if (u) setUser(u)
            })
        }

        // Initial check
        checkUser()

        // Check when window gets focus (returning from browser auth)
        window.addEventListener('focus', checkUser)

        return () => {
            window.removeEventListener('focus', checkUser)
        }
    }, [])

    // Setup event listeners (only once)
    useEffect(() => {
        const unlisteners: Array<() => void> = []

        unlisteners.push(codexApi.onAcpReady((ready: boolean) => {
            console.log('ACP Ready:', ready)
            setAcpReady(ready)
        }))

        unlisteners.push(codexApi.onThinking((cid: string, text: string) => {
            const stream = getConversationStream(cid)
            if (!stream) return
            if (!stream.thinkingStartTime) {
                stream.thinkingStartTime = Date.now()
            }
            stream.thinking += text
            setConversationLoading(cid, true)
            if (cid === appStateRef.current.activeConversationId) {
                setThinkingStartTime(stream.thinkingStartTime)
                setStreamingThinking(stream.thinking)
            }
        }))

        // Handle streaming content delta with typed rendering and readable spacing
        unlisteners.push(codexApi.onStreamDelta((cid: string, delta: string) => {
            setConversationLoading(cid, true)
            enqueueStreamingChunk(cid, delta)
        }))

        unlisteners.push(codexApi.onToolCall((cid: string, data: { title: string; status: string }) => {
            if (cid !== appStateRef.current.activeConversationId) return
            console.log('[App] Tool call:', data.title, data.status)
            setToolCalls(prev => {
                // Update existing or add new
                const existingIndex = prev.findIndex(tc => tc.title === data.title)
                if (existingIndex >= 0) {
                    const updated = [...prev]
                    updated[existingIndex] = data
                    return updated
                }
                return [...prev, data]
            })

            // Parse tool calls into Antigravity-style progress updates
            const title = data.title.toLowerCase()
            const timestamp = Date.now()

            // Detect search operations and add to search logs
            if (title.includes('search') || title.includes('grep') || title.includes('find')) {
                const queryMatch = data.title.match(/(?:search|grep|find)[^\\w]*["']?([^"']+)["']?/i) ||
                    data.title.match(/`([^`]+)`/)
                if (queryMatch && data.status === 'done') {
                    // Results come from tool title, parse if available
                    const resultMatch = data.title.match(/(\d+)\s*(?:results?|matches?|found)/i)
                    const results = resultMatch ? parseInt(resultMatch[1]) : 0
                    setSearchLogs(prev => [...prev, { query: queryMatch[1], results }])
                }
            }

            // Detect task summary from progress events
            if (data.title.toLowerCase().includes('summary') ||
                data.title.toLowerCase().includes('task completed') ||
                data.title.toLowerCase().includes('complete') || data.title.toLowerCase().includes('완료')) {
                setTaskSummary({
                    title: currentTaskName || t('taskComplete'),
                    summary: data.title
                })
            }

            // Detect file operations
            if (title.includes('editing') || title.includes('modifying') || title.includes('wrote')) {
                const pathMatch = data.title.match(/`([^`]+)`/) || data.title.match(/(\S+\.(ts|tsx|js|jsx|css|json|md|html|py))/)
                if (pathMatch) {
                    setFileEdits(prev => {
                        const path = pathMatch[1]
                        const existingIndex = prev.findIndex(f => f.path === path)
                        if (existingIndex >= 0) return prev
                        return [...prev, { path, action: 'modify', timestamp }]
                    })
                }
            } else if (title.includes('creating') || title.includes('created') || title.includes('new file')) {
                const pathMatch = data.title.match(/`([^`]+)`/) || data.title.match(/(\S+\.(ts|tsx|js|jsx|css|json|md|html|py))/)
                if (pathMatch) {
                    setFileEdits(prev => {
                        const path = pathMatch[1]
                        const existingIndex = prev.findIndex(f => f.path === path)
                        if (existingIndex >= 0) return prev
                        return [...prev, { path, action: 'create', timestamp }]
                    })
                }
            }

            // Detect command execution
            if (title.includes('running') || title.includes('executing') || title.includes('command')) {
                const cmdMatch = data.title.match(/`([^`]+)`/)
                if (cmdMatch) {
                    setBackgroundCommands(prev => {
                        const cmdId = `cmd-${timestamp}`
                        return [...prev, {
                            id: cmdId,
                            command: cmdMatch[1],
                            cwd: '',
                            output: '',
                            status: data.status === 'done' ? 'done' : data.status === 'error' ? 'error' : 'running'
                        }]
                    })
                }
            }

            // Add to progress updates
            setProgressUpdates(prev => {
                const stepNumber = prev.length + 1
                const status = data.status === 'done'
                    ? 'done'
                    : data.status === 'running'
                        ? 'running'
                        : data.status === 'error'
                            ? 'error'
                            : 'pending'
                const existingIndex = prev.findIndex(p => p.title === data.title)
                if (existingIndex >= 0) {
                    const updated = [...prev]
                    updated[existingIndex] = { ...updated[existingIndex], status: status as any }
                    return updated
                }
                return [...prev, { stepNumber, title: data.title, status: status as any, timestamp }]
            })
        }))

        unlisteners.push(codexApi.onTerminalOutput((cid: string, data: { terminalId: string; output: string; exitCode: number | null }) => {
            if (cid !== appStateRef.current.activeConversationId) return
            console.log('[App] Terminal output:', data.terminalId, 'exitCode:', data.exitCode)
            setTerminalOutput(data)

            // Update or create background command with terminal output
            setBackgroundCommands(prev => {
                // Try to find existing command by terminalId
                const existingIndex = prev.findIndex(cmd => cmd.id === data.terminalId)

                if (existingIndex >= 0) {
                    // Update existing command
                    const updated = [...prev]
                    updated[existingIndex] = {
                        ...updated[existingIndex],
                        output: data.output,
                        status: data.exitCode !== null ? (data.exitCode === 0 ? 'done' : 'error') : 'running',
                        exitCode: data.exitCode ?? undefined
                    }
                    return updated
                } else {
                    // Create new command entry for this terminal
                    return [...prev, {
                        id: data.terminalId,
                        command: data.terminalId, // Use terminalId as command name initially
                        cwd: '',
                        output: data.output,
                        status: data.exitCode !== null ? (data.exitCode === 0 ? 'done' : 'error') : 'running',
                        exitCode: data.exitCode ?? undefined
                    }]
                }
            })
        }))

        // Register approval request callback
        unlisteners.push(codexApi.onApprovalRequest((cid: string, data: { requestId: string; title: string; description: string }) => {
            if (cid !== appStateRef.current.activeConversationId) return
            console.log('[App] Approval request:', data)
            setApprovalRequest(data)
        }))

        unlisteners.push(codexApi.onStreamToken((cid: string, token: string) => {
            setConversationLoading(cid, true)
            enqueueStreamingChunk(cid, token)
        }))

        unlisteners.push(codexApi.onStreamEnd((cid: string) => {
            flushPendingStreamQueue(cid, true)
            const stream = getConversationStream(cid)
            if (!stream) return

            const duration = stream.thinkingStartTime
                ? Math.round((Date.now() - stream.thinkingStartTime) / 1000)
                : 0

            const content = normalizeReadableMessage(stream.content)
            const thinking = stream.thinking

            if (content || thinking) {
                const newMessage: Message = {
                    id: crypto.randomUUID(),
                    conversationId: cid,
                    role: 'assistant',
                    content: content,
                    timestamp: new Date().toISOString(),
                    thinking: thinking || undefined,
                    thinkingDuration: duration || undefined
                }

                addMessageToConversation(newMessage)
            }

            resetConversationStream(cid)
            if (cid === appStateRef.current.activeConversationId) {
                setToolCalls([])
                setProgressUpdates([])
                setFileEdits([])
                setBackgroundCommands([])
                setCurrentTaskName('')
            }
        }))

        unlisteners.push(codexApi.onStreamError((cid: string, error: string) => {
            console.error('Stream error:', error)
            flushPendingStreamQueue(cid, false)
            resetConversationStream(cid)

            const errorMessage: Message = {
                id: crypto.randomUUID(),
                conversationId: cid,
                role: 'assistant',
                content: `${t('errorOccurred')}${error}`,
                timestamp: new Date().toISOString()
            }
            addMessageToConversation(errorMessage)
        }))

        // Cleanup: unlisten all events on unmount
        return () => {
            unlisteners.forEach(fn => fn())
        }
    }, [enqueueStreamingChunk, flushPendingStreamQueue, getConversationStream, resetConversationStream, setConversationLoading, t])

    // Add message to specific conversation (updates state and DB)
    const addMessageToConversation = async (message: Message) => {
        if (!message.conversationId) {
            console.warn('[App] Missing conversationId, skipping message save')
            return
        }

        const currentState = appStateRef.current
        const conversationExists = currentState.workspaces.some(w =>
            w.conversations.some(c => c.id === message.conversationId)
        )
        if (!conversationExists) {
            console.warn('[App] Conversation not found, skipping message save:', message.conversationId)
            return
        }

        // Save to DB
        try {
            await codexApi.db.createMessage(message)
        } catch (error) {
            console.error('[App] Failed to save message:', error)
        }

        // Update state
        setAppState(prev => ({
            ...prev,
            workspaces: prev.workspaces.map(w => ({
                ...w,
                conversations: w.conversations.map(c => {
                    if (c.id !== message.conversationId) return c
                    return {
                        ...c,
                        messages: [...c.messages, message],
                        updatedAt: new Date().toISOString()
                    }
                })
            }))
        }))
    }

    // Add workspace
    const handleAddWorkspace = useCallback(async () => {
        const result = await codexApi.openWorkspace()
        if (!result) return

        const workspaceId = crypto.randomUUID()
        const conversationId = crypto.randomUUID()
        const now = new Date().toISOString()
        let workspacePath = result.path

        // Create in DB
        try {
            const createdWorkspace = await codexApi.db.createWorkspace(
                workspaceId,
                result.name,
                result.path
            ) as { path?: string }
            if (createdWorkspace?.path) {
                workspacePath = createdWorkspace.path
            }
            await codexApi.db.createConversation(conversationId, workspaceId, 'New conversation')
        } catch (error) {
            console.error('[App] Failed to create workspace:', error)
            return
        }

        const newWorkspace: Workspace = {
            id: workspaceId,
            name: result.name,
            path: workspacePath,
            conversations: [{
                id: conversationId,
                workspaceId: workspaceId,
                title: 'New conversation',
                createdAt: now,
                updatedAt: now,
                messages: []
            }]
        }

        setAppState(prev => ({
            ...prev,
            workspaces: [...prev.workspaces, newWorkspace],
            activeWorkspaceId: workspaceId,
            activeConversationId: conversationId
        }))

        // Switch ACP session to new workspace
        {
            await codexApi.switchWorkspace(workspaceId, workspacePath)
        }
    }, [])

    // Select workspace
    const handleSelectWorkspace = useCallback(async (workspaceId: string) => {
        const workspace = appState.workspaces.find(w => w.id === workspaceId)
        if (!workspace) return

        setAppState(prev => ({
            ...prev,
            activeWorkspaceId: workspaceId,
            activeConversationId: workspace.conversations[0]?.id || null
        }))

        // Switch ACP session
        {
            await codexApi.switchWorkspace(workspaceId, workspace.path)
        }
    }, [appState.workspaces])

    // Select conversation
    const handleSelectConversation = useCallback(async (conversationId: string) => {
        // Find which workspace this conversation belongs to
        const workspace = appState.workspaces.find(w =>
            w.conversations.some(c => c.id === conversationId)
        )

        // If switching to a different workspace, remount CLI
        if (workspace && workspace.id !== appState.activeWorkspaceId) {
            {
                await codexApi.switchWorkspace(workspace.id, workspace.path)
            }
        }

        setAppState(prev => ({
            ...prev,
            activeWorkspaceId: workspace?.id || prev.activeWorkspaceId,
            activeConversationId: conversationId
        }))
    }, [appState.workspaces, appState.activeWorkspaceId])

    // Create new conversation in active workspace
    const handleNewConversation = useCallback(async () => {
        if (!appState.activeWorkspaceId) return

        const conversationId = crypto.randomUUID()
        const now = new Date().toISOString()

        // Create in DB
        try {
            await codexApi.db.createConversation(conversationId, appState.activeWorkspaceId, 'New conversation')
        } catch (error) {
            console.error('[App] Failed to create conversation:', error)
            return
        }

        const newConversation: Conversation = {
            id: conversationId,
            workspaceId: appState.activeWorkspaceId,
            title: 'New conversation',
            createdAt: now,
            updatedAt: now,
            messages: []
        }

        setAppState(prev => ({
            ...prev,
            workspaces: prev.workspaces.map(w => {
                if (w.id !== prev.activeWorkspaceId) return w
                return {
                    ...w,
                    conversations: [...w.conversations, newConversation]
                }
            }),
            activeConversationId: conversationId
        }))

        // Focus input after new conversation
        setTimeout(() => inputRef.current?.focus(), 0)
    }, [appState.activeWorkspaceId])

    // Create new conversation in specific workspace
    const handleNewConversationInWorkspace = useCallback(async (workspaceId: string) => {
        const workspace = appState.workspaces.find(w => w.id === workspaceId)
        if (!workspace) return

        const conversationId = crypto.randomUUID()
        const now = new Date().toISOString()

        // Create in DB
        try {
            await codexApi.db.createConversation(conversationId, workspaceId, 'New conversation')
        } catch (error) {
            console.error('[App] Failed to create conversation:', error)
            return
        }

        const newConversation: Conversation = {
            id: conversationId,
            workspaceId: workspaceId,
            title: 'New conversation',
            createdAt: now,
            updatedAt: now,
            messages: []
        }

        setAppState(prev => ({
            ...prev,
            workspaces: prev.workspaces.map(w => {
                if (w.id !== workspaceId) return w
                return {
                    ...w,
                    conversations: [...w.conversations, newConversation]
                }
            }),
            activeWorkspaceId: workspaceId,
            activeConversationId: conversationId
        }))

        // Switch ACP session to this workspace
        {
            await codexApi.switchWorkspace(workspaceId, workspace.path)
        }

        // Focus input after new conversation
        setTimeout(() => inputRef.current?.focus(), 0)
    }, [appState.workspaces])

    // Delete conversation
    const handleDeleteConversation = useCallback(async (conversationId: string) => {
        // Delete from DB
        try {
            await codexApi.db.deleteConversation(conversationId)
        } catch (error) {
            console.error('[App] Failed to delete conversation:', error)
            return
        }

        setAppState(prev => {
            const updatedWorkspaces = prev.workspaces.map(w => ({
                ...w,
                conversations: w.conversations.filter(c => c.id !== conversationId)
            }))

            // If deleted conversation was active, select another one
            let newActiveConversationId = prev.activeConversationId
            if (prev.activeConversationId === conversationId) {
                const activeWorkspace = updatedWorkspaces.find(w => w.id === prev.activeWorkspaceId)
                newActiveConversationId = activeWorkspace?.conversations[0]?.id || null
            }

            return {
                ...prev,
                workspaces: updatedWorkspaces,
                activeConversationId: newActiveConversationId
            }
        })
    }, [])

    // Remove workspace from list (Close Folder)
    const handleRemoveWorkspace = useCallback(async (workspaceId: string) => {
        // Delete workspace and its conversations from DB
        try {
            await codexApi.db.deleteWorkspace(workspaceId)
        } catch (error) {
            console.error('[App] Failed to delete workspace:', error)
            return
        }

        setAppState(prev => {
            const updatedWorkspaces = prev.workspaces.filter(w => w.id !== workspaceId)

            // If removed workspace was active, select another one
            let newActiveWorkspaceId = prev.activeWorkspaceId
            let newActiveConversationId = prev.activeConversationId

            if (prev.activeWorkspaceId === workspaceId) {
                newActiveWorkspaceId = updatedWorkspaces[0]?.id || null
                newActiveConversationId = updatedWorkspaces[0]?.conversations[0]?.id || null
            }

            return {
                ...prev,
                workspaces: updatedWorkspaces,
                activeWorkspaceId: newActiveWorkspaceId,
                activeConversationId: newActiveConversationId
            }
        })
    }, [])

    const handleRenameWorkspace = useCallback(async (workspaceId: string, newName: string) => {
        const workspace = appState.workspaces.find(w => w.id === workspaceId)
        if (!workspace) return
        if (!newName || newName === workspace.name) return

        try {
            await codexApi.db.updateWorkspaceName(workspaceId, newName)
        } catch (error) {
            console.error('[App] Failed to rename workspace:', error)
            return
        }

        setAppState(prev => ({
            ...prev,
            workspaces: prev.workspaces.map(w => w.id === workspaceId ? { ...w, name: newName } : w)
        }))
    }, [appState.workspaces])



    const handleSubmit = useCallback(async (e?: React.FormEvent) => {
        e?.preventDefault()
        void codexApi.debugLog(`[handleSubmit] called, input: ${input.slice(0, 30)}`)
        if (!input.trim()) return

        let activeConvId = appState.activeConversationId
        let activeWsId = appState.activeWorkspaceId

        // Auto-create workspace if none exists
        if (!activeWsId || !activeConvId) {
            const workspaceId = crypto.randomUUID()
            const conversationId = crypto.randomUUID()
            const now = new Date().toISOString()
            const requestedWorkspacePath = '~'
            const workspaceName = 'Default'
            let workspacePath = requestedWorkspacePath

            try {
                const createdWorkspace = await codexApi.db.createWorkspace(
                    workspaceId,
                    workspaceName,
                    requestedWorkspacePath
                ) as { path?: string }
                if (createdWorkspace?.path) {
                    workspacePath = createdWorkspace.path
                }
                await codexApi.db.createConversation(conversationId, workspaceId, 'New conversation')
                await codexApi.switchWorkspace(workspaceId, workspacePath)
            } catch (error) {
                console.error('[handleSubmit] Failed to auto-create workspace:', error)
                return
            }

            const newWorkspace: Workspace = {
                id: workspaceId,
                name: workspaceName,
                path: workspacePath,
                conversations: [{
                    id: conversationId,
                    workspaceId,
                    title: 'New conversation',
                    createdAt: now,
                    updatedAt: now,
                    messages: []
                }]
            }

            setAppState(prev => ({
                ...prev,
                workspaces: [...prev.workspaces, newWorkspace],
                activeWorkspaceId: workspaceId,
                activeConversationId: conversationId
            }))

            activeConvId = conversationId
            activeWsId = workspaceId
        }

        // If already loading, save current response and cancel
        if (isLoading) {
            console.log('[App] Cancelling current response for new message')
            flushPendingStreamQueue(activeConvId, true)
            const currentStream = getConversationStream(activeConvId)

            // Save current streaming content as a message before canceling
            const currentContent = normalizeReadableMessage(currentStream?.content || '')
            const currentThinking = currentStream?.thinking || ''
            const duration = currentStream?.thinkingStartTime
                ? Math.round((Date.now() - currentStream.thinkingStartTime) / 1000)
                : 0

            if (currentContent || currentThinking) {
                const cancelledMessage: Message = {
                    id: crypto.randomUUID(),
                    conversationId: activeConvId,
                    role: 'assistant',
                    content: currentContent || t('responseCancelled'),
                    timestamp: new Date().toISOString(),
                    thinking: currentThinking || undefined,
                    thinkingDuration: duration || undefined
                }
                await addMessageToConversation(cancelledMessage)
            }

            resetConversationStream(activeConvId)
            await codexApi.cancelPrompt(activeConvId || '')
            // Small delay to ensure cancel completes
            await new Promise(r => setTimeout(r, 100))
        }

        const userMessage: Message = {
            id: crypto.randomUUID(),
            conversationId: activeConvId,
            role: 'user',
            content: attachedFiles.length > 0
                ? `${attachedFiles.map(f => `@${f.path}`).join(' ')}\n\n${input}`
                : input,
            timestamp: new Date().toISOString()
        }

        // Clear attached files after sending
        setAttachedFiles([])

        // Update conversation title if first user message
        if (messages.length === 0) {
            const newTitle = userMessage.content.slice(0, 30) + (userMessage.content.length > 30 ? '...' : '')

            // Update DB
            {
                codexApi.db.updateConversationTitle(activeConvId!, newTitle)
            }

            setAppState(prev => ({
                ...prev,
                workspaces: prev.workspaces.map(w => {
                    if (w.id !== activeWsId) return w
                    return {
                        ...w,
                        conversations: w.conversations.map(c => {
                            if (c.id !== activeConvId) return c
                            return { ...c, title: newTitle }
                        })
                    }
                })
            }))
        }

        await addMessageToConversation(userMessage)
        setInput('')
        resetConversationStream(activeConvId)
        const nextStream = getConversationStream(activeConvId)
        if (nextStream) {
            nextStream.thinkingStartTime = Date.now()
        }
        setConversationLoading(activeConvId, true)
        setThinkingStartTime(nextStream?.thinkingStartTime || null)
        setToolCalls([])
        // Reset Antigravity-style tracking for new message
        setSearchLogs([])
        setTaskSummary(null)
        setProgressUpdates([])
        setFileEdits([])

        // Refocus textarea
        setTimeout(() => inputRef.current?.focus(), 0)

        try {
            void codexApi.debugLog(`[handleSubmit] calling streamCodex, convId: ${activeConvId}`)
            const recentHistory = messages.slice(-6).map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content
            }))
            await codexApi.streamCodex(activeConvId || '', userMessage.content, recentHistory)
            void codexApi.debugLog('[handleSubmit] streamCodex returned successfully')
        } catch (error) {
            void codexApi.debugLog(`[handleSubmit] streamCodex FAILED: ${error}`)
            setConversationLoading(activeConvId, false)
        }
    }, [input, appState, messages.length, isLoading, attachedFiles, flushPendingStreamQueue, getConversationStream, resetConversationStream, setConversationLoading])







    // Handle input change with @ detection and auto-resize
    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value
        setInput(value)

        // Auto-resize textarea
        e.target.style.height = 'auto'
        e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`

        // Detect @ character and show context menu
        const cursorPosition = e.target.selectionStart
        const textBeforeCursor = value.slice(0, cursorPosition)
        const atMatch = textBeforeCursor.match(/@([^\s@]*)$/)

        if (atMatch) {
            setShowContextMenu(true)
            setContextQuery(atMatch[1]) // The text after @
        } else {
            setShowContextMenu(false)
            setContextQuery('')
        }
    }, [])

    // Handle file selection from context menu
    const handleFileSelect = useCallback((file: FileSearchResult) => {
        // Find the @ position and replace @query with @relativePath
        const cursorPosition = inputRef.current?.selectionStart || 0
        const textBeforeCursor = input.slice(0, cursorPosition)
        const atMatch = textBeforeCursor.match(/@([^\s@]*)$/)

        if (atMatch) {
            const atStart = cursorPosition - atMatch[0].length
            const newInput = input.slice(0, atStart) + `@${file.relativePath} ` + input.slice(cursorPosition)
            setInput(newInput)

            // Add to attached files
            if (!attachedFiles.find(f => f.path === file.path)) {
                setAttachedFiles([...attachedFiles, file])
            }
        }

        setShowContextMenu(false)
        setContextQuery('')
        inputRef.current?.focus()
    }, [input, attachedFiles])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Don't handle Enter when context menu is open (let ContextMenu handle it)
        if (showContextMenu && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Enter' || e.key === 'Escape')) {
            return // Let ContextMenu handle these keys
        }

        // Prevent double submit with IME (Korean, Japanese, etc.)
        if (e.nativeEvent.isComposing) {
            return
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
            // Ensure focus stays on textarea after submit
            setTimeout(() => inputRef.current?.focus(), 10)
        }
    }, [showContextMenu, handleSubmit])

    // Extracted inline handlers (stable references for memo'd children)
    const handleToggleSidebar = useCallback(() => {
        setSidebarExpanded(prev => !prev)
    }, [])



    const handleToggleYolo = useCallback(async (value: boolean) => {
        setYoloMode(value)
        await codexApi.setYoloMode(value)
    }, [])



    const handleApprovalResponse = useCallback(async (requestId: string, approved: boolean) => {
        await codexApi.respondToApproval(requestId, approved)
        setApprovalRequest(null)
    }, [])

    const handleCloseContextMenu = useCallback(() => {
        setShowContextMenu(false)
        setContextQuery('')
    }, [])

    const handleLogout = useCallback(async () => {
        await codexApi.codexLogout()
        setUser(null)
    }, [])

    const handleTitleBarLogin = useCallback(async () => {
        const result = await codexApi.codexLogin('browser')
        if (result?.success && result.user) {
            setUser(result.user)
        }
    }, [])

    const handleOpenSettings = useCallback((tab?: SettingsTabId) => {
        setSettingsTab(tab)
        setShowSettings(true)
    }, [])



    const handleCancelStream = useCallback(async () => {
        const conversationId = appState.activeConversationId
        if (!conversationId) return
        flushPendingStreamQueue(conversationId, true)
        setConversationLoading(conversationId, false)
        await codexApi.cancelPrompt(conversationId)
        setToolCalls([])
    }, [appState.activeConversationId, flushPendingStreamQueue, setConversationLoading])

    const handleRemoveAttachedFile = useCallback((filePath: string) => {
        setAttachedFiles(prev => prev.filter(f => f.path !== filePath))
    }, [])

    const handleAttachFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files) return
        const workspacePath = activeWorkspace?.path || ''
        const newFiles: FileSearchResult[] = []
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const filePath = (file as any).path || file.name
            const relativePath = workspacePath && filePath.startsWith(workspacePath)
                ? filePath.slice(workspacePath.length + 1)
                : file.name
            if (!attachedFiles.find(f => f.path === filePath)) {
                newFiles.push({
                    name: file.name,
                    path: filePath,
                    relativePath,
                    isDirectory: false
                })
            }
        }
        if (newFiles.length > 0) {
            setAttachedFiles(prev => [...prev, ...newFiles])
        }
        // Reset input so re-selecting the same file works
        e.target.value = ''
    }, [activeWorkspace?.path, attachedFiles])

    // Show loading while DB loads
    if (!dbLoaded) {
        return (
            <div className="flex items-center justify-center h-screen bg-bg-deep">
                <div className="text-text-muted">{t('loading')}</div>
            </div>
        )
    }
    // Show login screen if not authenticated
    if (!user) {
        return (
            <div className="flex flex-col h-screen w-full bg-[var(--color-bg-deep)] overflow-hidden">
                {/* Title Bar */}
                <div className="drag-region h-9 bg-[var(--color-bg-sidebar)] border-b border-[var(--color-border)] flex items-center justify-center pl-20 flex-shrink-0">
                    <span className="text-xs text-[var(--color-text-muted)]">Codex UI</span>
                </div>

                {/* Centered Login */}
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <div className="text-center">
                        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)] mb-2">Codex UI</h1>

                    </div>
                    <div className="w-full max-w-sm flex flex-col gap-3">
                        <button
                            onClick={() => void handleCodexLogin()}
                            disabled={authBusy}
                            className="px-4 py-2.5 bg-[var(--color-bg-card)] hover:bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg transition-colors text-sm"
                        >
                            {authBusy ? t('loginBusy') : t('loginButton')}
                        </button>
                        {authError && (
                            <div className="text-xs text-red-500">{authError}</div>
                        )}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-screen w-full bg-[var(--color-bg-deep)] overflow-hidden">
            {/* Title Bar */}
            <div className="drag-region h-9 bg-[var(--color-bg-sidebar)] border-b border-[var(--color-border)] flex items-center pl-20 pr-4 flex-shrink-0 relative">
                {/* Centered title using absolute positioning */}
                <span className="absolute left-1/2 -translate-x-1/2 text-xs text-[var(--color-text-muted)]">Codex UI</span>

                {/* Right side spacer to push user profile to the right */}
                <div className="flex-1" />

                {/* User Profile / Login - no-drag to allow clicks */}
                <div className="no-drag flex items-center gap-3">

                    {user ? (
                        <div className="flex items-center gap-2">
                            {user.picture && (
                                <img
                                    src={user.picture}
                                    alt={user.name}
                                    className="w-5 h-5 rounded-full"
                                />
                            )}
                            {user.name && user.email && (
                                <span className="text-[10px] text-[var(--color-text-secondary)]">{user.name}</span>
                            )}
                            <button
                                onClick={handleLogout}
                                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                            >
                                Logout
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleTitleBarLogin}
                            className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[var(--color-bg-card)] hover:bg-[var(--color-border)] rounded transition-colors"
                        >
                            Login
                        </button>
                    )}
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <Sidebar
                    expanded={sidebarExpanded}
                    onToggle={handleToggleSidebar}
                    workspaces={appState.workspaces}
                    activeWorkspaceId={appState.activeWorkspaceId}
                    activeConversationId={appState.activeConversationId}
                    isLoading={isLoading}
                    loadingConversationIds={loadingConversationIds}
                    onAddWorkspace={handleAddWorkspace}
                    onSelectWorkspace={handleSelectWorkspace}
                    onSelectConversation={handleSelectConversation}
                    onNewConversation={handleNewConversation}
                    onNewConversationInWorkspace={handleNewConversationInWorkspace}
                    onDeleteConversation={handleDeleteConversation}
                    onRemoveWorkspace={handleRemoveWorkspace}
                    onRenameWorkspace={handleRenameWorkspace}
                    onOpenSettings={handleOpenSettings}
                    activeConversationHasApproval={Boolean(approvalRequest)}
                />

                {/* Main Content */}
                <main className="flex-1 flex flex-col overflow-hidden">
                    {/* Header */}
                    <header className="flex items-center justify-between px-4 h-10 border-b border-[var(--color-border)] bg-[var(--color-bg-sidebar)]">
                        <div className="flex items-center gap-1.5 text-sm">
                            <span className="text-[var(--color-text-secondary)]">{activeWorkspace?.name || 'No workspace'}</span>
                            <span className="text-[var(--color-text-muted)]">/</span>
                            <span className="text-[var(--color-text-primary)]">{activeConversation?.title || 'Select a conversation'}</span>
                        </div>

                    </header>

                    {/* Chat Area */}
                    <div className="flex-1 flex flex-col overflow-hidden">

                        <ChatPanel
                            messages={messages}
                            streamingContent={streamingContent}
                            streamingThinking={streamingThinking}
                            isLoading={isLoading}
                            thinkingStartTime={thinkingStartTime}
                            toolCalls={toolCalls}
                            terminalOutput={terminalOutput}
                            progressUpdates={progressUpdates}
                            fileEdits={fileEdits}
                            backgroundCommands={backgroundCommands}
                            currentTaskName={currentTaskName}
                            searchLogs={searchLogs}
                            taskSummary={taskSummary}
                            approvalRequest={approvalRequest}
                            onApprovalResponse={handleApprovalResponse}
                            onSendToTeams={teamsWebhookUrl.trim() ? async (content) => {
                                const result = await codexApi.sendToTeams(
                                    teamsWebhookUrl,
                                    `Codex AI Response`,
                                    content
                                )
                                if (!result.success) {
                                    console.error('[Teams] Failed to send:', result.error)
                                }
                            } : undefined}
                        />

                        {/* Input Area */}
                        <div className="p-4 relative z-50 bg-[var(--color-bg-deep)]">
                            <div className="max-w-3xl mx-auto relative">
                                {/* Context Menu */}
                                <ContextMenu
                                    visible={showContextMenu}
                                    query={contextQuery}
                                    workspacePath={activeWorkspace?.path || ''}
                                    position={contextMenuPosition}
                                    onSelect={handleFileSelect}
                                    onClose={handleCloseContextMenu}
                                />

                                <div className="bg-[var(--color-bg-sidebar)] border border-[var(--color-border)] rounded-lg p-3 flex flex-col gap-3">
                                    {/* Attached files display */}
                                    {attachedFiles.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {attachedFiles.map(file => (
                                                <div
                                                    key={file.path}
                                                    className="flex items-center gap-1.5 bg-[var(--color-bg-card)] text-[var(--color-text-primary)] px-2 py-1 rounded text-[11px] border border-[var(--color-border)]"
                                                >
                                                    <span className="truncate max-w-[150px]">{file.name}</span>
                                                    <button
                                                        onClick={() => handleRemoveAttachedFile(file.path)}
                                                        className="text-red-500 hover:text-red-400"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <textarea
                                        ref={inputRef}
                                        data-testid="chat-input"
                                        value={input}
                                        onChange={handleInputChange}
                                        onKeyDown={handleKeyDown}
                                        placeholder={
                                            !activeWorkspace ? t('chatPlaceholderNoWorkspace') :
                                                isLoading ? t('chatPlaceholderLoading') :
                                                    t('chatPlaceholder')
                                        }
                                        className="w-full resize-none bg-transparent border-none outline-none text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] min-h-[24px] max-h-[200px] text-[12px] overflow-y-auto"
                                        rows={1}
                                        style={{ height: 'auto' }}
                                    />
                                    <div className="flex items-center justify-between">
                                        {/* Model Selector */}
                                        <div className="flex items-center gap-2">
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                multiple
                                                className="hidden"
                                                onChange={handleAttachFiles}
                                            />
                                            <button
                                                onClick={() => fileInputRef.current?.click()}
                                                className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card)] transition-colors"
                                                title="Attach file"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                                </svg>
                                            </button>
                                            <ModelSelector
                                                model={model}
                                                onModelChange={setModel}
                                            />
                                        </div>

                                        {/* Send/Stop Button */}
                                        {isLoading ? (
                                            <button
                                                onClick={handleCancelStream}
                                                data-testid="chat-stop-button"
                                                className="w-8 h-8 rounded-full flex items-center justify-center bg-red-500 hover:bg-red-600 text-white transition-colors"
                                                title={t('stopResponse')}
                                            >
                                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                    <rect x="6" y="6" width="12" height="12" rx="1" />
                                                </svg>
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleSubmit}
                                                data-testid="chat-send-button"
                                                disabled={!input.trim() || !acpReady}
                                                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${input.trim() && acpReady
                                                    ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-deep)] hover:opacity-80'
                                                    : 'bg-[var(--color-border)] text-[var(--color-text-muted)]'
                                                    }`}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
            </div>

            {/* Lazy-loaded modals */}
            <Suspense fallback={null}>
                <SettingsPanel
                    visible={showSettings}
                    onClose={() => {
                        setShowSettings(false)
                        setSettingsTab(undefined)
                    }}
                    initialTab={settingsTab}
                    yoloMode={yoloMode}
                    onYoloModeChange={handleToggleYolo}
                    cliOptions={cliOptions}
                    onCliOptionsChange={(partial) => setCliOptions(prev => ({ ...prev, ...partial } as CliOptions))}
                    model={model.id}
                    onModelChange={(id) => {
                        const found = AVAILABLE_MODELS.find(m => m.id === id)
                        if (found) setModel(found)
                        else setModel({ id, name: id, description: '', isThinking: false })
                    }}
                    teamsWebhookUrl={teamsWebhookUrl}
                    teamsAutoForward={teamsAutoForward}
                    onTeamsSettingsChange={(settings) => {
                        if (settings.webhookUrl !== undefined) {
                            setTeamsWebhookUrl(settings.webhookUrl)
                            localStorage.setItem('codex.teams.webhookUrl', settings.webhookUrl)
                        }
                        if (settings.autoForward !== undefined) {
                            setTeamsAutoForward(settings.autoForward)
                            localStorage.setItem('codex.teams.autoForward', String(settings.autoForward))
                        }
                    }}
                />

                {/* Update Checker */}
                <UpdateChecker currentVersion="0.1.0" />
            </Suspense>

            {/* Status Bar */}
            <StatusBar
                theme={theme}
                onThemeChange={setTheme}
                workspacePath={activeWorkspace?.path}
                yoloMode={yoloMode}
                onYoloModeChange={handleToggleYolo}
                webSearchEnabled={cliOptions.enableWebSearch}
                onWebSearchChange={(value) => setCliOptions(prev => ({ ...prev, enableWebSearch: value } as CliOptions))}
            />
        </div>
    )
}

export default App

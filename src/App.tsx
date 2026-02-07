import { useState, useRef, useEffect, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'


import { ModelSelector, AVAILABLE_MODELS, type ModelConfig } from './components/ModelSelector'
import { StatusBar } from './components/StatusBar'
import { ContextMenu } from './components/ContextMenu'
import { CliControlPanel, type CliOptions, type CliPreset } from './components/CliControlPanel'
import { getSavedTheme, applyTheme, type Theme } from './themes'

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

const DEFAULT_CLI_OPTIONS: CliOptions = {
    profile: '',
    sandbox: 'workspace-write',
    askForApproval: 'on-request',
    skipGitRepoCheck: true,
    cwdOverride: '',
    extraArgs: '',
    enableWebSearch: false
}

const CLI_PRESETS_KEY = 'codex.cli.presets.v1'
const WORKSPACE_PRESET_MAP_KEY = 'codex.cli.workspacePresetMap.v1'


function App() {
    // Codex installation state
    const [codexChecked, setCodexChecked] = useState(false)
    const [codexInstalled, setCodexInstalled] = useState(false)
    const [isInstallingCodex, setIsInstallingCodex] = useState(false)
    const [installProgress, setInstallProgress] = useState<{ status: string; message: string } | null>(null)

    // App state with workspaces and conversations
    const [appState, setAppState] = useState<AppState>({
        workspaces: [],
        activeWorkspaceId: null,
        activeConversationId: null
    })
    const [input, setInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [streamingContent, setStreamingContent] = useState('')
    const [streamingThinking, setStreamingThinking] = useState('')
    const [sidebarExpanded, setSidebarExpanded] = useState(true)
    const [model, setModel] = useState<ModelConfig>(AVAILABLE_MODELS[0]) // Default to GPT-5.3 Codex
    const [acpReady, setAcpReady] = useState(false)
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
    const [backgroundCommands, setBackgroundCommands] = useState<{ id: string; command: string; cwd: string; output: string; status: 'running' | 'done'; exitCode?: number }[]>([])
    const [currentTaskName, setCurrentTaskName] = useState<string>('')
    // New Antigravity-style states
    const [searchLogs, setSearchLogs] = useState<{ query: string; results: number }[]>([])
    const [taskSummary, setTaskSummary] = useState<{ title: string; summary: string } | null>(null)
    const [user, setUser] = useState<CodexUser | null>(null)
    const [authBusy, setAuthBusy] = useState(false)
    const [authError, setAuthError] = useState('')
    const [apiKeyInput, setApiKeyInput] = useState('')
    const [yoloMode, setYoloMode] = useState(true) // Auto-approve by default
    const [approvalRequest, setApprovalRequest] = useState<{ requestId: string; title: string; description: string } | null>(null)
    const [showCliPanel, setShowCliPanel] = useState(false)
    const [cliOptions, setCliOptions] = useState<CliOptions>(DEFAULT_CLI_OPTIONS)
    const [cliPresets, setCliPresets] = useState<CliPreset[]>([])
    const [selectedPresetId, setSelectedPresetId] = useState('')
    const [cliCommandOutput, setCliCommandOutput] = useState('')

    const inputRef = useRef<HTMLTextAreaElement>(null)
    const handleCodexLogin = useCallback(async (method: 'browser' | 'device-auth' | 'api-key') => {
        if (authBusy) return
        if (method === 'api-key' && !apiKeyInput.trim()) {
            setAuthError('API key is required.')
            return
        }

        setAuthBusy(true)
        setAuthError('')
        try {
            const result = await window.codexApi?.codexLogin(
                method,
                method === 'api-key' ? apiKeyInput.trim() : undefined
            )
            if (result?.success && result.user) {
                setUser(result.user)
                setApiKeyInput('')
                return
            }
            setAuthError(result?.error || 'Login failed.')
        } catch (error) {
            setAuthError(String(error))
        } finally {
            setAuthBusy(false)
        }
    }, [apiKeyInput, authBusy])

    // Derived state
    const activeWorkspace = appState.workspaces.find(w => w.id === appState.activeWorkspaceId) || null
    const activeConversation = activeWorkspace?.conversations.find(c => c.id === appState.activeConversationId) || null
    const messages = activeConversation?.messages || []

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
                await window.codexApi?.setYoloMode(newValue)
                console.log(`[App] YOLO mode ${newValue ? 'enabled' : 'disabled'} (Ctrl+Y)`)
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                setShowCliPanel(prev => !prev)
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
                    window.codexApi?.getYoloMode?.(),
                    window.codexApi?.getCliOptions?.()
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
        window.codexApi?.setModel?.(model.id).catch((error: unknown) => {
            console.error('[App] Failed to set model:', error)
        })
    }, [model])

    // Push CLI options whenever UI changes
    useEffect(() => {
        window.codexApi?.setCliOptions?.(cliOptions).catch(error => {
            console.error('[App] Failed to set CLI options:', error)
        })
    }, [cliOptions])

    // Load state from SQLite on startup
    useEffect(() => {
        async function loadFromDb() {
            if (!window.codexApi?.db) return
            try {
                const state = await window.codexApi.db.getState()
                setAppState({
                    workspaces: state.workspaces,
                    activeWorkspaceId: state.workspaces[0]?.id || null,
                    activeConversationId: state.workspaces[0]?.conversations[0]?.id || null
                })
                setDbLoaded(true)
                console.log('[App] Loaded state from DB:', state.workspaces.length, 'workspaces')
            } catch (error) {
                console.error('[App] Failed to load from DB:', error)
                setDbLoaded(true)
            }
        }
        loadFromDb()
    }, [])

    // Load stored CLI presets
    useEffect(() => {
        try {
            const raw = localStorage.getItem(CLI_PRESETS_KEY)
            if (!raw) return
            const parsed = JSON.parse(raw) as CliPreset[]
            if (Array.isArray(parsed)) {
                setCliPresets(parsed)
            }
        } catch (error) {
            console.error('[App] Failed to load CLI presets:', error)
        }
    }, [])

    // Persist CLI presets
    useEffect(() => {
        localStorage.setItem(CLI_PRESETS_KEY, JSON.stringify(cliPresets))
    }, [cliPresets])

    // Apply workspace preset automatically when workspace changes
    useEffect(() => {
        if (!activeWorkspace?.path) return
        try {
            const raw = localStorage.getItem(WORKSPACE_PRESET_MAP_KEY)
            if (!raw) return
            const mapping = JSON.parse(raw) as Record<string, string>
            const presetId = mapping[activeWorkspace.path]
            if (!presetId) return
            const preset = cliPresets.find(p => p.id === presetId)
            if (!preset) return
            setSelectedPresetId(preset.id)
            setCliOptions(preset.options)
        } catch (error) {
            console.error('[App] Failed to apply workspace preset:', error)
        }
    }, [activeWorkspace?.path, cliPresets])

    // Apply saved theme on startup
    useEffect(() => {
        applyTheme(theme)
    }, [])

    // Check Codex CLI installation on startup
    useEffect(() => {
        const checkCodexInstallation = async () => {
            try {
                const result = await window.codexApi?.checkCodex()
                if (result?.installed) {
                    setCodexInstalled(true)
                }
                setCodexChecked(true)
            } catch (error) {
                console.error('[App] Failed to check Codex installation:', error)
                setCodexChecked(true)
            }
        }
        checkCodexInstallation()

        // Listen for install progress
        window.codexApi?.onCodexInstallProgress?.((data) => {
            setInstallProgress(data)
            if (data.status === 'complete') {
                setCodexInstalled(true)
                setIsInstallingCodex(false)
            } else if (data.status === 'error') {
                setIsInstallingCodex(false)
            }
        })
    }, [])

    // Refs for latest values in event handlers
    const streamingContentRef = useRef('')
    const streamingThinkingRef = useRef('')
    const thinkingStartTimeRef = useRef<number | null>(null)
    const appStateRef = useRef(appState)

    // Keep refs in sync
    useEffect(() => {
        streamingContentRef.current = streamingContent
    }, [streamingContent])

    useEffect(() => {
        streamingThinkingRef.current = streamingThinking
    }, [streamingThinking])

    useEffect(() => {
        thinkingStartTimeRef.current = thinkingStartTime
    }, [thinkingStartTime])

    useEffect(() => {
        appStateRef.current = appState
    }, [appState])

    // Load initial user and check on window focus (for after browser auth)
    useEffect(() => {
        const checkUser = () => {
            window.codexApi?.getUser().then(u => {
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
        if (!window.codexApi) return

        window.codexApi.onAcpReady?.((ready: boolean) => {
            console.log('ACP Ready:', ready)
            setAcpReady(ready)
        })

        window.codexApi.onThinking?.((text: string) => {
            if (!thinkingStartTimeRef.current) {
                setThinkingStartTime(Date.now())
            }
            streamingThinkingRef.current += text
            setStreamingThinking(prev => prev + text)
        })

        // Handle streaming content delta with auto line breaks
        window.codexApi.onStreamDelta?.((delta: string) => {
            setStreamingContent(prev => {
                // Auto add line breaks before bold text patterns that indicate new sections
                let processedDelta = delta

                // If previous content exists and delta starts with bold pattern, add line break
                if (prev.length > 0 && !prev.endsWith('\n') && !prev.endsWith('\n\n')) {
                    // Check for section-like patterns at start of delta
                    if (/^(\*\*|##|###|[0-9]+\.)/.test(delta.trim())) {
                        processedDelta = '\n\n' + delta
                    }
                }

                return prev + processedDelta
            })
        })

        window.codexApi.onToolCall?.((data: { title: string; status: string }) => {
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
                data.title.toLowerCase().includes('완료')) {
                setTaskSummary({
                    title: currentTaskName || '작업 완료',
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
                            status: data.status === 'done' ? 'done' : 'running'
                        }]
                    })
                }
            }

            // Add to progress updates
            setProgressUpdates(prev => {
                const stepNumber = prev.length + 1
                const status = data.status === 'done' ? 'done' : data.status === 'running' ? 'running' : 'pending'
                const existingIndex = prev.findIndex(p => p.title === data.title)
                if (existingIndex >= 0) {
                    const updated = [...prev]
                    updated[existingIndex] = { ...updated[existingIndex], status: status as any }
                    return updated
                }
                return [...prev, { stepNumber, title: data.title, status: status as any, timestamp }]
            })
        })

        window.codexApi.onTerminalOutput?.((data: { terminalId: string; output: string; exitCode: number | null }) => {
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
                        status: data.exitCode !== null ? 'done' : 'running',
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
                        status: data.exitCode !== null ? 'done' : 'running',
                        exitCode: data.exitCode ?? undefined
                    }]
                }
            })
        })

        // Register approval request callback
        window.codexApi.onApprovalRequest?.((data: { requestId: string; title: string; description: string }) => {
            console.log('[App] Approval request:', data)
            setApprovalRequest(data)
        })

        window.codexApi.onStreamToken((token: string) => {
            streamingContentRef.current += token
            setStreamingContent(prev => prev + token)
        })

        window.codexApi.onStreamEnd(() => {
            const duration = thinkingStartTimeRef.current
                ? Math.round((Date.now() - thinkingStartTimeRef.current) / 1000)
                : 0

            // Add message to active conversation
            const content = streamingContentRef.current
            const thinking = streamingThinkingRef.current
            const conversationId = appStateRef.current.activeConversationId

            if (content || thinking) {
                const newMessage: Message = {
                    id: crypto.randomUUID(),
                    conversationId: conversationId || '',
                    role: 'assistant',
                    content: content,
                    timestamp: new Date().toISOString(),
                    thinking: thinking || undefined,
                    thinkingDuration: duration || undefined
                }

                addMessageToActiveConversation(newMessage)
            }

            setStreamingContent('')
            setStreamingThinking('')
            streamingContentRef.current = ''
            streamingThinkingRef.current = ''
            setThinkingStartTime(null)
            setToolCalls([])
            // Reset Antigravity-style progress states
            setProgressUpdates([])
            setFileEdits([])
            setBackgroundCommands([])
            setCurrentTaskName('')
            setIsLoading(false)
        })

        window.codexApi.onStreamError((error: string) => {
            console.error('Stream error:', error)
            setStreamingContent('')
            setStreamingThinking('')
            setThinkingStartTime(null)
            setIsLoading(false)

            const errorMessage: Message = {
                id: crypto.randomUUID(),
                conversationId: appStateRef.current.activeConversationId || '',
                role: 'assistant',
                content: `오류가 발생했습니다: ${error}`,
                timestamp: new Date().toISOString()
            }
            addMessageToActiveConversation(errorMessage)
        })
    }, []) // Empty dependency - only run once

    // Add message to active conversation (updates state and DB)
    const addMessageToActiveConversation = async (message: Message) => {
        // Use ref to get latest state values (for use in event handlers)
        const currentState = appStateRef.current
        if (!currentState.activeWorkspaceId || !currentState.activeConversationId) {
            console.warn('[App] No active workspace/conversation, skipping message save')
            return
        }

        // Save to DB
        try {
            await window.codexApi?.db.createMessage(message)
        } catch (error) {
            console.error('[App] Failed to save message:', error)
        }

        // Update state
        setAppState(prev => ({
            ...prev,
            workspaces: prev.workspaces.map(w => {
                if (w.id !== prev.activeWorkspaceId) return w
                return {
                    ...w,
                    conversations: w.conversations.map(c => {
                        if (c.id !== prev.activeConversationId) return c
                        return {
                            ...c,
                            messages: [...c.messages, message],
                            updatedAt: new Date().toISOString()
                        }
                    })
                }
            })
        }))
    }

    // Add workspace
    const handleAddWorkspace = async () => {
        if (!window.codexApi?.openWorkspace) return

        const result = await window.codexApi.openWorkspace()
        if (!result) return

        const workspaceId = crypto.randomUUID()
        const conversationId = crypto.randomUUID()
        const now = new Date().toISOString()

        // Create in DB
        try {
            await window.codexApi.db.createWorkspace(workspaceId, result.name, result.path)
            await window.codexApi.db.createConversation(conversationId, workspaceId, 'New conversation')
        } catch (error) {
            console.error('[App] Failed to create workspace:', error)
            return
        }

        const newWorkspace: Workspace = {
            id: workspaceId,
            name: result.name,
            path: result.path,
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
        if (window.codexApi?.switchWorkspace) {
            await window.codexApi.switchWorkspace(workspaceId, result.path)
        }
    }

    // Select workspace
    const handleSelectWorkspace = async (workspaceId: string) => {
        const workspace = appState.workspaces.find(w => w.id === workspaceId)
        if (!workspace) return

        setAppState(prev => ({
            ...prev,
            activeWorkspaceId: workspaceId,
            activeConversationId: workspace.conversations[0]?.id || null
        }))

        // Switch ACP session
        if (window.codexApi?.switchWorkspace) {
            await window.codexApi.switchWorkspace(workspaceId, workspace.path)
        }
    }

    // Select conversation
    const handleSelectConversation = async (conversationId: string) => {
        // Find which workspace this conversation belongs to
        const workspace = appState.workspaces.find(w =>
            w.conversations.some(c => c.id === conversationId)
        )

        // If switching to a different workspace, remount CLI
        if (workspace && workspace.id !== appState.activeWorkspaceId) {
            if (window.codexApi?.switchWorkspace) {
                await window.codexApi.switchWorkspace(workspace.id, workspace.path)
            }
        }

        setAppState(prev => ({
            ...prev,
            activeWorkspaceId: workspace?.id || prev.activeWorkspaceId,
            activeConversationId: conversationId
        }))
    }

    // Create new conversation in active workspace
    const handleNewConversation = async () => {
        if (!appState.activeWorkspaceId) return

        const conversationId = crypto.randomUUID()
        const now = new Date().toISOString()

        // Create in DB
        try {
            await window.codexApi?.db.createConversation(conversationId, appState.activeWorkspaceId, 'New conversation')
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
    }

    // Create new conversation in specific workspace
    const handleNewConversationInWorkspace = async (workspaceId: string) => {
        const workspace = appState.workspaces.find(w => w.id === workspaceId)
        if (!workspace) return

        const conversationId = crypto.randomUUID()
        const now = new Date().toISOString()

        // Create in DB
        try {
            await window.codexApi?.db.createConversation(conversationId, workspaceId, 'New conversation')
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
        if (window.codexApi?.switchWorkspace) {
            await window.codexApi.switchWorkspace(workspaceId, workspace.path)
        }

        // Focus input after new conversation
        setTimeout(() => inputRef.current?.focus(), 0)
    }

    // Delete conversation
    const handleDeleteConversation = async (conversationId: string) => {
        // Delete from DB
        try {
            await window.codexApi?.db.deleteConversation(conversationId)
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
    }

    // Remove workspace from list (Close Folder)
    const handleRemoveWorkspace = async (workspaceId: string) => {
        // Delete workspace and its conversations from DB
        try {
            await window.codexApi?.db.deleteWorkspace(workspaceId)
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
    }



    const handleSubmit = useCallback(async (e?: React.FormEvent) => {
        e?.preventDefault()
        if (!input.trim() || !appState.activeWorkspaceId || !appState.activeConversationId) return

        // If already loading, save current response and cancel
        if (isLoading) {
            console.log('[App] Cancelling current response for new message')

            // Save current streaming content as a message before canceling
            const currentContent = streamingContentRef.current
            const currentThinking = streamingThinkingRef.current
            const duration = thinkingStartTimeRef.current
                ? Math.round((Date.now() - thinkingStartTimeRef.current) / 1000)
                : 0

            if (currentContent || currentThinking) {
                const cancelledMessage: Message = {
                    id: crypto.randomUUID(),
                    conversationId: appState.activeConversationId,
                    role: 'assistant',
                    content: currentContent || '(응답이 취소됨)',
                    timestamp: new Date().toISOString(),
                    thinking: currentThinking || undefined,
                    thinkingDuration: duration || undefined
                }
                await addMessageToActiveConversation(cancelledMessage)

                // Clear streaming state
                streamingContentRef.current = ''
                streamingThinkingRef.current = ''
                setStreamingContent('')
                setStreamingThinking('')
            }

            await window.codexApi?.cancelPrompt()
            // Small delay to ensure cancel completes
            await new Promise(r => setTimeout(r, 100))
        }

        const userMessage: Message = {
            id: crypto.randomUUID(),
            conversationId: appState.activeConversationId,
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
            if (window.codexApi?.db) {
                window.codexApi.db.updateConversationTitle(appState.activeConversationId, newTitle)
            }

            setAppState(prev => ({
                ...prev,
                workspaces: prev.workspaces.map(w => {
                    if (w.id !== prev.activeWorkspaceId) return w
                    return {
                        ...w,
                        conversations: w.conversations.map(c => {
                            if (c.id !== prev.activeConversationId) return c
                            return { ...c, title: newTitle }
                        })
                    }
                })
            }))
        }

        await addMessageToActiveConversation(userMessage)
        setInput('')
        setIsLoading(true)
        setStreamingContent('')
        setStreamingThinking('')
        setToolCalls([])
        setThinkingStartTime(Date.now())
        // Reset Antigravity-style tracking for new message
        setSearchLogs([])
        setTaskSummary(null)
        setProgressUpdates([])
        setFileEdits([])

        // Refocus textarea
        setTimeout(() => inputRef.current?.focus(), 0)

        try {
            if (window.codexApi) {
                // 최근 3개 검색 기록 전달
                const recentHistory = messages.slice(-6).map(m => ({
                    role: m.role as 'user' | 'assistant',
                    content: m.content
                }))
                await window.codexApi.streamCodex(userMessage.content, recentHistory)
            }
        } catch (error) {
            console.error('Failed to send message:', error)
            setIsLoading(false)
        }
    }, [input, appState, messages.length, isLoading, attachedFiles])

    const saveWorkspacePresetMapping = (workspacePath: string, presetId: string) => {
        try {
            const raw = localStorage.getItem(WORKSPACE_PRESET_MAP_KEY)
            const mapping = raw ? JSON.parse(raw) as Record<string, string> : {}
            mapping[workspacePath] = presetId
            localStorage.setItem(WORKSPACE_PRESET_MAP_KEY, JSON.stringify(mapping))
        } catch (error) {
            console.error('[App] Failed to save workspace preset mapping:', error)
        }
    }

    const handleApplyPreset = (presetId: string) => {
        const preset = cliPresets.find(p => p.id === presetId)
        if (!preset) return
        setCliOptions(preset.options)
        setSelectedPresetId(preset.id)
        if (activeWorkspace?.path) {
            saveWorkspacePresetMapping(activeWorkspace.path, preset.id)
        }
    }

    const handleSavePreset = (name: string) => {
        const preset: CliPreset = {
            id: crypto.randomUUID(),
            name,
            options: cliOptions
        }
        setCliPresets(prev => [...prev, preset])
        setSelectedPresetId(preset.id)
        if (activeWorkspace?.path) {
            saveWorkspacePresetMapping(activeWorkspace.path, preset.id)
        }
    }

    const handleDeletePreset = (presetId: string) => {
        setCliPresets(prev => prev.filter(p => p.id !== presetId))
        if (selectedPresetId === presetId) {
            setSelectedPresetId('')
        }
    }

    const handleSelectPreset = (presetId: string) => {
        setSelectedPresetId(presetId)
        if (activeWorkspace?.path && presetId) {
            saveWorkspacePresetMapping(activeWorkspace.path, presetId)
        }
    }

    const runCodexSubcommand = async (subcommand: string, args: string[] = []) => {
        const result = await window.codexApi?.runCodexCommand?.(
            subcommand,
            args,
            activeWorkspace?.path
        )
        if (!result) return
        const header = `$ codex ${subcommand} ${args.join(' ')}`.trim()
        const output = [header, '', result.stdout || '', result.stderr || '']
            .filter(Boolean)
            .join('\n')
        setCliCommandOutput(output)
    }

    const handleRunQuickCommand = async (command: 'version' | 'exec-help' | 'review-help' | 'mcp-help' | 'features') => {
        switch (command) {
            case 'version':
                await runCodexSubcommand('--version')
                break
            case 'exec-help':
                await runCodexSubcommand('exec', ['--help'])
                break
            case 'review-help':
                await runCodexSubcommand('review', ['--help'])
                break
            case 'mcp-help':
                await runCodexSubcommand('mcp', ['--help'])
                break
            case 'features':
                await runCodexSubcommand('features')
                break
        }
    }

    const handleRunCustomCodexCommand = async (raw: string) => {
        const trimmed = raw.trim()
        if (!trimmed) return
        const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(token => token.replace(/^['"]|['"]$/g, '')) || []
        if (tokens.length === 0) return
        const [subcommand, ...args] = tokens
        await runCodexSubcommand(subcommand, args)
    }

    // Handle input change with @ detection and auto-resize
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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
    }

    // Handle file selection from context menu
    const handleFileSelect = (file: FileSearchResult) => {
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
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
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
    }

    // Show loading while DB loads
    if (!dbLoaded) {
        return (
            <div className="flex items-center justify-center h-screen bg-bg-deep">
                <div className="text-text-muted">Loading...</div>
            </div>
        )
    }
    // Show login screen if not authenticated
    if (!user) {
        return (
            <div className="flex flex-col h-screen w-full bg-[var(--color-bg-deep)] overflow-hidden">
                {/* Title Bar */}
                <div className="drag-region h-9 bg-[var(--color-bg-sidebar)] border-b border-[var(--color-border)] flex items-center justify-center flex-shrink-0">
                    <span className="text-xs text-[var(--color-text-muted)]">Codex UI</span>
                </div>

                {/* Centered Login */}
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <div className="text-center">
                        <h1 className="text-2xl font-semibold text-[var(--color-text-primary)] mb-2">Codex UI</h1>
                        <p className="text-sm text-[var(--color-text-muted)]">Choose a Codex login method</p>
                    </div>
                    <div className="w-full max-w-sm flex flex-col gap-2">
                        <button
                            onClick={() => void handleCodexLogin('browser')}
                            disabled={authBusy}
                            className="px-4 py-2.5 bg-[var(--color-bg-card)] hover:bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg transition-colors text-sm"
                        >
                            Continue in Browser
                        </button>
                        <button
                            onClick={() => void handleCodexLogin('device-auth')}
                            disabled={authBusy}
                            className="px-4 py-2.5 bg-[var(--color-bg-card)] hover:bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg transition-colors text-sm"
                        >
                            Device Authentication
                        </button>
                        <input
                            type="password"
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            placeholder="OPENAI_API_KEY"
                            className="px-3 py-2 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)] rounded-lg text-sm outline-none"
                        />
                        <button
                            onClick={() => void handleCodexLogin('api-key')}
                            disabled={authBusy}
                            className="px-4 py-2.5 bg-[var(--color-bg-card)] hover:bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg transition-colors text-sm"
                        >
                            Use API Key
                        </button>
                        {authError && (
                            <div className="text-xs text-red-500">{authError}</div>
                        )}
                    </div>
                </div>
            </div>
        )
    }
    // Codex CLI Installation Screen (with progress)
    if (!codexChecked) {
        return (
            <div className="flex flex-col h-screen w-full bg-[var(--color-bg-deep)] items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <svg className="w-8 h-8 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-[13px] text-[var(--color-text-secondary)]">환경 확인 중...</span>
                </div>
            </div>
        )
    }

    if (!codexInstalled) {
        const handleInstallCodex = async () => {
            setIsInstallingCodex(true)
            setInstallProgress({ status: 'starting', message: '설치 시작...' })
            try {
                await window.codexApi?.installCodex()
            } catch (error) {
                setInstallProgress({ status: 'error', message: String(error) })
                setIsInstallingCodex(false)
            }
        }

        return (
            <div className="flex flex-col h-screen w-full bg-[var(--color-bg-deep)] items-center justify-center">
                <div className="flex flex-col items-center gap-6 max-w-md text-center px-8">
                    {/* Codex Icon */}
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center shadow-lg">
                        <span className="text-3xl font-bold text-white">C</span>
                    </div>

                    <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Codex CLI 설치 필요</h1>
                    <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
                        Codex UI를 사용하려면 OpenAI Codex CLI가 필요합니다.<br />
                        아래 버튼을 클릭하여 자동으로 설치하세요.
                    </p>

                    {isInstallingCodex ? (
                        <div className="flex flex-col items-center gap-3 w-full">
                            <div className="w-full h-2 bg-[var(--color-bg-card)] rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] animate-pulse" style={{ width: '60%' }} />
                            </div>
                            <div className="flex items-center gap-2">
                                <svg className="w-4 h-4 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                <span className="text-[12px] text-[var(--color-text-muted)]">
                                    {installProgress?.message || '설치 중...'}
                                </span>
                            </div>
                        </div>
                    ) : installProgress?.status === 'error' ? (
                        <div className="flex flex-col items-center gap-3 w-full">
                            <div className="text-red-500 text-[12px] bg-red-500/10 px-4 py-2 rounded-lg">
                                {installProgress.message}
                            </div>
                            <button
                                onClick={handleInstallCodex}
                                className="px-6 py-2.5 bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] text-white rounded-lg font-medium text-[13px] hover:opacity-90 transition-opacity"
                            >
                                다시 시도
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={handleInstallCodex}
                            className="px-6 py-2.5 bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] text-white rounded-lg font-medium text-[13px] hover:opacity-90 transition-opacity shadow-lg"
                        >
                            Codex CLI 설치
                        </button>
                    )}

                    <p className="text-[11px] text-[var(--color-text-muted)]">
                        npm install -g @openai/codex 명령어를 실행합니다.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-screen w-full bg-[var(--color-bg-deep)] overflow-hidden">
            {/* Title Bar - with padding for Windows controls */}
            <div className="drag-region h-9 bg-[var(--color-bg-sidebar)] border-b border-[var(--color-border)] flex items-center px-4 pr-36 flex-shrink-0 relative">
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
                                onClick={async () => {
                                    await window.codexApi?.codexLogout()
                                    setUser(null)
                                }}
                                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                            >
                                Logout
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={async () => {
                                const result = await window.codexApi?.codexLogin('browser')
                                if (result?.success && result.user) {
                                    setUser(result.user)
                                }
                            }}
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
                    onToggle={() => setSidebarExpanded(!sidebarExpanded)}
                    workspaces={appState.workspaces}
                    activeWorkspaceId={appState.activeWorkspaceId}
                    activeConversationId={appState.activeConversationId}
                    isLoading={isLoading}
                    onAddWorkspace={handleAddWorkspace}
                    onSelectWorkspace={handleSelectWorkspace}
                    onSelectConversation={handleSelectConversation}
                    onNewConversation={handleNewConversation}
                    onNewConversationInWorkspace={handleNewConversationInWorkspace}
                    onDeleteConversation={handleDeleteConversation}
                    onRemoveWorkspace={handleRemoveWorkspace}
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
                        <button
                            onClick={() => setShowCliPanel(prev => !prev)}
                            className="text-[11px] px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            title="Ctrl+K"
                        >
                            CLI
                        </button>
                    </header>

                    {/* Chat Area */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <CliControlPanel
                            visible={showCliPanel}
                            yoloMode={yoloMode}
                            options={cliOptions}
                            presets={cliPresets}
                            selectedPresetId={selectedPresetId}
                            commandOutput={cliCommandOutput}
                            onClose={() => setShowCliPanel(false)}
                            onToggleYolo={async (value) => {
                                setYoloMode(value)
                                await window.codexApi?.setYoloMode(value)
                            }}
                            onChangeOptions={setCliOptions}
                            onApplyPreset={handleApplyPreset}
                            onSavePreset={handleSavePreset}
                            onDeletePreset={handleDeletePreset}
                            onSelectPreset={handleSelectPreset}
                            onRunQuickCommand={handleRunQuickCommand}
                            onRunCustomCommand={handleRunCustomCodexCommand}
                        />

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
                            onApprovalResponse={async (requestId, approved) => {
                                await window.codexApi?.respondToApproval(requestId, approved)
                                setApprovalRequest(null)
                            }}
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
                                    onClose={() => {
                                        setShowContextMenu(false)
                                        setContextQuery('')
                                    }}
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
                                                        onClick={() => setAttachedFiles(attachedFiles.filter(f => f.path !== file.path))}
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
                                        value={input}
                                        onChange={handleInputChange}
                                        onKeyDown={handleKeyDown}
                                        placeholder={
                                            !activeWorkspace ? "워크스페이스를 열어 시작하세요..." :
                                                isLoading ? "질문을 입력하면 현재 응답을 취소합니다..." :
                                                    "무엇이든 말해보세요"
                                        }
                                        className="w-full resize-none bg-transparent border-none outline-none text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] min-h-[24px] max-h-[200px] text-[12px] overflow-y-auto"
                                        rows={1}
                                        style={{ height: 'auto' }}
                                    />
                                    <div className="flex items-center justify-between">
                                        {/* Model Selector */}
                                        <div className="flex items-center gap-2">
                                            <ModelSelector
                                                model={model}
                                                onModelChange={setModel}
                                            />
                                        </div>

                                        {/* Send/Stop Button */}
                                        {isLoading ? (
                                            <button
                                                onClick={async () => {
                                                    await window.codexApi?.cancelPrompt()
                                                    setIsLoading(false)
                                                    setToolCalls([])
                                                }}
                                                className="w-8 h-8 rounded-full flex items-center justify-center bg-red-500 hover:bg-red-600 text-white transition-colors"
                                                title="응답 중단"
                                            >
                                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                    <rect x="6" y="6" width="12" height="12" rx="1" />
                                                </svg>
                                            </button>
                                        ) : (
                                            <button
                                                onClick={handleSubmit}
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



            {/* Status Bar */}
            <StatusBar
                theme={theme}
                onThemeChange={setTheme}
                workspacePath={activeWorkspace?.path}
                yoloMode={yoloMode}
                onYoloModeChange={async (value) => {
                    setYoloMode(value)
                    await window.codexApi?.setYoloMode(value)
                }}
            />
        </div>
    )
}

export default App

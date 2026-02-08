import { useState, useEffect, useCallback, memo } from 'react'
import * as codexApi from '../api/tauri-api'

// ===== Types =====

interface McpServer {
    name: string
    type: 'stdio' | 'http'
    command?: string
    args?: string[]
    url?: string
    envVars?: string[]
    enabled?: boolean
}

interface FeatureFlag {
    name: string
    stage: string
    enabled: boolean
}

interface RecommendedMcpServer {
    name: string
    displayName: string
    author: string
    description: string
    icon: string
    command: string
    envVars?: string[]
    requiresAuth?: boolean
}

const RECOMMENDED_MCP_SERVERS: RecommendedMcpServer[] = [
    {
        name: 'linear', displayName: 'Linear', author: 'Linear',
        description: "Integrate with Linear's issue tracking and project management",
        icon: '◆', command: 'npx -y @anthropic/mcp-linear',
        envVars: ['LINEAR_API_KEY'], requiresAuth: true
    },
    {
        name: 'notion', displayName: 'Notion', author: 'Notion',
        description: 'Read docs, update pages, manage tasks',
        icon: '𝐍', command: 'npx -y @anthropic/mcp-notion',
        envVars: ['NOTION_API_KEY'], requiresAuth: true
    },
    {
        name: 'figma', displayName: 'Figma', author: 'Figma',
        description: 'Generate better code by bringing in full Figma context',
        icon: '🎨', command: 'npx -y @anthropic/mcp-figma',
        envVars: ['FIGMA_ACCESS_TOKEN'], requiresAuth: true
    },
    {
        name: 'playwright', displayName: 'Playwright', author: 'Microsoft',
        description: 'Integrate browser automation to implement design and test UI',
        icon: '🎭', command: 'npx -y @anthropic/mcp-playwright',
    },
    {
        name: 'filesystem', displayName: 'Filesystem', author: 'Anthropic',
        description: 'Secure file operations with configurable access controls',
        icon: '📁', command: 'npx -y @modelcontextprotocol/server-filesystem /tmp',
    },
    {
        name: 'github', displayName: 'GitHub', author: 'GitHub',
        description: 'Repository management, file operations, and GitHub API integration',
        icon: '🐙', command: 'npx -y @modelcontextprotocol/server-github',
        envVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'], requiresAuth: true
    },
    {
        name: 'slack', displayName: 'Slack', author: 'Anthropic',
        description: 'Channel management and messaging for Slack workspaces',
        icon: '💬', command: 'npx -y @modelcontextprotocol/server-slack',
        envVars: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'], requiresAuth: true
    },
    {
        name: 'postgres', displayName: 'PostgreSQL', author: 'Anthropic',
        description: 'Read-only database access with schema inspection capabilities',
        icon: '🐘', command: 'npx -y @modelcontextprotocol/server-postgres',
        envVars: ['DATABASE_URL'], requiresAuth: true
    },
    {
        name: 'sentry', displayName: 'Sentry', author: 'Sentry',
        description: 'Retrieving and analyzing issues from Sentry.io',
        icon: '🔍', command: 'npx -y @modelcontextprotocol/server-sentry',
        envVars: ['SENTRY_AUTH_TOKEN'], requiresAuth: true
    },
    {
        name: 'puppeteer', displayName: 'Puppeteer', author: 'Anthropic',
        description: 'Browser automation and web scraping capabilities',
        icon: '🤖', command: 'npx -y @modelcontextprotocol/server-puppeteer',
    },
]

interface SettingsPanelProps {
    visible: boolean
    onClose: () => void
    initialTab?: SettingsTabId
    // Execution policy
    yoloMode: boolean
    onYoloModeChange: (v: boolean) => void
    // CLI options
    cliOptions: {
        profile: string
        sandbox: string
        askForApproval: string
        skipGitRepoCheck: boolean
        cwdOverride: string
        extraArgs: string
        enableWebSearch: boolean
    }
    onCliOptionsChange: (opts: Partial<SettingsPanelProps['cliOptions']>) => void
    // Model
    model: string
    onModelChange: (model: string) => void
    // App Server slot (rendered inside Server tab)
    // Teams integration
    teamsWebhookUrl: string
    teamsAutoForward: boolean
    onTeamsSettingsChange: (settings: { webhookUrl?: string; autoForward?: boolean }) => void
}

export type SettingsTabId = 'mcp' | 'model' | 'execution' | 'features' | 'advanced' | 'teams'

// ===== Helper: parse MCP list JSON output =====
function parseMcpList(stdout: string): McpServer[] {
    try {
        const data = JSON.parse(stdout)
        if (!Array.isArray(data)) return []
        return data.map((item: Record<string, unknown>) => {
            const transport = item.transport as Record<string, unknown> | undefined
            const type = (transport?.type === 'http' ? 'http' : 'stdio') as 'stdio' | 'http'
            const server: McpServer = {
                name: String(item.name || ''),
                type,
                enabled: item.enabled !== false,
            }
            if (type === 'http') {
                server.url = String(transport?.url || '')
            } else {
                server.command = String(transport?.command || '')
                server.args = Array.isArray(transport?.args) ? (transport.args as string[]) : []
            }
            // Collect env var names
            if (transport?.env && typeof transport.env === 'object') {
                server.envVars = Object.keys(transport.env as Record<string, string>)
            }
            return server
        })
    } catch {
        return []
    }
}

// ===== Helper: parse features list output =====
function parseFeaturesList(stdout: string): FeatureFlag[] {
    const flags: FeatureFlag[] = []
    const lines = stdout.trim().split('\n').filter(l => l.trim())
    for (const line of lines) {
        // Format: "feature_name    stage    true/false"
        const parts = line.trim().split(/\s{2,}/)
        if (parts.length >= 3) {
            flags.push({
                name: parts[0],
                stage: parts[1],
                enabled: parts[2] === 'true'
            })
        }
    }
    return flags
}

export const SettingsPanel = memo(function SettingsPanel({
    visible,
    onClose,
    initialTab,
    yoloMode,
    onYoloModeChange,
    cliOptions,
    onCliOptionsChange,
    model,
    onModelChange,
    teamsWebhookUrl,
    teamsAutoForward,
    onTeamsSettingsChange,
}: SettingsPanelProps) {
    const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab ?? 'execution')

    // MCP state
    const [mcpServers, setMcpServers] = useState<McpServer[]>([])
    const [mcpLoading, setMcpLoading] = useState(false)
    const [mcpAddMode, setMcpAddMode] = useState(false)
    const [mcpNewName, setMcpNewName] = useState('')
    const [mcpNewType, setMcpNewType] = useState<'stdio' | 'http'>('stdio')
    const [mcpNewCommand, setMcpNewCommand] = useState('')
    const [mcpNewUrl, setMcpNewUrl] = useState('')
    const [mcpNewEnvVars, setMcpNewEnvVars] = useState('')
    const [mcpNewBearerTokenEnv, setMcpNewBearerTokenEnv] = useState('')
    const [installingMcpServer, setInstallingMcpServer] = useState<string | null>(null)
    const [mcpError, setMcpError] = useState('')

    // Features state
    const [features, setFeatures] = useState<FeatureFlag[]>([])
    const [featuresLoading, setFeaturesLoading] = useState(false)

    // Model state
    const [modelInput, setModelInput] = useState(model)
    const [reasoningEffort, setReasoningEffort] = useState('high')

    // Config state
    const [configContent, setConfigContent] = useState('')
    const [configLoading, setConfigLoading] = useState(false)

    // Load data when panel opens
    useEffect(() => {
        if (!visible) return
        if (initialTab) {
            setActiveTab(initialTab)
        }
        setModelInput(model)
        loadMcpServers()
        loadFeatures()
        loadConfig()
    }, [visible, model, initialTab])

    // ===== MCP Operations =====
    const loadMcpServers = useCallback(async () => {
        setMcpLoading(true)
        setMcpError('')
        try {
            const result = await codexApi.runCodexCommand('mcp', ['list', '--json'])
            if (result.success) {
                setMcpServers(parseMcpList(result.stdout))
            } else {
                // "No MCP servers configured yet" is not an error
                if (result.stdout.includes('No MCP servers')) {
                    setMcpServers([])
                } else {
                    setMcpError(result.stderr || result.stdout)
                }
            }
        } catch (e) {
            setMcpError(String(e))
        }
        setMcpLoading(false)
    }, [])

    const handleMcpAdd = useCallback(async () => {
        if (!mcpNewName.trim()) return
        setMcpError('')
        const args: string[] = ['add']

        // Parse env vars
        if (mcpNewType === 'stdio' && mcpNewEnvVars.trim()) {
            const envPairs = mcpNewEnvVars.trim().split('\n')
            for (const pair of envPairs) {
                if (pair.includes('=')) {
                    args.push('--env', pair.trim())
                }
            }
        }

        if (mcpNewType === 'http') {
            if (mcpNewBearerTokenEnv.trim()) {
                args.push('--bearer-token-env-var', mcpNewBearerTokenEnv.trim())
            }
            args.push(mcpNewName.trim(), '--url', mcpNewUrl.trim())
        } else {
            args.push(mcpNewName.trim(), '--', ...mcpNewCommand.trim().split(/\s+/))
        }

        try {
            const result = await codexApi.runCodexCommand('mcp', args)
            if (result.success || result.exitCode === 0) {
                setMcpAddMode(false)
                setMcpNewName('')
                setMcpNewCommand('')
                setMcpNewUrl('')
                setMcpNewEnvVars('')
                setMcpNewBearerTokenEnv('')
                await loadMcpServers()
            } else {
                setMcpError(result.stderr || result.stdout || 'Failed to add MCP server')
            }
        } catch (e) {
            setMcpError(String(e))
        }
    }, [mcpNewName, mcpNewType, mcpNewCommand, mcpNewUrl, mcpNewEnvVars, mcpNewBearerTokenEnv, loadMcpServers])

    const handleMcpRemove = useCallback(async (name: string) => {
        try {
            await codexApi.runCodexCommand('mcp', ['remove', name])
            await loadMcpServers()
        } catch (e) {
            setMcpError(String(e))
        }
    }, [loadMcpServers])

    const handleInstallRecommended = useCallback(async (server: RecommendedMcpServer) => {
        setInstallingMcpServer(server.name)
        setMcpError('')
        try {
            const args: string[] = ['add']
            if (server.envVars) {
                for (const envVar of server.envVars) {
                    args.push('--env', `${envVar}=`)
                }
            }
            const cmdParts = server.command.split(/\s+/)
            args.push(server.name, '--', ...cmdParts)
            const result = await codexApi.runCodexCommand('mcp', args)
            if (result.success || result.exitCode === 0) {
                await loadMcpServers()
            } else {
                setMcpError(result.stderr || result.stdout || `Failed to install ${server.displayName}`)
            }
        } catch (e) {
            setMcpError(String(e))
        }
        setInstallingMcpServer(null)
    }, [loadMcpServers])

    // ===== Features Operations =====
    const loadFeatures = useCallback(async () => {
        setFeaturesLoading(true)
        try {
            const result = await codexApi.runCodexCommand('features', ['list'])
            if (result.success) {
                setFeatures(parseFeaturesList(result.stdout))
            }
        } catch (e) {
            console.error('Failed to load features:', e)
        }
        setFeaturesLoading(false)
    }, [])

    const handleFeatureToggle = useCallback(async (name: string, currentlyEnabled: boolean) => {
        const action = currentlyEnabled ? 'disable' : 'enable'
        try {
            await codexApi.runCodexCommand('features', [action, name])
            await loadFeatures()
        } catch (e) {
            console.error(`Failed to ${action} feature ${name}:`, e)
        }
    }, [loadFeatures])

    // ===== Config Operations =====
    const loadConfig = useCallback(async () => {
        setConfigLoading(true)
        try {
            // Since readFileContent is workspace-scoped, use shell to cat the file
            const result = await codexApi.runCommand('cat ~/.codex/config.toml 2>/dev/null || echo "(empty)"', '/')
            if (result.success && result.output) {
                setConfigContent(result.output.trim())
            } else {
                setConfigContent('(config file not found)')
            }
        } catch {
            setConfigContent('(unable to read config)')
        }
        setConfigLoading(false)
    }, [])

    // ===== Model =====
    const handleModelSave = useCallback(() => {
        if (modelInput.trim()) {
            onModelChange(modelInput.trim())
        }
    }, [modelInput, onModelChange])

    if (!visible) return null

    const tabs: { id: SettingsTabId; label: string; icon: JSX.Element }[] = [
        {
            id: 'mcp', label: 'MCP Servers',
            icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
        },
        {
            id: 'model', label: 'Model',
            icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
        },
        {
            id: 'execution', label: 'Execution',
            icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
        },
        {
            id: 'features', label: 'Features',
            icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
        },
        {
            id: 'advanced', label: 'Advanced',
            icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        },
        {
            id: 'teams', label: 'Teams',
            icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
        },
    ]

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-xl shadow-2xl w-[95vw] max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-sidebar)]">
                    <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Settings</h2>
                    <button onClick={onClose} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Tab Sidebar */}
                    <div className="w-40 border-r border-[var(--color-border)] bg-[var(--color-bg-sidebar)] py-2 flex-shrink-0">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`w-full flex items-center gap-2 px-4 py-2 text-[12px] transition-colors ${activeTab === tab.id
                                    ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] font-medium'
                                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                                    }`}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-5">
                        {/* MCP Servers Tab */}
                        {activeTab === 'mcp' && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-medium text-[var(--color-text-primary)]">MCP Servers</h3>
                                        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Model Context Protocol 서버를 관리합니다</p>
                                    </div>
                                    <button
                                        onClick={() => { setMcpAddMode(true); setMcpError('') }}
                                        className="px-3 py-1.5 text-[11px] bg-[var(--color-primary)] text-white rounded-md hover:opacity-90 transition-opacity"
                                    >
                                        + Add Server
                                    </button>
                                </div>

                                {mcpError && (
                                    <div className="text-[11px] text-red-400 bg-red-500/10 px-3 py-2 rounded-md">{mcpError}</div>
                                )}

                                {/* Add MCP Server Form */}
                                {mcpAddMode && (
                                    <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-bg-card)] space-y-3">
                                        <div className="flex items-center gap-3">
                                            <label className="text-[11px] text-[var(--color-text-secondary)] w-16">Type</label>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setMcpNewType('stdio')}
                                                    className={`px-3 py-1 text-[11px] rounded-md border transition-colors ${mcpNewType === 'stdio'
                                                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                                                        : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                                                >
                                                    stdio (Command)
                                                </button>
                                                <button
                                                    onClick={() => setMcpNewType('http')}
                                                    className={`px-3 py-1 text-[11px] rounded-md border transition-colors ${mcpNewType === 'http'
                                                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                                                        : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                                                >
                                                    HTTP (URL)
                                                </button>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3">
                                            <label className="text-[11px] text-[var(--color-text-secondary)] w-16">Name</label>
                                            <input
                                                value={mcpNewName}
                                                onChange={e => setMcpNewName(e.target.value)}
                                                placeholder="my-mcp-server"
                                                className="flex-1 h-7 px-2 text-[12px] bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                                            />
                                        </div>

                                        {mcpNewType === 'stdio' ? (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <label className="text-[11px] text-[var(--color-text-secondary)] w-16">Command</label>
                                                    <input
                                                        value={mcpNewCommand}
                                                        onChange={e => setMcpNewCommand(e.target.value)}
                                                        placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
                                                        className="flex-1 h-7 px-2 text-[12px] bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] font-mono"
                                                    />
                                                </div>
                                                <div className="flex items-start gap-3">
                                                    <label className="text-[11px] text-[var(--color-text-secondary)] w-16 pt-1">Env Vars</label>
                                                    <textarea
                                                        value={mcpNewEnvVars}
                                                        onChange={e => setMcpNewEnvVars(e.target.value)}
                                                        placeholder={"KEY=value\nANOTHER_KEY=value"}
                                                        rows={2}
                                                        className="flex-1 px-2 py-1 text-[12px] bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] font-mono resize-none"
                                                    />
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-3">
                                                    <label className="text-[11px] text-[var(--color-text-secondary)] w-16">URL</label>
                                                    <input
                                                        value={mcpNewUrl}
                                                        onChange={e => setMcpNewUrl(e.target.value)}
                                                        placeholder="https://mcp.example.com/sse"
                                                        className="flex-1 h-7 px-2 text-[12px] bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] font-mono"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <label className="text-[11px] text-[var(--color-text-secondary)] w-16">Token Env</label>
                                                    <input
                                                        value={mcpNewBearerTokenEnv}
                                                        onChange={e => setMcpNewBearerTokenEnv(e.target.value)}
                                                        placeholder="MY_API_KEY (environment variable name)"
                                                        className="flex-1 h-7 px-2 text-[12px] bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] font-mono"
                                                    />
                                                </div>
                                            </>
                                        )}

                                        <div className="flex items-center justify-end gap-2 pt-1">
                                            <button
                                                onClick={() => setMcpAddMode(false)}
                                                className="px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleMcpAdd}
                                                disabled={!mcpNewName.trim() || (mcpNewType === 'stdio' ? !mcpNewCommand.trim() : !mcpNewUrl.trim())}
                                                className="px-4 py-1.5 text-[11px] bg-[var(--color-primary)] text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* Server List */}
                                {mcpLoading ? (
                                    <div className="flex items-center gap-2 py-4">
                                        <svg className="w-4 h-4 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        <span className="text-[12px] text-[var(--color-text-secondary)]">Loading...</span>
                                    </div>
                                ) : mcpServers.length === 0 ? (
                                    <div className="text-center py-8 text-[12px] text-[var(--color-text-muted)]">
                                        MCP 서버가 없습니다. "Add Server"을 클릭하여 추가하세요.
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {mcpServers.map(server => (
                                            <div key={server.name} className="flex items-center justify-between px-4 py-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg group">
                                                <div className="flex items-center gap-3">
                                                    <span className={`w-2 h-2 rounded-full ${server.type === 'http' ? 'bg-blue-400' : 'bg-green-400'}`} />
                                                    <div>
                                                        <div className="text-[12px] font-medium text-[var(--color-text-primary)]">{server.name}</div>
                                                        <div className="text-[10px] text-[var(--color-text-muted)] font-mono mt-0.5">
                                                            {server.type === 'http' ? server.url : [server.command, ...(server.args || [])].join(' ')}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]">
                                                        {server.type}
                                                    </span>
                                                    <button
                                                        onClick={() => handleMcpRemove(server.name)}
                                                        className="p-1 text-red-400 hover:text-red-300"
                                                        title="Remove server"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <button
                                    onClick={loadMcpServers}
                                    className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                                >
                                    ↻ Refresh
                                </button>

                                {/* Recommended Servers */}
                                <div className="pt-4 border-t border-[var(--color-border)]">
                                    <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)] mb-3">Recommended servers</h4>
                                    <div className="space-y-1.5">
                                        {RECOMMENDED_MCP_SERVERS.map(server => {
                                            const isInstalled = mcpServers.some(s => s.name === server.name)
                                            const isInstalling = installingMcpServer === server.name
                                            return (
                                                <div key={server.name} className="flex items-center justify-between px-4 py-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-border-hover)] transition-colors">
                                                    <div className="flex items-center gap-3">
                                                        <span className="w-8 h-8 rounded-lg bg-[var(--color-bg-hover)] flex items-center justify-center text-base">{server.icon}</span>
                                                        <div>
                                                            <div className="text-[12px] text-[var(--color-text-primary)]">
                                                                <span className="font-semibold">{server.displayName}</span>
                                                                <span className="text-[var(--color-text-muted)] font-normal"> by {server.author}</span>
                                                            </div>
                                                            <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{server.description}</div>
                                                        </div>
                                                    </div>
                                                    {isInstalled ? (
                                                        <span className="text-[10px] px-2.5 py-1 rounded-md bg-green-500/10 text-green-400 font-medium">Installed</span>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleInstallRecommended(server)}
                                                            disabled={isInstalling}
                                                            className="text-[11px] px-3 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-deep)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)] transition-colors disabled:opacity-40"
                                                        >
                                                            {isInstalling ? 'Installing...' : server.requiresAuth ? 'Install and authenticate' : 'Install'}
                                                        </button>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Model Tab */}
                        {activeTab === 'model' && (
                            <div className="space-y-5">
                                <div>
                                    <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Model Configuration</h3>
                                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">AI 모델과 추론 설정을 관리합니다</p>
                                </div>

                                {/* Model ID */}
                                <div className="space-y-2">
                                    <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Model ID</label>
                                    <div className="flex gap-2">
                                        <input
                                            value={modelInput}
                                            onChange={e => setModelInput(e.target.value)}
                                            className="flex-1 h-8 px-3 text-[12px] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] font-mono"
                                        />
                                        <button
                                            onClick={handleModelSave}
                                            className="px-3 py-1.5 text-[11px] bg-[var(--color-primary)] text-white rounded-md hover:opacity-90"
                                        >
                                            Apply
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {['o3', 'o4-mini', 'gpt-4.1', 'gpt-5.2-codex', 'codex-mini-latest'].map(m => (
                                            <button
                                                key={m}
                                                onClick={() => { setModelInput(m); onModelChange(m) }}
                                                className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${model === m
                                                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                                                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
                                            >
                                                {m}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Reasoning Effort */}
                                <div className="space-y-2">
                                    <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Reasoning Effort</label>
                                    <div className="flex gap-2">
                                        {['low', 'medium', 'high', 'xhigh'].map(level => (
                                            <button
                                                key={level}
                                                onClick={() => setReasoningEffort(level)}
                                                className={`flex-1 px-3 py-2 text-[11px] rounded-md border transition-colors ${reasoningEffort === level
                                                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium'
                                                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                                            >
                                                {level}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Profile */}
                                <div className="space-y-2">
                                    <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Profile</label>
                                    <input
                                        value={cliOptions.profile}
                                        onChange={e => onCliOptionsChange({ profile: e.target.value })}
                                        placeholder="default (from config.toml)"
                                        className="w-full h-8 px-3 text-[12px] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)]"
                                    />
                                    <p className="text-[10px] text-[var(--color-text-muted)]">~/.codex/config.toml에 정의된 프로필 이름</p>
                                </div>
                            </div>
                        )}

                        {/* Execution Policy Tab */}
                        {activeTab === 'execution' && (
                            <div className="space-y-5">
                                <div>
                                    <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Execution Policy</h3>
                                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">명령어 실행 권한과 보안 정책을 설정합니다</p>
                                </div>

                                {/* Full Access Mode */}
                                <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg">
                                    <div>
                                        <div className="text-[12px] font-medium text-[var(--color-text-primary)]">Full Access Mode</div>
                                        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">모든 승인 및 sandbox를 우회합니다 (위험)</div>
                                    </div>
                                    <button
                                        onClick={() => onYoloModeChange(!yoloMode)}
                                        className={`relative w-10 h-5 rounded-full transition-colors ${yoloMode ? 'bg-green-500' : 'bg-[var(--color-border)]'}`}
                                    >
                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${yoloMode ? 'left-5' : 'left-0.5'}`} />
                                    </button>
                                </div>

                                {/* Sandbox Mode */}
                                <div className={`space-y-2 ${yoloMode ? 'opacity-40 pointer-events-none' : ''}`}>
                                    <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Sandbox Mode</label>
                                    <div className="space-y-1.5">
                                        {[
                                            { value: 'read-only', label: 'Read Only', desc: '파일 시스템 읽기만 허용' },
                                            { value: 'workspace-write', label: 'Workspace Write', desc: '워크스페이스 디렉토리에만 쓰기 허용' },
                                            { value: 'danger-full-access', label: 'Full Access (위험)', desc: '모든 파일 시스템 접근 허용' },
                                        ].map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => onCliOptionsChange({ sandbox: opt.value })}
                                                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg border transition-colors text-left ${cliOptions.sandbox === opt.value
                                                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                                                    : 'border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]'}`}
                                            >
                                                <div>
                                                    <div className="text-[12px] text-[var(--color-text-primary)]">{opt.label}</div>
                                                    <div className="text-[10px] text-[var(--color-text-muted)]">{opt.desc}</div>
                                                </div>
                                                {cliOptions.sandbox === opt.value && (
                                                    <svg className="w-4 h-4 text-[var(--color-primary)]" fill="currentColor" viewBox="0 0 20 20">
                                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Approval Policy */}
                                <div className={`space-y-2 ${yoloMode ? 'opacity-40 pointer-events-none' : ''}`}>
                                    <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Approval Policy</label>
                                    <div className="space-y-1.5">
                                        {[
                                            { value: 'on-request', label: 'On Request (기본)', desc: '모델이 필요할 때 승인 요청' },
                                            { value: 'untrusted', label: 'Untrusted', desc: '신뢰할 수 없는 명령만 승인 요청' },
                                            { value: 'on-failure', label: 'On Failure', desc: '실행 실패 시에만 승인 요청' },
                                            { value: 'never', label: 'Never', desc: '절대 승인 요청하지 않음' },
                                        ].map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => onCliOptionsChange({ askForApproval: opt.value })}
                                                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg border transition-colors text-left ${cliOptions.askForApproval === opt.value
                                                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                                                    : 'border-[var(--color-border)] hover:bg-[var(--color-bg-hover)]'}`}
                                            >
                                                <div>
                                                    <div className="text-[12px] text-[var(--color-text-primary)]">{opt.label}</div>
                                                    <div className="text-[10px] text-[var(--color-text-muted)]">{opt.desc}</div>
                                                </div>
                                                {cliOptions.askForApproval === opt.value && (
                                                    <svg className="w-4 h-4 text-[var(--color-primary)]" fill="currentColor" viewBox="0 0 20 20">
                                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Web Search */}
                                <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg">
                                    <div>
                                        <div className="text-[12px] font-medium text-[var(--color-text-primary)]">Web Search</div>
                                        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">모델이 웹 검색을 사용할 수 있도록 합니다</div>
                                    </div>
                                    <button
                                        onClick={() => onCliOptionsChange({ enableWebSearch: !cliOptions.enableWebSearch })}
                                        className={`relative w-10 h-5 rounded-full transition-colors ${cliOptions.enableWebSearch ? 'bg-green-500' : 'bg-[var(--color-border)]'}`}
                                    >
                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${cliOptions.enableWebSearch ? 'left-5' : 'left-0.5'}`} />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Features Tab */}
                        {activeTab === 'features' && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Feature Flags</h3>
                                        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Codex CLI 실험적 기능을 켜고 끕니다</p>
                                    </div>
                                    <button
                                        onClick={loadFeatures}
                                        className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                                    >
                                        ↻ Refresh
                                    </button>
                                </div>

                                {featuresLoading ? (
                                    <div className="flex items-center gap-2 py-4">
                                        <svg className="w-4 h-4 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        <span className="text-[12px] text-[var(--color-text-secondary)]">Loading...</span>
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {features.map(flag => (
                                            <div key={flag.name} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div>
                                                        <div className="text-[12px] text-[var(--color-text-primary)] font-mono">{flag.name}</div>
                                                        <div className="text-[10px] text-[var(--color-text-muted)]">
                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] ${flag.stage === 'stable' ? 'bg-green-500/10 text-green-400'
                                                                : flag.stage === 'experimental' ? 'bg-yellow-500/10 text-yellow-400'
                                                                    : flag.stage === 'deprecated' ? 'bg-red-500/10 text-red-400'
                                                                        : 'bg-blue-500/10 text-blue-400'
                                                                }`}>{flag.stage}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleFeatureToggle(flag.name, flag.enabled)}
                                                    className={`relative w-9 h-5 rounded-full transition-colors ${flag.enabled ? 'bg-green-500' : 'bg-[var(--color-border)]'}`}
                                                >
                                                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${flag.enabled ? 'left-4' : 'left-0.5'}`} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Advanced Tab */}
                        {activeTab === 'advanced' && (
                            <div className="space-y-5">
                                <div>
                                    <h3 className="text-sm font-medium text-[var(--color-text-primary)]">Advanced Settings</h3>
                                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">고급 설정 및 추가 옵션</p>
                                </div>

                                {/* Skip Git Repo Check */}
                                <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg">
                                    <div>
                                        <div className="text-[12px] font-medium text-[var(--color-text-primary)]">Skip Git Repo Check</div>
                                        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">Git 저장소 검사를 건너뜁니다</div>
                                    </div>
                                    <button
                                        onClick={() => onCliOptionsChange({ skipGitRepoCheck: !cliOptions.skipGitRepoCheck })}
                                        className={`relative w-10 h-5 rounded-full transition-colors ${cliOptions.skipGitRepoCheck ? 'bg-green-500' : 'bg-[var(--color-border)]'}`}
                                    >
                                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${cliOptions.skipGitRepoCheck ? 'left-5' : 'left-0.5'}`} />
                                    </button>
                                </div>

                                {/* CWD Override */}
                                <div className="space-y-2">
                                    <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Working Directory Override</label>
                                    <input
                                        value={cliOptions.cwdOverride}
                                        onChange={e => onCliOptionsChange({ cwdOverride: e.target.value })}
                                        placeholder="/path/to/directory"
                                        className="w-full h-8 px-3 text-[12px] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] font-mono"
                                    />
                                    <p className="text-[10px] text-[var(--color-text-muted)]">비어있으면 현재 워크스페이스 경로 사용</p>
                                </div>

                                {/* Extra Args */}
                                <div className="space-y-2">
                                    <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Extra CLI Arguments</label>
                                    <input
                                        value={cliOptions.extraArgs}
                                        onChange={e => onCliOptionsChange({ extraArgs: e.target.value })}
                                        placeholder="--add-dir /extra/path --no-alt-screen"
                                        className="w-full h-8 px-3 text-[12px] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] font-mono"
                                    />
                                    <p className="text-[10px] text-[var(--color-text-muted)]">Codex CLI에 추가로 전달할 인자 (예: --add-dir /path)</p>
                                </div>

                                {/* Config File */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">config.toml</label>
                                        <span className="text-[10px] text-[var(--color-text-muted)]">~/.codex/config.toml</span>
                                    </div>
                                    {configLoading ? (
                                        <div className="text-[11px] text-[var(--color-text-muted)]">Loading...</div>
                                    ) : (
                                        <pre className="w-full max-h-40 overflow-auto p-3 text-[11px] bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] font-mono leading-relaxed">
                                            {configContent || '(empty or not found)'}
                                        </pre>
                                    )}
                                </div>
                            </div>
                        )}



                        {/* Teams Tab */}
                        {activeTab === 'teams' && (
                            <div className="space-y-5">
                                <div>
                                    <h3 className="text-sm font-medium text-[var(--color-text-primary)]">MS Teams Integration</h3>
                                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Teams 채널에 Codex AI 응답을 전달합니다</p>
                                </div>

                                {/* Webhook URL */}
                                <div className="space-y-2">
                                    <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">Incoming Webhook URL</label>
                                    <input
                                        value={teamsWebhookUrl}
                                        onChange={e => onTeamsSettingsChange({ webhookUrl: e.target.value })}
                                        placeholder="https://your-org.webhook.office.com/webhookb2/..."
                                        className="w-full h-8 px-3 text-[12px] bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-lg text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] font-mono"
                                    />
                                    <p className="text-[10px] text-[var(--color-text-muted)]">
                                        Teams 채널 → Connectors → Incoming Webhook에서 URL을 복사하세요.
                                        <a href="https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook" target="_blank" rel="noopener" className="text-[var(--color-primary)] ml-1 hover:underline">Docs ↗</a>
                                    </p>
                                </div>

                                {/* Test Send */}
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={async () => {
                                            if (!teamsWebhookUrl.trim()) return
                                            const result = await codexApi.sendToTeams(
                                                teamsWebhookUrl,
                                                '🧪 Test from Codex WUI',
                                                'This is a test message to verify the webhook connection is working properly.'
                                            )
                                            if (result.success) {
                                                alert('✅ 메시지가 Teams에 전송되었습니다!')
                                            } else {
                                                alert(`❌ 전송 실패: ${result.error}`)
                                            }
                                        }}
                                        disabled={!teamsWebhookUrl.trim()}
                                        className="px-4 py-2 text-[11px] bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
                                    >
                                        🧪 Test Connection
                                    </button>
                                    <span className="text-[10px] text-[var(--color-text-muted)]">Webhook URL을 입력한 후 테스트 메시지를 전송해보세요</span>
                                </div>

                                {/* Divider */}
                                <div className="border-t border-[var(--color-border)]" />

                                {/* Auto-forward Toggle */}
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-[12px] font-medium text-[var(--color-text-primary)]">자동 전달</div>
                                        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">모든 AI 응답을 자동으로 Teams 채널에 전달합니다</div>
                                    </div>
                                    <button
                                        onClick={() => onTeamsSettingsChange({ autoForward: !teamsAutoForward })}
                                        className={`relative w-10 h-5 rounded-full transition-colors ${teamsAutoForward ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-bg-hover)]'
                                            }`}
                                    >
                                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${teamsAutoForward ? 'translate-x-5' : 'translate-x-0.5'
                                            }`} />
                                    </button>
                                </div>

                                {/* Info */}
                                <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg p-4 space-y-2">
                                    <div className="text-[11px] font-medium text-[var(--color-text-primary)]">💡 사용 방법</div>
                                    <ul className="text-[10px] text-[var(--color-text-muted)] space-y-1 list-disc list-inside">
                                        <li>채팅에서 AI 응답의 <strong>📤 Send to Teams</strong> 버튼으로 개별 전달</li>
                                        <li><strong>자동 전달</strong>을 켜면 모든 AI 응답이 자동으로 Teams에 전달됩니다</li>
                                        <li>메시지는 Adaptive Card 형식으로 전송됩니다</li>
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>


                </div>
            </div>
        </div>
    )
})

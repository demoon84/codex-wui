import { useState, useEffect, useRef, useMemo, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import { FileIcon } from './FileIcon'
import { ApprovalDialog } from './ApprovalDialog'
import { useI18n } from '../i18n'


interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: string
    thinking?: string
    thinkingDuration?: number
    needsApproval?: boolean
}

interface ToolCall {
    title: string
    status: string
    output?: string
}

// Antigravity-style progress tracking
interface FileEdit {
    path: string
    action: 'create' | 'modify' | 'delete'
    linesChanged?: string  // e.g., "+2 -2"
    timestamp: number
}

interface ProgressUpdate {
    stepNumber: number
    title: string
    status: 'pending' | 'running' | 'done' | 'error'
    details?: string
    timestamp: number
}

interface BackgroundCommand {
    id: string
    command: string
    cwd: string
    output: string
    status: 'running' | 'done' | 'error'
    exitCode?: number
}

interface ChatPanelProps {
    messages: Message[]
    streamingContent: string
    streamingThinking: string
    isLoading: boolean
    thinkingStartTime?: number | null
    toolCalls?: ToolCall[]
    terminalOutput?: { terminalId: string; output: string; exitCode: number | null } | null
    // Antigravity-style progress props
    progressUpdates?: ProgressUpdate[]
    fileEdits?: FileEdit[]
    backgroundCommands?: BackgroundCommand[]
    currentTaskName?: string
    // New Antigravity-style props
    taskSummary?: { title: string; summary: string } | null
    searchLogs?: { query: string; results: number }[]
    onApprove?: (messageId: string) => void
    // Approval request
    approvalRequest?: { requestId: string; title: string; description: string } | null
    onApprovalResponse?: (requestId: string, approved: boolean) => void
    // Teams integration
    onSendToTeams?: (content: string) => void
}

// Check if text looks like a file path
function isFilePath(text: string): boolean {
    return /^\.{0,2}\/.*\.\w+$|^\w+\.\w+$/.test(text.trim()) || /\.\w{1,5}$/.test(text)
}

// Copy button with feedback
function CopyButton({ content }: { content: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <button
            onClick={handleCopy}
            className="hover:text-[var(--color-text-primary)] transition-colors"
            title={copied ? 'Copied!' : 'Copy'}
        >
            {copied ? (
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
            )}
        </button>
    )
}

// Thinking section component with live timer
function ThinkingSection({ thinking, duration, isStreaming = false, startTime }: {
    thinking: string
    duration?: number
    isStreaming?: boolean
    startTime?: number | null
}) {
    const [elapsed, setElapsed] = useState(0)
    const [isExpanded, setIsExpanded] = useState(false) // Default to collapsed
    const [wasStreaming, setWasStreaming] = useState(false)

    // Track streaming state for timing purposes
    useEffect(() => {
        if (isStreaming && !wasStreaming) {
            setWasStreaming(true)
        } else if (!isStreaming && wasStreaming) {
            setWasStreaming(false)
        }
    }, [isStreaming, wasStreaming])

    useEffect(() => {
        if (!isStreaming || !startTime) return
        const interval = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startTime) / 1000))
        }, 100)
        return () => clearInterval(interval)
    }, [isStreaming, startTime])

    const displayTime = isStreaming ? elapsed : (duration || 0)
    const minutes = Math.floor(displayTime / 60)
    const seconds = displayTime % 60

    return (
        <div className="mb-2">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
                <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="flex items-center gap-1.5">
                    {isStreaming && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
                    )}
                    Thinking
                    <span className="text-[var(--color-text-muted)]">
                        {minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`}
                    </span>
                </span>
            </button>
            {isExpanded && thinking && (
                <div className="mt-2 pl-4 border-l-2 border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {thinking}
                    </ReactMarkdown>
                </div>
            )}
        </div>
    )
}

// Helper to detect tool type and extract meaningful info from title
function parseToolCall(title: string): { type: 'search' | 'file' | 'command' | 'analyze' | 'edit' | 'other', icon: string, label: string, detail?: string } {
    const lowerTitle = title.toLowerCase()

    // Search operations
    if (lowerTitle.includes('search') || lowerTitle.includes('grep') || lowerTitle.includes('find')) {
        const match = title.match(/(?:search|grep|find)[^\w]*(.+)/i)
        return { type: 'search', icon: '🔍', label: 'Search', detail: match?.[1] || title }
    }

    // File viewing/reading
    if (lowerTitle.includes('view') || lowerTitle.includes('read') || lowerTitle.includes('reading')) {
        const filename = title.replace(/^(view|read|reading)[_\s]*(file)?[\s:_]*/i, '').split(/[/\\]/).pop() || title
        return { type: 'file', icon: '📄', label: 'Read file', detail: filename }
    }

    // File editing/writing
    if (lowerTitle.includes('edit') || lowerTitle.includes('write') || lowerTitle.includes('replace') || lowerTitle.includes('modify')) {
        const filename = title.replace(/^(edit|write|replace|modify)[_\s]*(file)?[\s:_]*/i, '').split(/[/\\]/).pop() || title
        return { type: 'edit', icon: '✏️', label: 'Edit', detail: filename }
    }

    // Command execution
    if (lowerTitle.includes('command') || lowerTitle.includes('terminal') || lowerTitle.includes('run') || lowerTitle.includes('npm') || lowerTitle.includes('spawn')) {
        return { type: 'command', icon: '⚡', label: 'Run command', detail: title }
    }

    // Analysis/Review
    if (lowerTitle.includes('analyz') || lowerTitle.includes('review') || lowerTitle.includes('check') || lowerTitle.includes('inspect')) {
        return { type: 'analyze', icon: '🔬', label: 'Analyze', detail: title }
    }

    return { type: 'other', icon: '⚙️', label: 'Task', detail: title }
}

// Antigravity-style Progress Updates Section with smart tool detection
function ProgressUpdatesSection({ updates, isExpanded: defaultExpanded = true }: { updates: ProgressUpdate[], isExpanded?: boolean }) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded)

    // Memoize parsed tool calls to avoid recalculating on every render
    const parsedUpdates = useMemo(() =>
        updates.map(u => ({ ...u, parsed: parseToolCall(u.title) })),
        [updates]
    )

    if (parsedUpdates.length === 0) return null

    return (
        <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)] overflow-hidden">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] transition-colors"
            >
                <span className="font-medium">Progress Updates</span>
                <div className="flex items-center gap-2">
                    <span className="text-[var(--color-text-muted)]">{parsedUpdates.length}</span>
                    <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>
            {isExpanded && (
                <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                    {parsedUpdates.map((update, idx) => (
                        <div key={idx} className="flex items-center gap-3 px-3 py-2">
                            <span className="flex-shrink-0 w-4 text-center">
                                {update.status === 'running' ? (
                                    <svg className="w-3 h-3 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                ) : update.status === 'done' ? (
                                    <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                ) : update.status === 'error' ? (
                                    <svg className="w-3 h-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                ) : (
                                    <span className="w-3 h-3 rounded-full border border-[var(--color-border)]" />
                                )}
                            </span>
                            <span className="text-[11px]">{update.parsed.icon}</span>
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-card)] text-[var(--color-text-muted)]">
                                    {update.parsed.label}
                                </span>
                                <span className="text-[11px] text-[var(--color-text-primary)] truncate font-mono">
                                    {update.parsed.detail}
                                </span>
                            </div>
                            {update.details && (
                                <span className="text-[10px] text-[var(--color-text-muted)]">{update.details}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// Antigravity-style Files Edited Section
function FilesEditedSection({ files }: { files: FileEdit[] }) {
    const [isExpanded, setIsExpanded] = useState(true)

    if (files.length === 0) return null

    return (
        <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-sidebar)] overflow-hidden">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] transition-colors"
            >
                <span className="font-medium">Files Edited</span>
                <div className="flex items-center gap-2">
                    <span className="text-[var(--color-text-muted)]">{files.length}</span>
                    <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>
            {isExpanded && (
                <div className="border-t border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                    {files.map((file, idx) => {
                        const filename = file.path.split(/[/\\]/).pop() || file.path
                        return (
                            <div key={idx} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-bg-card)] transition-colors group">
                                {file.action === 'create' ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">NEW</span>
                                ) : file.action === 'delete' ? (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">DEL</span>
                                ) : (
                                    <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                )}
                                <span className="flex-1 text-[11px] text-[var(--color-text-primary)] truncate font-mono">{filename}</span>
                                {file.linesChanged && (
                                    <span className="text-[10px] text-[var(--color-text-muted)]">{file.linesChanged}</span>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// Antigravity-style Background Command Section
function BackgroundCommandSection({ commands }: { commands: BackgroundCommand[] }) {
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const outputRef = useRef<HTMLPreElement>(null)

    // Auto-expand first running command
    const runningCmd = commands.find(c => c.status === 'running')
    const effectiveExpandedId = runningCmd ? runningCmd.id : expandedId

    // Auto-scroll output when running
    useEffect(() => {
        if (outputRef.current && runningCmd) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight
        }
    }, [runningCmd?.output])

    if (commands.length === 0) return null

    return (
        <div className="mb-3 space-y-2">
            {commands.map((cmd) => {
                const isExpanded = effectiveExpandedId === cmd.id || (cmd.status === 'running')
                return (
                    <div key={cmd.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden">
                        <button
                            onClick={() => setExpandedId(expandedId === cmd.id ? null : cmd.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[var(--color-bg-hover)] transition-colors"
                        >
                            {cmd.status === 'running' ? (
                                <svg className="w-3.5 h-3.5 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                            ) : cmd.exitCode === 0 ? (
                                <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            ) : (
                                <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            )}
                            <span className="text-[var(--color-text-muted)]">
                                {cmd.status === 'running' ? 'Running command...' : 'Background command'}
                            </span>
                            <svg className={`w-3 h-3 ml-auto text-[var(--color-text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {isExpanded && (
                            <div className="border-t border-[var(--color-border)]">
                                <div className="px-3 py-1.5 bg-[#161b22] text-[10px] text-[var(--color-text-muted)] font-mono truncate">
                                    {cmd.cwd} &gt; {cmd.command}
                                </div>
                                {cmd.output && (
                                    <pre
                                        ref={cmd.status === 'running' ? outputRef : undefined}
                                        className="p-3 text-[10px] font-mono text-[var(--color-text-primary)] max-h-[200px] overflow-y-auto whitespace-pre-wrap bg-[var(--color-bg-input)]"
                                    >
                                        {cmd.output}
                                    </pre>
                                )}
                                {cmd.exitCode !== undefined && (
                                    <div className="px-3 py-1.5 border-t border-[var(--color-border)] text-[10px]">
                                        <span className={cmd.exitCode === 0 ? 'text-green-400' : 'text-red-400'}>
                                            Exit code: {cmd.exitCode}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

// Antigravity-style Task Summary Card (blue box)
function TaskSummaryCard({ title, summary }: { title: string; summary: string }) {
    return (
        <div className="mb-3 px-4 py-3 rounded-lg bg-[#1e3a5f] border-l-4 border-[#3b82f6]">
            <h3 className="text-[13px] font-semibold text-[#93c5fd] mb-1">{title}</h3>
            <p className="text-[12px] text-[#e2e8f0] leading-relaxed whitespace-pre-line">{summary}</p>
        </div>
    )
}

// Antigravity-style Search Log Section
function SearchLogSection({ searches }: { searches: { query: string; results: number }[] }) {
    if (searches.length === 0) return null

    return (
        <div className="mb-3 space-y-1">
            {searches.map((search, idx) => (
                <div key={idx} className="flex items-center gap-2 text-[12px]">
                    <span className="text-[var(--color-text-muted)]">🔍</span>
                    <span className="text-[var(--color-text-muted)]">Searched</span>
                    <code className="px-1.5 py-0.5 bg-[var(--color-bg-card)] rounded text-[var(--color-text-primary)] font-mono text-[11px]">
                        {search.query}
                    </code>
                    <span className="text-[var(--color-text-muted)]">{search.results} results</span>
                </div>
            ))}
        </div>
    )
}

// Markdown renderer component
function MarkdownContent({ content }: { content: string }) {
    return (
        <div className="prose prose-sm max-w-none text-[13px] text-[var(--color-text-primary)] leading-relaxed break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                    // Code blocks and inline code
                    code({ className, children, ...props }: any) {
                        const content = String(children).replace(/\n$/, '')
                        const match = /language-(\w+)/.exec(className || '')

                        // If no className (no language specified) and content doesn't contain newlines, it's inline
                        const isInline = !className && !content.includes('\n')

                        if (isInline) {
                            const filename = content.split('/').pop() || content
                            if (isFilePath(content)) {
                                return (
                                    <code className="inline-flex items-center gap-1 bg-[var(--color-bg-card)] px-1.5 py-0.5 rounded text-[13px] text-[var(--color-text-primary)] font-mono not-prose align-middle" {...props}>
                                        <FileIcon filename={filename} className="w-3.5 h-3.5" />
                                        {content}
                                    </code>
                                )
                            }
                            return (
                                <code className="bg-[var(--color-bg-card)] px-1 py-0.5 rounded text-[13px] text-[var(--color-text-primary)] font-mono not-prose" {...props}>
                                    {content}
                                </code>
                            )
                        }

                        const language = match ? match[1] : ''
                        return (
                            <div className="my-3 rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-bg-sidebar)] not-prose">
                                {language && (
                                    <div className="px-3 py-1.5 text-[11px] text-[var(--color-text-muted)] border-b border-[var(--color-border)] flex items-center justify-between">
                                        <span>{language}</span>
                                        <CopyButton content={content} />
                                    </div>
                                )}
                                <pre className="p-3 overflow-x-auto m-0">
                                    <code className={`text-[12px] font-mono ${className || ''}`}>{content}</code>
                                </pre>
                            </div>
                        )
                    },
                    // Paragraphs
                    p({ children }: any) {
                        return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
                    },
                    // Lists
                    ul({ children }: any) {
                        return <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>
                    },
                    ol({ children }: any) {
                        return <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>
                    },
                    li({ children }: any) {
                        return <li className="leading-relaxed">{children}</li>
                    },
                    // Headings
                    h1({ children }: any) {
                        return <h1 className="text-xl font-bold mb-3 mt-4 first:mt-0 text-[var(--color-text-primary)]">{children}</h1>
                    },
                    h2({ children }: any) {
                        return <h2 className="text-lg font-bold mb-2 mt-4 first:mt-0 text-[var(--color-text-primary)]">{children}</h2>
                    },
                    h3({ children }: any) {
                        return <h3 className="text-base font-semibold mb-2 mt-3 first:mt-0 text-[var(--color-text-primary)]">{children}</h3>
                    },
                    // Links
                    a({ href, children }: any) {
                        return (
                            <a href={href} className="text-[var(--color-accent1)] hover:underline" target="_blank" rel="noopener noreferrer">
                                {children}
                            </a>
                        )
                    },
                    // Text formatting
                    strong({ children }: any) {
                        return <strong className="font-semibold text-[var(--color-text-primary)]">{children}</strong>
                    },
                    em({ children }: any) {
                        return <em className="italic">{children}</em>
                    },
                    // Blockquote
                    blockquote({ children }: any) {
                        return (
                            <blockquote className="border-l-2 border-[var(--color-border)] pl-4 my-3 text-[var(--color-text-muted)] italic">
                                {children}
                            </blockquote>
                        )
                    },
                    // Horizontal rule
                    hr() {
                        return <hr className="border-[var(--color-border)] my-4" />
                    },
                    // Tables
                    table({ children }: any) {
                        return (
                            <div className="overflow-x-auto my-3">
                                <table className="min-w-full border-collapse">{children}</table>
                            </div>
                        )
                    },
                    th({ children }: any) {
                        return <th className="border border-[var(--color-border)] px-3 py-2 bg-[var(--color-bg-card)] text-left font-medium">{children}</th>
                    },
                    td({ children }: any) {
                        return <td className="border border-[var(--color-border)] px-3 py-2">{children}</td>
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    )
}

export const ChatPanel = memo(function ChatPanel({
    messages,
    streamingContent,
    streamingThinking,
    isLoading,
    thinkingStartTime,
    toolCalls = [],
    terminalOutput,
    progressUpdates = [],
    fileEdits = [],
    backgroundCommands = [],
    currentTaskName,
    taskSummary,
    searchLogs = [],
    onApprove,
    approvalRequest,
    onApprovalResponse,
    onSendToTeams
}: ChatPanelProps) {
    const { t } = useI18n()
    const scrollRef = useRef<HTMLDivElement>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const isUserScrolling = useRef(false)

    // Track if user has scrolled up
    const handleScroll = () => {
        if (!scrollRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 100
        isUserScrolling.current = !isNearBottom
    }

    // Auto-scroll to bottom when content changes (only if user is at bottom)
    useEffect(() => {
        if (isUserScrolling.current) return

        // Use instant scroll for streaming to avoid jittery animation
        if (streamingContent || streamingThinking) {
            bottomRef.current?.scrollIntoView({ behavior: 'instant' })
        } else {
            // Use smooth scroll for new messages
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages, streamingContent, streamingThinking, isLoading])

    // Reset scroll lock when loading starts
    useEffect(() => {
        if (isLoading) {
            isUserScrolling.current = false
        }
    }, [isLoading])
    const isEmpty = messages.length === 0 && !streamingContent && !isLoading

    return (
        <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col" onScroll={handleScroll}>
            {isEmpty ? (
                <div className="flex-1 flex items-center justify-center pointer-events-none">
                    <div className="text-center text-[var(--color-text-muted)]">
                        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-bg-sidebar)] flex items-center justify-center">
                            <svg className="w-6 h-6 text-[var(--color-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <p className="text-[12px]">{t('startConversation')}</p>
                    </div>
                </div>
            ) : (
                <div className="max-w-3xl mx-auto py-4 px-4 w-full">

                    {messages.map((message) => (
                        <div key={message.id} className="mb-4">
                            {message.role === 'user' ? (
                                <div className="bg-[var(--color-bg-card)] rounded-lg px-4 py-3 text-[12px] text-[var(--color-text-primary)] flex items-center justify-between gap-3">
                                    <span className="whitespace-pre-wrap break-words flex-1">{message.content}</span>
                                    {/* Show spinner if this is the last user message and we're loading (hide when thinking/streaming starts) */}
                                    {isLoading && message.id === messages.filter(m => m.role === 'user').slice(-1)[0]?.id && !streamingContent && !streamingThinking && (
                                        <svg className="w-4 h-4 animate-spin text-[var(--color-primary)] flex-shrink-0" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                    )}
                                </div>
                            ) : (
                                <div>
                                    {message.thinking && (
                                        <ThinkingSection
                                            thinking={message.thinking}
                                            duration={message.thinkingDuration}
                                        />
                                    )}
                                    <div className="text-[12px] text-[var(--color-text-primary)]">
                                        <MarkdownContent content={message.content} />
                                    </div>
                                    {message.needsApproval && onApprove && (
                                        <ApprovalDialog
                                            visible={true}
                                            title={t('approvalTitle')}
                                            onApprove={() => onApprove(message.id)}
                                        />
                                    )}
                                    {onSendToTeams && message.content && (
                                        <div className="flex justify-end mt-1">
                                            <button
                                                onClick={() => onSendToTeams(message.content)}
                                                className="text-[10px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)] transition-colors"
                                                title="Send this response to MS Teams"
                                            >
                                                📤 Teams
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Antigravity-style Tool Calls / Terminal View - Outside streaming block so it persists */}
                    {toolCalls.length > 0 && (
                        <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-bg-hover)] border-b border-[var(--color-border)]">
                                <div className="flex items-center gap-2">
                                    <svg className="w-3.5 h-3.5 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3" />
                                    </svg>
                                    <span className="text-[11px] text-[var(--color-text-muted)]">Running background command</span>
                                </div>
                                <a href="#" className="text-[11px] text-[var(--color-primary)] hover:underline">Open ↗</a>
                            </div>
                            <div className="max-h-48 overflow-y-auto">
                                {toolCalls.map((tc, idx) => (
                                    <div key={idx} className="px-3 py-1.5 border-b border-[var(--color-border-subtle)] last:border-b-0">
                                        <div className="flex items-center gap-2">
                                            {tc.status === 'running' ? (
                                                <svg className="w-3 h-3 animate-spin text-[var(--color-primary)] flex-shrink-0" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                </svg>
                                            ) : tc.status === 'done' || tc.status === 'completed' ? (
                                                <svg className="w-3 h-3 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                </svg>
                                            ) : tc.status === 'error' || tc.status === 'failed' ? (
                                                <svg className="w-3 h-3 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            ) : (
                                                <svg className="w-3 h-3 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            )}
                                            <span className="text-[11px] font-mono text-[var(--color-text-primary)] truncate">{tc.title}</span>
                                        </div>
                                        {tc.output && (
                                            <pre className="mt-1 ml-5 text-[10px] font-mono text-[var(--color-text-muted)] whitespace-pre-wrap break-all max-h-20 overflow-y-auto">{tc.output}</pre>
                                        )}
                                    </div>
                                ))}
                            </div>
                            {isLoading && toolCalls.some(tc => tc.status === 'running') && (
                                <div className="px-3 py-2 bg-[var(--color-bg-hover)] border-t border-[var(--color-border)] flex items-center justify-between">
                                    <span className="text-[10px] text-[var(--color-text-muted)]">Always run ∧</span>
                                    <button className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">Cancel</button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Approval Request - Antigravity Style */}
                    {approvalRequest && (
                        <div className="mb-4 rounded-lg border-2 border-yellow-500/50 bg-yellow-500/10 overflow-hidden">
                            <div className="px-4 py-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <span className="text-[13px] font-medium text-yellow-500">{approvalRequest.title}</span>
                                </div>
                                {approvalRequest.description && (
                                    <pre className="text-[11px] text-[var(--color-text-secondary)] mb-3 p-2 bg-[#0d1117] rounded border border-[var(--color-border)] overflow-x-auto font-mono whitespace-pre-wrap break-all">
                                        {approvalRequest.description}
                                    </pre>
                                )}
                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={() => onApprovalResponse?.(approvalRequest.requestId, false)}
                                        className="px-4 py-1.5 text-[12px] rounded bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] border border-[var(--color-border)] transition-colors"
                                    >
                                        {t('approvalReject')}
                                    </button>
                                    <button
                                        onClick={() => onApprovalResponse?.(approvalRequest.requestId, true)}
                                        className="px-4 py-1.5 text-[12px] rounded bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity"
                                    >
                                        {t('approvalApprove')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Running Terminal Section - shows live command execution */}
                    {backgroundCommands.filter(cmd => cmd.status === 'running').length > 0 && (
                        <div className="mb-4 rounded-lg border-2 border-[var(--color-primary)] bg-[var(--color-bg-card)] overflow-hidden shadow-lg">
                            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-hover)] border-b border-[var(--color-border)]">
                                <svg className="w-4 h-4 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                <span className="text-[12px] font-medium text-[var(--color-primary)]">{t('runningTerminal')}</span>
                            </div>
                            {backgroundCommands.filter(cmd => cmd.status === 'running').map((cmd, idx) => (
                                <div key={cmd.id || idx} className="border-b border-[var(--color-border)] last:border-b-0">
                                    <div className="px-3 py-2 bg-[var(--color-bg-hover)] flex items-center gap-2">
                                        <svg className="w-3 h-3 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3" />
                                        </svg>
                                        <code className="text-[11px] text-[var(--color-success)] font-mono truncate flex-1">{cmd.command}</code>
                                        {cmd.cwd && <span className="text-[9px] text-[var(--color-text-muted)]">{cmd.cwd}</span>}
                                    </div>
                                    {cmd.output && (
                                        <pre className="p-3 text-[10px] font-mono text-[var(--color-text-primary)] max-h-[250px] overflow-y-auto whitespace-pre-wrap bg-[var(--color-bg-input)]">
                                            {cmd.output}
                                        </pre>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Additional Terminal Output (for prompts not in backgroundCommands) */}
                    {terminalOutput && terminalOutput.output && terminalOutput.exitCode === null &&
                        !backgroundCommands.some(cmd => cmd.status === 'running') && (
                            <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] overflow-hidden">
                                <div className="flex items-center gap-2 px-3 py-2 bg-[var(--color-bg-hover)] border-b border-[var(--color-border)]">
                                    <svg className="w-3.5 h-3.5 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    <span className="text-[11px] text-[var(--color-text-secondary)]">{t('terminalOutput')}</span>
                                </div>
                                <pre className="p-3 text-[10px] font-mono text-[var(--color-text-primary)] max-h-[200px] overflow-y-auto whitespace-pre-wrap bg-[var(--color-bg-input)]">
                                    {terminalOutput.output}
                                </pre>
                            </div>
                        )}

                    {/* Persistent Background Commands History */}
                    {backgroundCommands.length > 0 && (
                        <BackgroundCommandSection commands={backgroundCommands} />
                    )}

                    {/* Current streaming */}
                    {(streamingContent || streamingThinking || isLoading) && (
                        <div className="mb-4">
                            {streamingThinking && (
                                <ThinkingSection
                                    thinking={streamingThinking}
                                    isStreaming={true}
                                    startTime={thinkingStartTime}
                                />
                            )}

                            {/* Current Task Name Header */}
                            {currentTaskName && isLoading && (
                                <div className="mb-3 pb-2 border-b border-[var(--color-border)]">
                                    <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{currentTaskName}</span>
                                </div>
                            )}

                            {/* Antigravity-style Search Log Section */}
                            <SearchLogSection searches={searchLogs} />

                            {/* Antigravity-style Task Summary Card */}
                            {taskSummary && (
                                <TaskSummaryCard title={taskSummary.title} summary={taskSummary.summary} />
                            )}

                            {/* Antigravity-style Files Edited Section */}
                            <FilesEditedSection files={fileEdits} />

                            {/* Antigravity-style Progress Updates Section */}
                            <ProgressUpdatesSection updates={progressUpdates} />



                            {/* Generating indicator */}
                            {isLoading && (toolCalls.length > 0 || progressUpdates.length > 0) && (
                                <div className="flex items-center gap-1.5 text-[var(--color-text-muted)] text-[12px] mb-2">
                                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    <span>{t('generating')}</span>
                                </div>
                            )}

                            {streamingContent && (
                                <div className="text-[12px] text-[var(--color-text-primary)] streaming-content">
                                    <MarkdownContent content={streamingContent} />
                                    <style>{`
                                        .streaming-content p:last-of-type::after {
                                            content: '';
                                            display: ${isLoading ? 'inline-block' : 'none'};
                                            width: 8px;
                                            height: 8px;
                                            margin-left: 4px;
                                            border: 2px solid var(--color-primary);
                                            border-top-color: transparent;
                                            border-radius: 50%;
                                            animation: spin 0.8s linear infinite;
                                            vertical-align: middle;
                                        }
                                        @keyframes spin {
                                            to { transform: rotate(360deg); }
                                        }
                                    `}</style>
                                </div>
                            )}
                        </div>
                    )}
                    {/* Scroll anchor */}
                    <div ref={bottomRef} />
                </div>
            )}
        </div>
    )
})

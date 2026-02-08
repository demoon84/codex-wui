import { useState, useRef, useEffect, memo } from 'react'
import { type SettingsTabId } from './SettingsPanel'

interface Workspace {
    id: string
    name: string
    path: string
    conversations: Conversation[]
}

interface Conversation {
    id: string
    workspaceId: string
    title: string
    createdAt: string
    updatedAt: string
    messages: unknown[]
}

interface SidebarProps {
    expanded: boolean
    onToggle: () => void
    workspaces: Workspace[]
    activeWorkspaceId: string | null
    activeConversationId: string | null
    isLoading?: boolean
    loadingConversationIds?: Set<string>
    onAddWorkspace: () => void
    onSelectWorkspace: (workspaceId: string) => void
    onSelectConversation: (conversationId: string) => void
    onNewConversation: () => void
    onNewConversationInWorkspace: (workspaceId: string) => void
    onDeleteConversation: (conversationId: string) => void
    onRemoveWorkspace: (workspaceId: string) => void
    onRenameWorkspace: (workspaceId: string, name: string) => void
    onOpenSettings: (tab?: SettingsTabId) => void
    activeConversationHasApproval?: boolean
}

interface ContextMenuState {
    visible: boolean
    x: number
    y: number
    type: 'conversation' | 'workspace'
    targetId: string | null
}

const FEATURE_AUTOMATIONS = false
const FEATURE_SKILLS = false
const FEATURE_WORKSPACE_FILTER = false

export const Sidebar = memo(function Sidebar({
    expanded,
    onToggle,
    workspaces,
    activeWorkspaceId,
    activeConversationId,
    isLoading,
    loadingConversationIds,
    onAddWorkspace,
    onSelectWorkspace,
    onSelectConversation,
    onNewConversation,
    onNewConversationInWorkspace,
    onDeleteConversation,
    onRemoveWorkspace,
    onRenameWorkspace,
    onOpenSettings,
    activeConversationHasApproval
}: SidebarProps) {
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
        visible: false,
        x: 0,
        y: 0,
        type: 'conversation',
        targetId: null
    })
    const [showOnlyActive, setShowOnlyActive] = useState(false)
    const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set())
    const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
    const [editingWorkspaceName, setEditingWorkspaceName] = useState('')
    const contextMenuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!activeWorkspaceId) return
        setExpandedWorkspaces(prev => {
            if (prev.has(activeWorkspaceId)) return prev
            const next = new Set(prev)
            next.add(activeWorkspaceId)
            return next
        })
    }, [activeWorkspaceId])

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                setContextMenu(prev => ({ ...prev, visible: false }))
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const openContextMenuAt = (x: number, y: number, type: ContextMenuState['type'], targetId: string) => {
        setContextMenu({
            visible: true,
            x,
            y,
            type,
            targetId
        })
    }

    const handleConversationContextMenu = (e: React.MouseEvent, conversationId: string) => {
        e.preventDefault()
        openContextMenuAt(e.clientX, e.clientY, 'conversation', conversationId)
    }

    const handleWorkspaceContextMenu = (e: React.MouseEvent, workspaceId: string) => {
        e.preventDefault()
        openContextMenuAt(e.clientX, e.clientY, 'workspace', workspaceId)
    }

    const handleWorkspaceMenuClick = (e: React.MouseEvent, workspaceId: string) => {
        e.stopPropagation()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const menuX = Math.max(12, rect.right - 160)
        openContextMenuAt(menuX, rect.bottom + 6, 'workspace', workspaceId)
    }

    const handleDeleteConversation = () => {
        if (contextMenu.targetId && contextMenu.type === 'conversation') {
            onDeleteConversation(contextMenu.targetId)
        }
        setContextMenu(prev => ({ ...prev, visible: false }))
    }

    const handleRenameWorkspace = () => {
        if (contextMenu.targetId && contextMenu.type === 'workspace') {
            const target = workspaces.find(w => w.id === contextMenu.targetId)
            if (target) {
                setEditingWorkspaceId(target.id)
                setEditingWorkspaceName(target.name)
            }
        }
        setContextMenu(prev => ({ ...prev, visible: false }))
    }

    const commitWorkspaceRename = () => {
        if (!editingWorkspaceId) return
        const nextName = editingWorkspaceName.trim()
        if (!nextName) {
            setEditingWorkspaceId(null)
            setEditingWorkspaceName('')
            return
        }
        onRenameWorkspace(editingWorkspaceId, nextName)
        setEditingWorkspaceId(null)
        setEditingWorkspaceName('')
    }

    const cancelWorkspaceRename = () => {
        setEditingWorkspaceId(null)
        setEditingWorkspaceName('')
    }

    const handleCloseFolder = () => {
        if (contextMenu.targetId && contextMenu.type === 'workspace') {
            onRemoveWorkspace(contextMenu.targetId)
        }
        setContextMenu(prev => ({ ...prev, visible: false }))
    }

    const toggleWorkspace = (workspaceId: string) => {
        setExpandedWorkspaces(prev => {
            const next = new Set(prev)
            if (next.has(workspaceId)) {
                next.delete(workspaceId)
            } else {
                next.add(workspaceId)
            }
            return next
        })
    }

    const ensureWorkspaceExpanded = (workspaceId: string) => {
        setExpandedWorkspaces(prev => {
            if (prev.has(workspaceId)) return prev
            const next = new Set(prev)
            next.add(workspaceId)
            return next
        })
    }

    const formatRelativeTime = (isoDate: string) => {
        const timestamp = new Date(isoDate).getTime()
        if (Number.isNaN(timestamp)) return ''
        const diffMs = Math.max(0, Date.now() - timestamp)
        const minutes = Math.max(1, Math.floor(diffMs / 60000))
        if (minutes < 60) return `${minutes}m`
        const hours = Math.floor(minutes / 60)
        if (hours < 24) return `${hours}h`
        const days = Math.floor(hours / 24)
        return `${days}d`
    }

    const visibleWorkspaces = showOnlyActive && activeWorkspaceId
        ? workspaces.filter(w => w.id === activeWorkspaceId)
        : workspaces

    return (
        <>
            <aside className={`${expanded ? 'w-64' : 'w-12'} bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)] flex flex-col h-full transition-all duration-200 overflow-x-hidden`}>
                {expanded && (
                    <div className="flex-1 overflow-y-auto overflow-x-hidden">
                        {/* Top Actions */}
                        <div className="px-3 pt-4 pb-2 flex flex-col gap-1">
                            <button
                                onClick={onNewConversation}
                                className="flex items-center gap-2.5 px-2 py-2.5 rounded-md text-[14px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                                title="New thread"
                            >
                                <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15.232 5.232l3.536 3.536M9 11l6-6m-9 9l-2 6 6-2 9.5-9.5a2.121 2.121 0 000-3l-1-1a2.121 2.121 0 00-3 0L6 12z" />
                                </svg>
                                New thread
                            </button>
                            <button
                                onClick={() => onOpenSettings('features')}
                                className={`flex items-center gap-2.5 px-2 py-2.5 rounded-md text-[14px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors ${FEATURE_AUTOMATIONS ? '' : 'hidden'}`}
                                title="Automations"
                            >
                                <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Automations
                            </button>
                            <button
                                onClick={() => onOpenSettings('mcp')}
                                className={`flex items-center gap-2.5 px-2 py-2.5 rounded-md text-[14px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors ${FEATURE_SKILLS ? '' : 'hidden'}`}
                                title="Skills"
                            >
                                <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M20 7l-8 4-8-4m16 0l-8-4-8 4m16 0v10l-8 4-8-4V7" />
                                </svg>
                                Skills
                            </button>
                        </div>

                        {/* Threads Header */}
                        <div className="flex items-center justify-between px-4 pt-3 pb-2">
                            <span className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
                                Threads
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={onAddWorkspace}
                                    className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                                    title="Open Workspace"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 5v14m7-7H5" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => setShowOnlyActive(prev => !prev)}
                                    className={`p-1 rounded transition-colors ${showOnlyActive ? 'text-[var(--color-text-primary)] bg-[var(--color-bg-hover)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'} ${FEATURE_WORKSPACE_FILTER ? '' : 'hidden'}`}
                                    title={showOnlyActive ? 'Show all workspaces' : 'Show active workspace only'}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 6h16M7 12h10M10 18h4" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Workspace List */}
                        <div className="px-2 pb-3">
                            {visibleWorkspaces.map(workspace => (
                                <div key={workspace.id} className="mb-2">
                                    {(() => {
                                        const isExpanded = expandedWorkspaces.has(workspace.id)
                                        return (
                                            <>
                                    {/* Workspace Row */}
                                    <div
                                        className="flex items-center gap-2 group rounded-md px-2 py-2 hover:bg-[var(--color-bg-hover)] transition-colors"
                                        onContextMenu={(e) => handleWorkspaceContextMenu(e, workspace.id)}
                                    >
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                toggleWorkspace(workspace.id)
                                            }}
                                            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                                            title={isExpanded ? 'Collapse' : 'Expand'}
                                        >
                                            <svg
                                                className={`w-3.5 h-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </button>
                                        <svg className="w-4 h-4 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                        </svg>
                                        <button
                                            onClick={() => {
                                                onSelectWorkspace(workspace.id)
                                                ensureWorkspaceExpanded(workspace.id)
                                            }}
                                            className="flex-1 text-left text-[14px] font-medium text-[var(--color-text-primary)] truncate"
                                        >
                                            {workspace.name}
                                        </button>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => handleWorkspaceMenuClick(e, workspace.id)}
                                                className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                                                title="More"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
                                                </svg>
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onNewConversationInWorkspace(workspace.id)
                                                }}
                                                className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                                                title="New thread"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15.232 5.232l3.536 3.536M9 11l6-6m-9 9l-2 6 6-2 9.5-9.5a2.121 2.121 0 000-3l-1-1a2.121 2.121 0 00-3 0L6 12z" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Conversations */}
                                    {isExpanded && workspace.conversations.length > 0 && (
                                        <div className="ml-7 mt-1">
                                            {workspace.conversations.map(conv => {
                                                const showApproval = Boolean(activeConversationHasApproval && conv.id === activeConversationId)
                                                return (
                                                    <button
                                                        key={conv.id}
                                                        onClick={() => {
                                                            onSelectConversation(conv.id)
                                                            ensureWorkspaceExpanded(workspace.id)
                                                        }}
                                                        onContextMenu={(e) => handleConversationContextMenu(e, conv.id)}
                                                        className={`w-full text-left px-3 py-2 text-[13px] rounded-full transition-colors mb-0.5 flex items-center gap-2 ${conv.id === activeConversationId
                                                            ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]'
                                                            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                                                            }`}
                                                    >
                                                        <span className="truncate flex-1">{conv.title}</span>
                                                        {showApproval && (
                                                            <span
                                                                className="px-2 py-0.5 text-[11px] rounded-full font-medium"
                                                                style={{ backgroundColor: 'rgba(80, 250, 123, 0.18)', color: 'var(--color-primary)' }}
                                                            >
                                                                Awaiting approval
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] text-[var(--color-text-muted)]">
                                                            {formatRelativeTime(conv.updatedAt)}
                                                        </span>
                                                        {(loadingConversationIds?.has(conv.id) || (conv.id === activeConversationId && isLoading)) && (
                                                            <svg className="w-3.5 h-3.5 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    )}
                                    {editingWorkspaceId === workspace.id && (
                                        <div className="ml-7 mt-2 mr-2">
                                            <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl p-3 shadow-lg">
                                                <div className="text-[11px] text-[var(--color-text-muted)] mb-1">Display name</div>
                                                <input
                                                    autoFocus
                                                    value={editingWorkspaceName}
                                                    onChange={(e) => setEditingWorkspaceName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault()
                                                            commitWorkspaceRename()
                                                        } else if (e.key === 'Escape') {
                                                            e.preventDefault()
                                                            cancelWorkspaceRename()
                                                        }
                                                    }}
                                                    onBlur={() => commitWorkspaceRename()}
                                                    className="w-full bg-transparent text-[14px] text-[var(--color-text-primary)] outline-none"
                                                />
                                            </div>
                                        </div>
                                    )}
                                            </>
                                        )
                                    })()}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Collapsed state */}
                {!expanded && (
                    <div className="flex-1 flex flex-col items-center pt-3 gap-1">
                        <button
                            onClick={onNewConversation}
                            className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                            title="New thread"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M15.232 5.232l3.536 3.536M9 11l6-6m-9 9l-2 6 6-2 9.5-9.5a2.121 2.121 0 000-3l-1-1a2.121 2.121 0 00-3 0L6 12z" />
                            </svg>
                        </button>
                        <button
                            onClick={() => onOpenSettings('features')}
                            className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                            title="Automations"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                        <button
                            onClick={() => onOpenSettings('mcp')}
                            className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                            title="Skills"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M20 7l-8 4-8-4m16 0l-8-4-8 4m16 0v10l-8 4-8-4V7" />
                            </svg>
                        </button>
                        <button
                            onClick={onAddWorkspace}
                            className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                            title="Open Workspace"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 5v14m7-7H5" />
                            </svg>
                        </button>
                        {workspaces.map(workspace => (
                            <button
                                key={workspace.id}
                                onClick={() => {
                                    onSelectWorkspace(workspace.id)
                                    onToggle()
                                }}
                                className={`p-2 rounded transition-colors ${workspace.id === activeWorkspaceId
                                    ? 'text-[var(--color-text-primary)] bg-[var(--color-bg-hover)]'
                                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                                    }`}
                                title={workspace.name}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                </svg>
                            </button>
                        ))}
                    </div>
                )}

                {/* Footer */}
                <div className={`flex items-center ${expanded ? 'justify-between px-3' : 'justify-center'} py-3 border-t border-[var(--color-border)]`}>
                    {expanded && (
                        <button
                            onClick={() => onOpenSettings()}
                            className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M19.4 15a1.7 1.7 0 01.34 1.86l-.86 1.49a1.7 1.7 0 01-1.56.84l-1.7-.08a1.7 1.7 0 01-1.2-.63l-.83-1a1.7 1.7 0 00-1.31-.62h-1.88a1.7 1.7 0 00-1.31.62l-.83 1a1.7 1.7 0 01-1.2.63l-1.7.08a1.7 1.7 0 01-1.56-.84l-.86-1.49A1.7 1.7 0 014.6 15l.54-1.6a1.7 1.7 0 000-1.08L4.6 10.7A1.7 1.7 0 014.6 9a1.7 1.7 0 01-.34-1.86l.86-1.49A1.7 1.7 0 016.68 4.8l1.7.08c.47.02.9.24 1.2.63l.83 1A1.7 1.7 0 0011.72 7h1.88c.5 0 .98-.22 1.31-.62l.83-1c.3-.39.73-.61 1.2-.63l1.7-.08a1.7 1.7 0 011.56.84l.86 1.49A1.7 1.7 0 0119.4 9l-.54 1.6a1.7 1.7 0 000 1.08l.54 1.6z" />
                            </svg>
                            Settings
                        </button>
                    )}
                    <button
                        onClick={onToggle}
                        className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                        title={expanded ? 'Collapse' : 'Expand'}
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            {expanded ? (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                            ) : (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                            )}
                        </svg>
                    </button>
                </div>
            </aside>

            {/* Context Menu */}
            {contextMenu.visible && (
                <div
                    ref={contextMenuRef}
                    className="fixed bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    {contextMenu.type === 'workspace' ? (
                        <>
                            <button
                                onClick={handleRenameWorkspace}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536M9 11l6-6m-9 9l-2 6 6-2 9.5-9.5a2.121 2.121 0 000-3l-1-1a2.121 2.121 0 00-3 0L6 12z" />
                                </svg>
                                Edit name
                            </button>
                            <button
                                onClick={handleCloseFolder}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Remove
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={handleDeleteConversation}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-400 hover:bg-[var(--color-bg-hover)] transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Delete
                        </button>
                    )}
                </div>
            )}
        </>
    )
})

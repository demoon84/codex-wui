import { useState, useRef, useEffect, memo } from 'react'

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
}

interface ContextMenuState {
    visible: boolean
    x: number
    y: number
    type: 'conversation' | 'workspace'
    targetId: string | null
}

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
    onRemoveWorkspace
}: SidebarProps) {
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({
        visible: false,
        x: 0,
        y: 0,
        type: 'conversation',
        targetId: null
    })
    const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(new Set())
    const contextMenuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (activeWorkspaceId) {
            setExpandedWorkspaces(prev => new Set([...prev, activeWorkspaceId]))
        }
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

    const handleConversationContextMenu = (e: React.MouseEvent, conversationId: string) => {
        e.preventDefault()
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            type: 'conversation',
            targetId: conversationId
        })
    }

    const handleWorkspaceContextMenu = (e: React.MouseEvent, workspaceId: string) => {
        e.preventDefault()
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            type: 'workspace',
            targetId: workspaceId
        })
    }

    const handleDeleteConversation = () => {
        if (contextMenu.targetId && contextMenu.type === 'conversation') {
            onDeleteConversation(contextMenu.targetId)
        }
        setContextMenu(prev => ({ ...prev, visible: false }))
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

    void onNewConversation

    return (
        <>
            <aside className={`${expanded ? 'w-60' : 'w-12'} bg-[var(--color-bg-sidebar)] border-r border-[var(--color-border)] flex flex-col h-full transition-all duration-200 overflow-x-hidden`}>
                {expanded && (
                    <div className="flex-1 overflow-y-auto overflow-x-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3">
                            <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
                                Workspaces
                            </span>
                            <button
                                onClick={onAddWorkspace}
                                className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                                title="Open Workspace"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                            </button>
                        </div>

                        {/* Workspace List */}
                        <div className="px-2">
                            {workspaces.map(workspace => {
                                const isExpanded = expandedWorkspaces.has(workspace.id)

                                return (
                                    <div key={workspace.id} className="mb-1">
                                        {/* Workspace Row */}
                                        <div
                                            className="flex items-center group rounded hover:bg-[var(--color-bg-hover)] transition-colors"
                                            onContextMenu={(e) => handleWorkspaceContextMenu(e, workspace.id)}
                                        >
                                            {/* Chevron */}
                                            <button
                                                onClick={() => toggleWorkspace(workspace.id)}
                                                className="p-2 text-[var(--color-text-muted)]"
                                            >
                                                <svg
                                                    className={`w-3.5 h-3.5 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                </svg>
                                            </button>

                                            {/* Workspace Name */}
                                            <button
                                                onClick={() => {
                                                    onSelectWorkspace(workspace.id)
                                                    if (!isExpanded) toggleWorkspace(workspace.id)
                                                }}
                                                className="flex-1 text-left py-2 pr-1 text-sm text-[var(--color-text-primary)] truncate"
                                            >
                                                {workspace.name}
                                            </button>

                                            {/* Add Conversation */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    onNewConversationInWorkspace(workspace.id)
                                                }}
                                                className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="New conversation"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                </svg>
                                            </button>
                                        </div>

                                        {/* Conversations */}
                                        {isExpanded && workspace.conversations.length > 0 && (
                                            <div className="ml-4 mt-0.5">
                                                {workspace.conversations.map(conv => (
                                                    <button
                                                        key={conv.id}
                                                        onClick={() => onSelectConversation(conv.id)}
                                                        onContextMenu={(e) => handleConversationContextMenu(e, conv.id)}
                                                        className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors mb-0.5 flex items-center gap-2 ${conv.id === activeConversationId
                                                            ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]'
                                                            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]'
                                                            }`}
                                                    >
                                                        <span className="truncate flex-1">{conv.title}</span>
                                                        {(loadingConversationIds?.has(conv.id) || (conv.id === activeConversationId && isLoading)) && (
                                                            <svg className="w-3.5 h-3.5 animate-spin text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24">
                                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Collapsed state */}
                {!expanded && (
                    <div className="flex-1 flex flex-col items-center pt-3 gap-1">
                        <button
                            onClick={onAddWorkspace}
                            className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
                            title="Open Workspace"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
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

                {/* Toggle Button */}
                <div className={`flex ${expanded ? 'px-3' : 'justify-center'} py-3 border-t border-[var(--color-border)]`}>
                    <button
                        onClick={onToggle}
                        className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] rounded transition-colors"
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
                        <button
                            onClick={handleCloseFolder}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Close Folder
                        </button>
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

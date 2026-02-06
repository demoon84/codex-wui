import { useState } from 'react'

// Action types for structured display
interface FileAction {
    type: 'analyzed' | 'edited' | 'searched' | 'created'
    fileName: string
    fileType?: 'tsx' | 'css' | 'json' | 'md' | 'other'
    lineRange?: string
    additions?: number
    deletions?: number
    warnings?: number
}

interface ProgressStep {
    id: number
    title: string
    actions: FileAction[]
    description?: string
}

interface ProgressCardProps {
    title: string
    subtitle: string
    filesEdited: string[]
    steps: ProgressStep[]
}

// File type icon helper
function FileIcon({ type }: { type?: string }) {
    if (type === 'tsx' || type === 'jsx') {
        return <span className="text-blue-400">⚛</span>
    }
    if (type === 'css') {
        return <span className="text-purple-400">{ }</span>
    }
    return (
        <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
    )
}

// Single file action row
function FileActionRow({ action }: { action: FileAction }) {
    return (
        <div className="flex items-center justify-between py-1.5 text-sm">
            <div className="flex items-center gap-2">
                <FileIcon type={action.fileType} />
                <span className="text-text-secondary capitalize">{action.type}</span>
                <span className="text-primary font-medium">{action.fileName}</span>
                {action.lineRange && (
                    <span className="text-text-muted text-xs">#{action.lineRange}</span>
                )}
                {action.additions !== undefined && (
                    <span className="text-green-500 text-xs">+{action.additions}</span>
                )}
                {action.deletions !== undefined && (
                    <span className="text-red-500 text-xs">-{action.deletions}</span>
                )}
                {action.warnings !== undefined && action.warnings > 0 && (
                    <span className="text-yellow-500 text-xs">⚠ {action.warnings}</span>
                )}
            </div>
            {action.type === 'edited' && (
                <button className="text-text-muted hover:text-white text-xs">
                    Open diff
                </button>
            )}
        </div>
    )
}

// Progress card component
export function ProgressCard({ title, subtitle, filesEdited, steps }: ProgressCardProps) {
    const [collapsed, setCollapsed] = useState(false)

    return (
        <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg my-4 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <h3 className="text-[var(--color-text-primary)] font-medium">{title}</h3>
                <p className="text-text-secondary text-sm mt-0.5">{subtitle}</p>
            </div>

            {/* Files Edited summary */}
            <div className="px-4 py-2 border-b border-[var(--color-border)]">
                <div className="text-text-muted text-xs mb-1">Files Edited</div>
                <div className="flex flex-wrap gap-2">
                    {filesEdited.map((file, i) => (
                        <span key={i} className="text-sm text-primary">{file}</span>
                    ))}
                </div>
            </div>

            {/* Progress Updates */}
            <div className="px-4 py-2">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-text-muted text-xs">Progress Updates</span>
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="text-text-muted hover:text-white text-xs"
                    >
                        {collapsed ? 'Expand all' : 'Collapse all'} ∨
                    </button>
                </div>

                {!collapsed && steps.map((step) => (
                    <div key={step.id} className="mb-3">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-text-muted text-xs">{step.id}</span>
                            <span className="text-white text-sm font-medium">{step.title}</span>
                        </div>
                        <div className="ml-4 space-y-0.5">
                            {step.actions.map((action, i) => (
                                <FileActionRow key={i} action={action} />
                            ))}
                            {step.description && (
                                <p className="text-text-secondary text-sm mt-2">{step.description}</p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

// Status indicator
export function StatusIndicator({ status }: { status: 'generating' | 'working' | 'done' }) {
    if (status === 'done') return null

    return (
        <div className="flex items-center gap-2 text-text-muted text-sm py-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {status === 'generating' ? 'Generating...' : 'Working...'}
        </div>
    )
}

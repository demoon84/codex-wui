import { useState, useEffect, useRef } from 'react'
import { FileIcon } from './FileIcon'

interface FileSearchResult {
    name: string
    path: string
    relativePath: string
    isDirectory: boolean
}

interface ContextMenuProps {
    visible: boolean
    query: string
    workspacePath: string
    position: { x: number; y: number }
    onSelect: (file: FileSearchResult) => void
    onClose: () => void
}

export function ContextMenu({
    visible,
    query,
    workspacePath,
    position,
    onSelect,
    onClose
}: ContextMenuProps) {
    const [results, setResults] = useState<FileSearchResult[]>([])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [loading, setLoading] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)

    // Search files when query changes
    useEffect(() => {
        if (!visible || !workspacePath) {
            setResults([])
            return
        }

        const searchFiles = async () => {
            setLoading(true)
            try {
                const files = await window.geminiApi?.searchFiles(workspacePath, query)
                setResults(files || [])
                setSelectedIndex(0)
            } catch (error) {
                console.error('[ContextMenu] Search error:', error)
                setResults([])
            } finally {
                setLoading(false)
            }
        }

        const debounce = setTimeout(searchFiles, 100)
        return () => clearTimeout(debounce)
    }, [visible, query, workspacePath])

    // Handle keyboard navigation
    useEffect(() => {
        if (!visible) return

        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault()
                    setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    setSelectedIndex(prev => Math.max(prev - 1, 0))
                    break
                case 'Enter':
                    e.preventDefault()
                    if (results[selectedIndex]) {
                        onSelect(results[selectedIndex])
                    }
                    break
                case 'Escape':
                    e.preventDefault()
                    onClose()
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [visible, results, selectedIndex, onSelect, onClose])

    // Click outside to close
    useEffect(() => {
        if (!visible) return

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose()
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [visible, onClose])

    // Scroll selected item into view
    useEffect(() => {
        const selectedElement = menuRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
        selectedElement?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex])

    if (!visible) return null

    return (
        <div
            ref={menuRef}
            className="absolute z-50 bg-[var(--color-bg-sidebar)] border border-[var(--color-border)] rounded-lg shadow-xl overflow-hidden"
            style={{
                bottom: position.y,
                left: position.x,
                minWidth: '320px',
                maxWidth: '450px',
                maxHeight: '280px'
            }}
        >
            {/* Header */}
            <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-deep)]">
                <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span>파일 검색</span>
                    {query && <span className="text-[var(--color-primary)]">"{query}"</span>}
                </div>
            </div>

            {/* Results */}
            <div className="overflow-y-auto max-h-[220px]">
                {loading ? (
                    <div className="px-3 py-4 text-center text-[11px] text-[var(--color-text-muted)]">
                        <svg className="w-4 h-4 mx-auto animate-spin mb-1" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        검색 중...
                    </div>
                ) : results.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[11px] text-[var(--color-text-muted)]">
                        {query ? '검색 결과 없음' : '검색어를 입력하세요'}
                    </div>
                ) : (
                    results.map((file, index) => (
                        <div
                            key={file.path}
                            data-index={index}
                            onClick={() => onSelect(file)}
                            className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${index === selectedIndex
                                ? 'bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]'
                                : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-card)]'
                                }`}
                        >
                            {file.isDirectory ? (
                                <svg className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
                                </svg>
                            ) : (
                                <FileIcon filename={file.name} className="w-4 h-4 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="text-[12px] truncate">{file.name}</div>
                                <div className="text-[10px] text-[var(--color-text-muted)] truncate">{file.relativePath}</div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Footer hint */}
            {results.length > 0 && (
                <div className="px-3 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-bg-deep)] text-[10px] text-[var(--color-text-muted)]">
                    <span className="inline-flex items-center gap-1">
                        <kbd className="px-1 py-0.5 bg-[var(--color-bg-card)] rounded text-[var(--color-text-primary)]">↑↓</kbd>
                        이동
                    </span>
                    <span className="inline-flex items-center gap-1 ml-3">
                        <kbd className="px-1 py-0.5 bg-[var(--color-bg-card)] rounded text-[var(--color-text-primary)]">Enter</kbd>
                        선택
                    </span>
                    <span className="inline-flex items-center gap-1 ml-3">
                        <kbd className="px-1 py-0.5 bg-[var(--color-bg-card)] rounded text-[var(--color-text-primary)]">Esc</kbd>
                        닫기
                    </span>
                </div>
            )}
        </div>
    )
}

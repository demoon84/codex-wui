import { useState, useRef, useEffect } from 'react'
import { THEMES, applyTheme, type Theme } from '../themes'

interface ThemeSelectorProps {
    currentTheme: Theme
    onThemeChange: (theme: Theme) => void
}

export function ThemeSelector({ currentTheme, onThemeChange }: ThemeSelectorProps) {
    const [isOpen, setIsOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    const handleSelect = (theme: Theme) => {
        applyTheme(theme)
        onThemeChange(theme)
        setIsOpen(false)
    }

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/10 transition-colors text-white"
                title="Select Theme"
            >
                {/* Palette Icon */}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                <span className="text-[11px]">{currentTheme.name}</span>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute bottom-full left-0 mb-1 w-56 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg shadow-xl py-1 z-50 max-h-80 overflow-y-auto">
                    <div className="px-3 py-1.5 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide border-b border-[var(--color-border-subtle)]">
                        Select Color Theme
                    </div>
                    {THEMES.map(theme => (
                        <button
                            key={theme.id}
                            onClick={() => handleSelect(theme)}
                            className={`flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-[var(--color-bg-hover)] transition-colors ${currentTheme.id === theme.id
                                ? 'text-[var(--color-primary)]'
                                : 'text-[var(--color-text-secondary)]'
                                }`}
                        >
                            {/* Theme color preview */}
                            <div className="flex gap-0.5">
                                <span
                                    className="w-3 h-3 rounded-sm"
                                    style={{ backgroundColor: theme.colors.bgDeep }}
                                />
                                <span
                                    className="w-3 h-3 rounded-sm"
                                    style={{ backgroundColor: theme.colors.primary }}
                                />
                                <span
                                    className="w-3 h-3 rounded-sm"
                                    style={{ backgroundColor: theme.colors.accent1 }}
                                />
                            </div>
                            <span className="text-[12px]">{theme.name}</span>
                            {currentTheme.id === theme.id && (
                                <svg className="w-3 h-3 ml-auto" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                </svg>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

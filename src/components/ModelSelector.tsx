import { useState, useRef, useEffect, memo } from 'react'
import { useI18n } from '../i18n'

export interface ModelConfig {
    id: string
    name: string
    description: string
    isThinking: boolean
}

// Available Codex CLI models (descriptions come from i18n)
export const AVAILABLE_MODELS: ModelConfig[] = [
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', description: 'model.gpt-5.3-codex', isThinking: false },
    { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', description: 'model.gpt-5.2-codex', isThinking: false },
    { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max', description: 'model.gpt-5.1-codex-max', isThinking: false },
    { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', description: 'model.gpt-5.1-codex-mini', isThinking: false },
    { id: 'o4-mini', name: 'o4-mini', description: 'model.o4-mini', isThinking: false },
    { id: 'gpt-4.1', name: 'GPT-4.1', description: 'model.gpt-4.1', isThinking: false },
]

interface ModelSelectorProps {
    model: ModelConfig
    onModelChange: (model: ModelConfig) => void
}

export const ModelSelector = memo(function ModelSelector({ model, onModelChange }: ModelSelectorProps) {
    const { t } = useI18n()
    const [showModelDropdown, setShowModelDropdown] = useState(false)
    const modelRef = useRef<HTMLDivElement>(null)

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
                setShowModelDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    return (
        <div className="flex items-center gap-1 text-[12px]">
            {/* Model Selector */}
            <div ref={modelRef} className="relative">
                <button
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded hover:bg-[var(--color-bg-hover)] transition-colors text-[var(--color-text-primary)]"
                >
                    <svg className={`w-3 h-3 text-[var(--color-text-muted)] transition-transform ${showModelDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                    <span className="whitespace-nowrap">{model.name}</span>
                </button>

                {showModelDropdown && (
                    <div className="absolute bottom-full left-0 mb-1 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg shadow-xl py-2 z-50 w-[320px]">
                        <div className="px-3 py-1 text-[11px] text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)] mb-1">
                            {t('selectModel')}
                        </div>
                        {AVAILABLE_MODELS.map(m => (
                            <button
                                key={m.id}
                                onClick={() => { onModelChange(m); setShowModelDropdown(false) }}
                                className={`w-full px-3 py-2 text-left hover:bg-[var(--color-bg-hover)] transition-colors ${model.id === m.id ? 'bg-[var(--color-bg-hover)]' : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className={`font-medium whitespace-nowrap ${model.id === m.id ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
                                        {m.name}
                                    </span>
                                    {m.isThinking && (
                                        <span className="text-[9px] px-1.5 py-0.5 bg-[var(--color-primary)]/20 text-[var(--color-primary)] rounded">{t('thinkingBadge')}</span>
                                    )}
                                </div>
                                <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                                    {t(m.description as any)}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
})

import { memo } from 'react'
import { Theme } from '../themes'
import { ThemeSelector } from './ThemeSelector'
import { useI18n } from '../i18n'

interface StatusBarProps {
    theme: Theme
    onThemeChange: (theme: Theme) => void
    workspacePath?: string
    yoloMode?: boolean
    onYoloModeChange?: (value: boolean) => void
    webSearchEnabled?: boolean
    onWebSearchChange?: (value: boolean) => void
}

export const StatusBar = memo(function StatusBar({
    theme,
    onThemeChange,
    workspacePath,
    yoloMode = true,
    onYoloModeChange,
    webSearchEnabled = false,
    onWebSearchChange
}: StatusBarProps) {
    const { t, locale, setLocale } = useI18n()
    return (
        <div className="flex items-center justify-between h-6 px-2 bg-[var(--color-primary)] text-white text-[11px] select-none">
            {/* Left side */}
            <div className="flex items-center gap-3">
                {/* Theme selector */}
                <ThemeSelector
                    currentTheme={theme}
                    onThemeChange={onThemeChange}
                />

                {/* Workspace path */}
                {workspacePath && (
                    <div className="flex items-center gap-1 opacity-80 truncate max-w-[400px]">
                        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span className="truncate">{workspacePath}</span>
                    </div>
                )}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-4">
                {/* Language toggle */}
                <button
                    onClick={() => setLocale(locale === 'en' ? 'ko' : 'en')}
                    className="flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity"
                    title={locale === 'en' ? 'Switch to Korean' : '영어로 전환'}
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 004 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>{locale === 'en' ? 'EN' : 'KO'}</span>
                </button>

                {/* Web Search toggle */}
                <button
                    onClick={() => onWebSearchChange?.(!webSearchEnabled)}
                    className="flex items-center gap-1.5"
                    title={webSearchEnabled ? 'Web Search ON' : 'Web Search OFF'}
                >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${webSearchEnabled ? 'bg-green-400' : 'bg-gray-400'}`} />
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span>web search</span>
                </button>

                {/* full access mode toggle */}
                <button
                    onClick={() => onYoloModeChange?.(!yoloMode)}
                    className="flex items-center gap-1.5"
                    title={yoloMode ? t('yoloTooltipOn') : t('yoloTooltipOff')}
                >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${yoloMode ? 'bg-green-400' : 'bg-orange-400'}`} />
                    <span>{yoloMode ? 'full access' : 'permission'}</span>
                </button>

            </div>
        </div>
    )
})

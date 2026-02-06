import { Theme } from '../themes'
import { ThemeSelector } from './ThemeSelector'

interface StatusBarProps {
    theme: Theme
    onThemeChange: (theme: Theme) => void
    workspacePath?: string
    yoloMode?: boolean
    onYoloModeChange?: (value: boolean) => void
}

export function StatusBar({ theme, onThemeChange, workspacePath, yoloMode = true, onYoloModeChange }: StatusBarProps) {
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
                {/* full access mode toggle */}
                <button
                    onClick={() => onYoloModeChange?.(!yoloMode)}
                    className="flex items-center gap-1.5"
                    title={yoloMode ? 'full access: 모든 작업 자동 승인' : 'permission: 작업 전 확인'}
                >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${yoloMode ? 'bg-green-400' : 'bg-orange-400'}`} />
                    <span>{yoloMode ? 'full access' : 'permission'}</span>
                </button>

            </div>
        </div>
    )
}

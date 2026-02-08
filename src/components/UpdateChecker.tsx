import { memo, useState, useEffect, useCallback } from 'react'

interface UpdateCheckerProps {
    currentVersion: string
}

interface UpdateInfo {
    hasUpdate: boolean
    latestVersion?: string
    releaseNotes?: string
    downloadUrl?: string
    lastChecked: number
}

const UPDATE_CHECK_KEY = 'codex-update-check'
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

function getStoredUpdateInfo(): UpdateInfo | null {
    try {
        const raw = localStorage.getItem(UPDATE_CHECK_KEY)
        return raw ? JSON.parse(raw) : null
    } catch {
        return null
    }
}

export const UpdateChecker = memo(function UpdateChecker({ currentVersion }: UpdateCheckerProps) {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(getStoredUpdateInfo)
    const [dismissed, setDismissed] = useState(false)

    const checkForUpdate = useCallback(async () => {
        try {
            // In a real implementation, this would check a remote endpoint
            // For now, we store the last check time and show the current version
            const info: UpdateInfo = {
                hasUpdate: false,
                latestVersion: currentVersion,
                lastChecked: Date.now(),
            }
            localStorage.setItem(UPDATE_CHECK_KEY, JSON.stringify(info))
            setUpdateInfo(info)
        } catch {
            // Silently fail
        }
    }, [currentVersion])

    // Auto-check on mount if last check was > 24h ago
    useEffect(() => {
        const stored = getStoredUpdateInfo()
        if (!stored || Date.now() - stored.lastChecked > CHECK_INTERVAL_MS) {
            checkForUpdate()
        }
    }, [checkForUpdate])

    if (dismissed || !updateInfo?.hasUpdate) return null

    return (
        <div className="fixed bottom-16 right-4 z-50 max-w-xs animate-in slide-in-from-bottom">
            <div className="bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-xl shadow-2xl p-4">
                <div className="flex items-start gap-3">
                    <div className="text-xl">🔄</div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-[12px] font-semibold text-[var(--color-text-primary)]">
                            Update Available
                        </h3>
                        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                            v{updateInfo.latestVersion} is available (current: v{currentVersion})
                        </p>
                        {updateInfo.releaseNotes && (
                            <p className="text-[10px] text-[var(--color-text-secondary)] mt-1 truncate">
                                {updateInfo.releaseNotes}
                            </p>
                        )}
                        <div className="flex gap-2 mt-2">
                            {updateInfo.downloadUrl && (
                                <a
                                    href={updateInfo.downloadUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] px-2.5 py-1 rounded bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity"
                                >
                                    Download
                                </a>
                            )}
                            <button
                                onClick={() => setDismissed(true)}
                                className="text-[10px] px-2.5 py-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
})

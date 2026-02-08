import { useState, memo } from 'react'
import { useI18n } from '../i18n'

interface ApprovalDialogProps {
    visible: boolean
    title?: string
    description?: string
    onApprove: () => void
    onReject?: () => void
}

export const ApprovalDialog = memo(function ApprovalDialog({ visible, title, description, onApprove, onReject }: ApprovalDialogProps) {
    const [approving, setApproving] = useState(false)
    const { t } = useI18n()

    if (!visible) return null

    const handleApprove = () => {
        setApproving(true)
        onApprove()
    }

    return (
        <div className="flex items-center gap-3 p-3 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg my-3">
            <div className="flex-1">
                <div className="text-sm font-medium text-[var(--color-text-primary)]">
                    {title || t('approvalTitle')}
                </div>
                {description && (
                    <div className="text-xs text-[var(--color-text-muted)] mt-1">
                        {description}
                    </div>
                )}
            </div>
            <div className="flex items-center gap-2">
                {onReject && (
                    <button
                        onClick={onReject}
                        disabled={approving}
                        className="px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-[var(--color-bg-hover)] hover:bg-[var(--color-border)] rounded transition-colors disabled:opacity-50"
                    >
                        {t('approvalReject')}
                    </button>
                )}
                <button
                    onClick={handleApprove}
                    disabled={approving}
                    className="px-3 py-1.5 text-xs text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] rounded transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                    {approving ? (
                        <>
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            {t('approvalApproving')}
                        </>
                    ) : (
                        t('approvalApprove')
                    )}
                </button>
            </div>
        </div>
    )
})

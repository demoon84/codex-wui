import { memo, useState } from 'react'

interface PdfViewerProps {
    src: string
    fileName?: string
    onClose?: () => void
}

export const PdfViewer = memo(function PdfViewer({ src, fileName, onClose }: PdfViewerProps) {
    const [error, setError] = useState(false)

    return (
        <div className="fixed inset-0 z-[150] flex items-center justify-center">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />
            <div className="relative w-[90vw] max-w-4xl h-[80vh] bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-card)]">
                    <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
                            <path d="M8 12h3v2H8v-2zm0 3h8v2H8v-2zm0 3h8v2H8v-2z" />
                        </svg>
                        <span className="text-[12px] text-[var(--color-text-primary)] font-medium truncate">
                            {fileName || 'PDF Document'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <a
                            href={src}
                            download={fileName}
                            className="text-[11px] px-2 py-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                            title="Download"
                        >
                            ⬇ Download
                        </a>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-colors"
                                title="Close"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden">
                    {error ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <div className="text-3xl">📄</div>
                            <p className="text-[12px] text-[var(--color-text-muted)]">
                                Unable to display PDF preview
                            </p>
                            <a
                                href={src}
                                download={fileName}
                                className="text-[11px] px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity"
                            >
                                Download Instead
                            </a>
                        </div>
                    ) : (
                        <iframe
                            src={src}
                            className="w-full h-full border-0"
                            title={fileName || 'PDF Viewer'}
                            onError={() => setError(true)}
                        />
                    )}
                </div>
            </div>
        </div>
    )
})

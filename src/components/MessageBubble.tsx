interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
}

interface MessageBubbleProps {
    message: Message
    isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
    const isUser = message.role === 'user'

    return (
        <div className={`flex items-start gap-3 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}>
            {/* Avatar */}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isUser
                ? 'bg-primary'
                : 'bg-[var(--color-bg-card)] border border-[var(--color-border)]'
                }`}>
                {isUser ? (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                ) : (
                    <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                )}
            </div>

            {/* Message Content */}
            <div className={`max-w-[80%] ${isUser ? 'text-right' : ''}`}>
                <div className={`inline-block px-4 py-3 rounded-2xl ${isUser
                    ? 'bg-[var(--color-bg-card)] text-white rounded-tr-sm'
                    : 'text-text-primary'
                    }`}>
                    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {message.content}
                        {isStreaming && (
                            <span className="typing-cursor ml-0.5 text-primary">▊</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

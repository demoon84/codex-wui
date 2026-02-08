import { memo, useState } from 'react'

interface WelcomeScreenProps {
    visible: boolean
    onComplete: () => void
    onOpenWorkspace: () => void
}

const STEPS = [
    {
        title: 'Welcome to Codex UI',
        subtitle: '강력한 AI 코딩 어시스턴트',
        description: 'Codex UI는 OpenAI Codex를 활용한 데스크탑 AI 코딩 도구입니다. 자연어로 코드를 작성하고, 리뷰하고, 디버깅하세요.',
        icon: '🚀',
    },
    {
        title: 'Workspace Setup',
        subtitle: '작업 폴더를 선택하세요',
        description: '프로젝트 폴더를 열어 Codex가 코드베이스를 이해하게 해주세요. @ 키를 사용하여 파일을 컨텍스트로 추가할 수 있습니다.',
        icon: '📁',
    },
    {
        title: 'Ready to Code',
        subtitle: '시작할 준비가 되었습니다',
        description: '채팅으로 질문하고, 코드를 생성/수정하고, 다양한 모델을 선택해보세요. Auto-approve 모드를 켜면 더 빠르게 작업할 수 있습니다.',
        icon: '⚡',
    },
]

export const WelcomeScreen = memo(function WelcomeScreen({
    visible,
    onComplete,
    onOpenWorkspace,
}: WelcomeScreenProps) {
    const [step, setStep] = useState(0)

    if (!visible) return null

    const current = STEPS[step]
    const isLast = step === STEPS.length - 1
    const isWorkspaceStep = step === 1

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />

            <div className="relative w-[520px] bg-[var(--color-bg-deep)] border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden">
                {/* Progress dots */}
                <div className="flex justify-center gap-2 pt-6">
                    {STEPS.map((_, i) => (
                        <div
                            key={i}
                            className={`w-2 h-2 rounded-full transition-all duration-300 ${i === step
                                    ? 'bg-[var(--color-primary)] w-6'
                                    : i < step
                                        ? 'bg-[var(--color-primary)]/50'
                                        : 'bg-[var(--color-border)]'
                                }`}
                        />
                    ))}
                </div>

                {/* Content */}
                <div className="px-10 py-8 text-center">
                    <div className="text-5xl mb-4">{current.icon}</div>
                    <h1 className="text-[20px] font-bold text-[var(--color-text-primary)] mb-1">
                        {current.title}
                    </h1>
                    <p className="text-[13px] text-[var(--color-primary)] font-medium mb-4">
                        {current.subtitle}
                    </p>
                    <p className="text-[12px] text-[var(--color-text-secondary)] leading-relaxed max-w-sm mx-auto">
                        {current.description}
                    </p>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between px-10 pb-8">
                    <button
                        onClick={() => step > 0 ? setStep(step - 1) : onComplete()}
                        className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                    >
                        {step > 0 ? '← Back' : 'Skip'}
                    </button>

                    <div className="flex gap-2">
                        {isWorkspaceStep && (
                            <button
                                onClick={onOpenWorkspace}
                                className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] transition-colors"
                            >
                                Open Folder
                            </button>
                        )}
                        <button
                            onClick={() => {
                                if (isLast) {
                                    onComplete()
                                } else {
                                    setStep(step + 1)
                                }
                            }}
                            className="px-5 py-2 rounded-lg bg-[var(--color-primary)] text-white text-[12px] font-medium hover:opacity-90 transition-opacity"
                        >
                            {isLast ? 'Get Started' : 'Next →'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
})

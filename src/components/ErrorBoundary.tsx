import { Component, type ReactNode, type ErrorInfo } from 'react'
import { captureReactError } from '../utils/errorTracker'

interface Props {
    children: ReactNode
    fallback?: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        captureReactError(error, errorInfo.componentStack ?? undefined)
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback

            return (
                <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-deep)]">
                    <div className="max-w-md p-8 text-center">
                        <div className="text-4xl mb-4">⚠️</div>
                        <h1 className="text-[16px] font-bold text-[var(--color-text-primary)] mb-2">
                            Something went wrong
                        </h1>
                        <p className="text-[12px] text-[var(--color-text-muted)] mb-4">
                            {this.state.error?.message || 'An unexpected error occurred'}
                        </p>
                        <button
                            onClick={() => {
                                this.setState({ hasError: false, error: null })
                            }}
                            className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-[12px] hover:opacity-90 transition-opacity"
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}

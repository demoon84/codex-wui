/**
 * Lightweight error tracking utility
 * 
 * A Sentry-like local error tracker that captures errors and stores them
 * in localStorage for debugging. Shows an error boundary UI for React errors.
 */

interface ErrorEntry {
    timestamp: string
    type: 'error' | 'unhandled-rejection' | 'react-boundary'
    message: string
    stack?: string
    componentStack?: string
}

const MAX_ENTRIES = 50
const STORAGE_KEY = 'codex-error-log'

function getStoredErrors(): ErrorEntry[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function storeError(entry: ErrorEntry) {
    const entries = getStoredErrors()
    entries.push(entry)
    // Keep only the most recent entries
    const trimmed = entries.slice(-MAX_ENTRIES)
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
    } catch {
        // Storage full, clear and retry
        localStorage.removeItem(STORAGE_KEY)
    }
}

export function captureError(error: unknown, context?: string) {
    const entry: ErrorEntry = {
        timestamp: new Date().toISOString(),
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    }
    if (context) entry.message = `[${context}] ${entry.message}`
    storeError(entry)
    console.error('[ErrorTracker]', entry.message, error)
}

export function getErrorLog(): ErrorEntry[] {
    return getStoredErrors()
}

export function clearErrorLog() {
    localStorage.removeItem(STORAGE_KEY)
}

export function initGlobalErrorHandlers() {
    window.addEventListener('error', (event) => {
        storeError({
            timestamp: new Date().toISOString(),
            type: 'error',
            message: event.message || 'Unknown error',
            stack: event.error?.stack,
        })
    })

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason
        storeError({
            timestamp: new Date().toISOString(),
            type: 'unhandled-rejection',
            message: reason instanceof Error ? reason.message : String(reason),
            stack: reason instanceof Error ? reason.stack : undefined,
        })
    })
}

export function captureReactError(error: Error, componentStack?: string) {
    storeError({
        timestamp: new Date().toISOString(),
        type: 'react-boundary',
        message: error.message,
        stack: error.stack,
        componentStack,
    })
}

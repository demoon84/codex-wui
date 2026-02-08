/**
 * System Notifications utility
 * 
 * Uses the browser Notification API (works in Tauri webview) 
 * to show desktop notifications when relevant events occur.
 */

let permissionGranted = false

export async function requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in window)) return false

    if (Notification.permission === 'granted') {
        permissionGranted = true
        return true
    }

    if (Notification.permission === 'denied') return false

    const result = await Notification.requestPermission()
    permissionGranted = result === 'granted'
    return permissionGranted
}

export function isNotificationEnabled(): boolean {
    return permissionGranted || (typeof Notification !== 'undefined' && Notification.permission === 'granted')
}

export function sendNotification(title: string, options?: { body?: string; tag?: string }) {
    if (!isNotificationEnabled()) return

    // Only notify when the window is not focused
    if (document.hasFocus()) return

    try {
        new Notification(title, {
            body: options?.body,
            tag: options?.tag || 'codex-notification',
            icon: '/icons/128x128.png',
            silent: false,
        })
    } catch {
        // Silently fail if notification API is not available
    }
}

export function notifyTurnCompleted(threadName?: string) {
    sendNotification('Turn Completed', {
        body: threadName ? `Thread: ${threadName}` : 'Codex has finished processing.',
        tag: 'turn-completed',
    })
}

export function notifyError(errorMessage: string) {
    sendNotification('Error', {
        body: errorMessage,
        tag: 'codex-error',
    })
}

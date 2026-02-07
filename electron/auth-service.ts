import { ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

type LoginMethod = 'browser' | 'device-auth' | 'api-key'

export interface CodexUser {
    id: string
    email: string
    name: string
    picture: string
    authMode?: string
    authProvider?: string
}

function getCodexAuthPath(): string {
    return join(homedir(), '.codex', 'auth.json')
}

function decodeJwtPayload(token?: string): any | null {
    if (!token) return null
    const parts = token.split('.')
    if (parts.length < 2) return null
    try {
        const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
        return JSON.parse(payload)
    } catch {
        return null
    }
}

function checkCachedCredentials(): { authenticated: boolean; user?: CodexUser } {
    const authPath = getCodexAuthPath()
    if (!existsSync(authPath)) {
        return { authenticated: false }
    }

    try {
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'))
        const authMode = String(auth.auth_mode || 'unknown')
        const idToken = auth?.tokens?.id_token as string | undefined
        const payload = decodeJwtPayload(idToken)
        const email = String(payload?.email || '')
        const authProvider = String(payload?.auth_provider || (authMode === 'api_key' ? 'api_key' : ''))
        const user: CodexUser = {
            id: String(auth?.tokens?.account_id || 'codex-user'),
            email,
            name: email ? email.split('@')[0] : `codex-${authMode}`,
            picture: '',
            authMode,
            authProvider,
        }
        return { authenticated: true, user }
    } catch {
        return { authenticated: false }
    }
}

async function performLogin(method: LoginMethod = 'browser', apiKey?: string): Promise<{ success: boolean; user?: CodexUser; error?: string }> {
    const existing = checkCachedCredentials()
    if (existing.authenticated && existing.user) {
        return { success: true, user: existing.user }
    }

    return new Promise((resolve) => {
        const args = ['login']
        if (method === 'device-auth') {
            args.push('--device-auth')
        }
        if (method === 'api-key') {
            if (!apiKey?.trim()) {
                resolve({ success: false, error: 'API key is required.' })
                return
            }
            args.push('--with-api-key')
        }

        const child = spawn('codex', args, {
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: process.env,
        })

        let stderr = ''
        child.stderr?.on('data', (data) => {
            stderr += data.toString()
        })

        if (method === 'api-key' && child.stdin) {
            child.stdin.write(`${apiKey!.trim()}\n`)
            child.stdin.end()
        }

        child.on('close', (code) => {
            const result = checkCachedCredentials()
            if (result.authenticated && result.user) {
                resolve({ success: true, user: result.user })
                return
            }
            resolve({ success: false, error: stderr || `codex login failed with exit code ${code ?? -1}` })
        })

        child.on('error', (err) => {
            resolve({ success: false, error: String(err) })
        })
    })
}

async function performLogout(): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
        const child = spawn('codex', ['logout'], {
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        })

        let stderr = ''
        child.stderr?.on('data', (data) => {
            stderr += data.toString()
        })

        child.on('close', (code) => {
            if ((code ?? 1) === 0) {
                resolve({ success: true })
            } else {
                resolve({ success: false, error: stderr || `codex logout failed with exit code ${code ?? -1}` })
            }
        })

        child.on('error', (err) => {
            resolve({ success: false, error: String(err) })
        })
    })
}

export function setupAuthHandlers() {
    ipcMain.handle('codex-login', async (_, payload?: { method?: LoginMethod; apiKey?: string }) => {
        try {
            return await performLogin(payload?.method || 'browser', payload?.apiKey)
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('codex-logout', async () => {
        try {
            return await performLogout()
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('codex-login-methods', async () => {
        return {
            methods: [
                { id: 'browser', label: 'Browser OAuth' },
                { id: 'device-auth', label: 'Device Auth' },
                { id: 'api-key', label: 'API Key' },
            ],
        }
    })

    ipcMain.handle('get-user', async () => {
        const result = checkCachedCredentials()
        return result.user || null
    })
}

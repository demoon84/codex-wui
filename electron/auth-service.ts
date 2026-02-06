import { shell, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'

export interface GoogleUser {
    id: string
    email: string
    name: string
    picture: string
}

// Gemini CLI 인증 파일 경로
function getGeminiCredentialPaths(): string[] {
    const home = homedir()
    return [
        join(home, '.gemini', 'oauth_creds.json'),
        join(home, '.gemini', 'google_accounts.json'),
    ]
}

// 캐시된 인증 정보 확인
function checkCachedCredentials(): { authenticated: boolean; user?: GoogleUser } {
    const credPaths = getGeminiCredentialPaths()

    // google_accounts.json 확인 (사용자 정보 포함)
    const accountsPath = credPaths[1]
    if (existsSync(accountsPath)) {
        try {
            const content = readFileSync(accountsPath, 'utf-8')
            const accounts = JSON.parse(content)

            // 배열인 경우 첫 번째 계정
            if (Array.isArray(accounts) && accounts.length > 0) {
                const account = accounts[0]
                return {
                    authenticated: true,
                    user: {
                        id: account.id || account.sub || '',
                        email: account.email || '',
                        name: account.name || account.email?.split('@')[0] || '',
                        picture: account.picture || ''
                    }
                }
            }

            // 객체인 경우
            if (accounts && typeof accounts === 'object' && Object.keys(accounts).length > 0) {
                const firstKey = Object.keys(accounts)[0]
                const account = accounts[firstKey]
                return {
                    authenticated: true,
                    user: {
                        id: account.id || firstKey || '',
                        email: account.email || firstKey || '',
                        name: account.name || account.email?.split('@')[0] || '',
                        picture: account.picture || ''
                    }
                }
            }
        } catch (e) {
            console.log(`[Auth] Invalid accounts file: ${accountsPath}`)
        }
    }

    // oauth_creds.json 확인 (토큰만 있음)
    const oauthPath = credPaths[0]
    if (existsSync(oauthPath)) {
        try {
            const content = readFileSync(oauthPath, 'utf-8')
            const creds = JSON.parse(content)
            if (creds.refresh_token || creds.access_token) {
                console.log(`[Auth] Found OAuth credentials at: ${oauthPath}`)
                return {
                    authenticated: true,
                    user: {
                        id: 'gemini-user',
                        email: '',
                        name: '',
                        picture: ''
                    }
                }
            }
        } catch (e) {
            console.log(`[Auth] Invalid OAuth file: ${oauthPath}`)
        }
    }

    return { authenticated: false }
}

// 로그아웃
async function performLogout(): Promise<{ success: boolean }> {
    const credPaths = getGeminiCredentialPaths()

    for (const credPath of credPaths) {
        if (existsSync(credPath)) {
            try {
                unlinkSync(credPath)
                console.log(`[Auth] Deleted: ${credPath}`)
            } catch (e) {
                console.error(`[Auth] Failed to delete ${credPath}:`, e)
            }
        }
    }

    return { success: true }
}

// 로그인 (Gemini CLI 트리거)
async function performLogin(): Promise<{ success: boolean; user?: GoogleUser }> {
    return new Promise((resolve) => {
        console.log('[Auth] Starting Gemini CLI for authentication...')

        // 이미 인증되어 있는지 확인
        const existing = checkCachedCredentials()
        if (existing.authenticated && existing.user) {
            resolve({ success: true, user: existing.user })
            return
        }

        // Gemini CLI 실행으로 인증 트리거
        const child = spawn('gemini', ['안녕'], {
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                GOOGLE_GENAI_USE_GCA: 'true'
            }
        })

        let authUrl = ''

        child.stderr?.on('data', (data) => {
            const text = data.toString()
            console.log('[Auth stderr]:', text)

            // 인증 URL 감지
            const urlMatch = text.match(/https:\/\/accounts\.google\.com\S+/) ||
                text.match(/https:\/\/g\.co\/\S+/)
            if (urlMatch) {
                authUrl = urlMatch[0]
                console.log('[Auth] Opening auth URL:', authUrl)
                shell.openExternal(authUrl)
            }
        })

        child.on('close', () => {
            const result = checkCachedCredentials()
            resolve({
                success: result.authenticated,
                user: result.user
            })
        })

        child.on('error', (err) => {
            console.error('[Auth] Spawn error:', err)
            resolve({ success: false })
        })

        // 타임아웃 (20초)
        setTimeout(() => {
            child.kill()
            const result = checkCachedCredentials()
            resolve({
                success: result.authenticated,
                user: result.user
            })
        }, 20000)
    })
}

// IPC 핸들러 설정
export function setupAuthHandlers() {
    ipcMain.handle('google-login', async () => {
        try {
            return await performLogin()
        } catch (error) {
            console.error('[Auth] Login error:', error)
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('google-logout', async () => {
        try {
            return await performLogout()
        } catch (error) {
            console.error('[Auth] Logout error:', error)
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('get-user', async () => {
        const result = checkCachedCredentials()
        return result.user || null
    })
}

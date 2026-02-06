import { app, BrowserWindow, ipcMain, globalShortcut, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { getCodexService, ModelMode } from './codex-service'
import * as db from './db'

const execAsync = promisify(exec)

// Check if Codex CLI is installed
async function isCodexInstalled(): Promise<boolean> {
    try {
        await execAsync('codex --version')
        return true
    } catch {
        return false
    }
}

// Install Codex CLI via npm
async function installCodex(): Promise<{ success: boolean; error?: string }> {
    console.log('[Main] Installing Codex CLI...')
    try {
        await execAsync('npm install -g @openai/codex')
        console.log('[Main] Codex CLI installed successfully')
        return { success: true }
    } catch (error) {
        console.error('[Main] Failed to install Codex CLI:', error)
        return { success: false, error: String(error) }
    }
}

// Alias for easier migration
const getAcpService = getCodexService

// File search result interface
interface FileSearchResult {
    name: string
    path: string
    relativePath: string
    isDirectory: boolean
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT, 'public')
    : RENDERER_DIST

let win: BrowserWindow | null = null

// Store approval request callbacks
const approvalCallbacks = new Map<string, (approved: boolean) => void>()

// Setup auth handlers from auth-service
import { setupAuthHandlers } from './auth-service'
setupAuthHandlers()

// Set model mode
ipcMain.handle('set-mode', async (_, mode: ModelMode) => {
    getAcpService().setMode(mode)
    return mode
})

// Get current mode
ipcMain.handle('get-mode', async () => {
    return getAcpService().getMode()
})

// Set YOLO mode (auto-approve)
ipcMain.handle('set-yolo-mode', async (_, enabled: boolean) => {
    getAcpService().setYoloMode(enabled)
    return enabled
})

// Get YOLO mode status
ipcMain.handle('get-yolo-mode', async () => {
    return getAcpService().isYoloMode()
})

// Get available models
ipcMain.handle('get-models', async () => {
    return getAcpService().getAvailableModels()
})

// Get current model
ipcMain.handle('get-model', async () => {
    return getAcpService().getModel()
})

// Set model
ipcMain.handle('set-model', async (_, modelId: string) => {
    getAcpService().setModel(modelId)
    return modelId
})

// Update titleBarOverlay color when theme changes
ipcMain.handle('update-title-bar-overlay', async (_, { color, symbolColor }: { color: string; symbolColor: string }) => {
    if (win && process.platform === 'win32') {
        try {
            win.setTitleBarOverlay({
                color,
                symbolColor,
                height: 32
            })
            return { success: true }
        } catch (error) {
            console.error('[Main] Failed to update titleBarOverlay:', error)
            return { success: false, error: String(error) }
        }
    }
    return { success: true }
})

// Cancel current prompt
ipcMain.handle('cancel-prompt', async () => {
    try {
        await getAcpService().cancel()
        return { success: true }
    } catch (error) {
        console.error('[Main] Cancel error:', error)
        return { success: false, error: String(error) }
    }
})

// Initialize ACP
ipcMain.handle('init-acp', async () => {
    try {
        const result = await getAcpService().initialize()
        // Send acp-ready event to renderer
        if (result && win) {
            win.webContents.send('acp-ready', true)
        }
        return { success: result }
    } catch (error) {
        console.error('[Main] ACP init error:', error)
        return { success: false, error: String(error) }
    }
})

// Check if Codex CLI is installed
ipcMain.handle('check-codex', async () => {
    const installed = await isCodexInstalled()
    return { installed }
})

// Install Codex CLI
ipcMain.handle('install-codex', async (event) => {
    const webContents = event.sender
    webContents.send('codex-install-progress', { status: 'installing', message: 'Codex CLI 설치 중...' })

    const result = await installCodex()

    if (result.success) {
        webContents.send('codex-install-progress', { status: 'complete', message: 'Codex CLI 설치 완료' })
    } else {
        webContents.send('codex-install-progress', { status: 'error', message: result.error || '설치 실패' })
    }

    return result
})

// Open workspace folder dialog
ipcMain.handle('open-workspace', async () => {
    const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Workspace Folder'
    })

    if (result.canceled || result.filePaths.length === 0) {
        return null
    }

    const folderPath = result.filePaths[0]
    const folderName = path.basename(folderPath)

    return { path: folderPath, name: folderName }
})

// Switch workspace - creates new ACP session with workspace cwd
ipcMain.handle('switch-workspace', async (_, workspaceId: string, cwd: string) => {
    try {
        const sessionId = await getAcpService().switchWorkspace(workspaceId, cwd)
        console.log(`[Main] Switched to workspace: ${workspaceId} (session: ${sessionId})`)
        return { success: true, sessionId }
    } catch (error) {
        console.error('[Main] Switch workspace error:', error)
        return { success: false, error: String(error) }
    }
})

// ===== Database IPC Handlers =====

// Get full state (all workspaces with conversations and messages)
ipcMain.handle('db-get-state', async () => {
    return db.getFullState()
})

// Workspace operations
ipcMain.handle('db-create-workspace', async (_, id: string, name: string, workspacePath: string) => {
    return db.createWorkspace(id, name, workspacePath)
})

ipcMain.handle('db-delete-workspace', async (_, id: string) => {
    db.deleteWorkspace(id)
    return { success: true }
})

// Conversation operations
ipcMain.handle('db-get-conversations', async (_, workspaceId: string) => {
    return db.getConversationsByWorkspace(workspaceId)
})

ipcMain.handle('db-create-conversation', async (_, id: string, workspaceId: string, title: string) => {
    return db.createConversation(id, workspaceId, title)
})

ipcMain.handle('db-update-conversation-title', async (_, id: string, title: string) => {
    db.updateConversationTitle(id, title)
    return { success: true }
})

ipcMain.handle('db-delete-conversation', async (_, id: string) => {
    db.deleteConversation(id)
    return { success: true }
})

// Message operations
ipcMain.handle('db-get-messages', async (_, conversationId: string) => {
    return db.getMessagesByConversation(conversationId)
})

ipcMain.handle('db-create-message', async (_, message: db.Message) => {
    return db.createMessage(message)
})

// ===== File Search IPC Handlers =====

// Recursively get files from directory
async function getFilesRecursively(dir: string, basePath: string, maxDepth = 4, currentDepth = 0): Promise<FileSearchResult[]> {
    if (currentDepth > maxDepth) return []

    const results: FileSearchResult[] = []
    const ignoreDirs = ['node_modules', '.git', 'dist', 'dist-electron', '.next', '.vite', 'coverage', '__pycache__', '.cache']

    try {
        const entries = await fs.readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            const relativePath = path.relative(basePath, fullPath)

            if (entry.isDirectory()) {
                if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
                    results.push({
                        name: entry.name,
                        path: fullPath,
                        relativePath,
                        isDirectory: true
                    })
                    // Recurse into subdirectory
                    const subResults = await getFilesRecursively(fullPath, basePath, maxDepth, currentDepth + 1)
                    results.push(...subResults)
                }
            } else {
                results.push({
                    name: entry.name,
                    path: fullPath,
                    relativePath,
                    isDirectory: false
                })
            }
        }
    } catch (error) {
        console.error(`[Main] Error reading directory ${dir}:`, error)
    }

    return results
}

// Search files in workspace
ipcMain.handle('search-files', async (_, workspacePath: string, query: string) => {
    try {
        const allFiles = await getFilesRecursively(workspacePath, workspacePath)

        // Filter by query (fuzzy match)
        const lowerQuery = query.toLowerCase()
        const filtered = allFiles.filter(file => {
            const lowerPath = file.relativePath.toLowerCase()
            const lowerName = file.name.toLowerCase()
            return lowerPath.includes(lowerQuery) || lowerName.includes(lowerQuery)
        })

        // Sort: directories first, then by relevance
        filtered.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1
            }
            // Prefer exact name match
            const aExact = a.name.toLowerCase() === lowerQuery
            const bExact = b.name.toLowerCase() === lowerQuery
            if (aExact !== bExact) return aExact ? -1 : 1
            // Then by path length
            return a.relativePath.length - b.relativePath.length
        })

        return filtered.slice(0, 20) // Limit results
    } catch (error) {
        console.error('[Main] Error searching files:', error)
        return []
    }
})

// Read file content
ipcMain.handle('read-file-content', async (_, filePath: string) => {
    try {
        const content = await fs.readFile(filePath, 'utf-8')
        return { success: true, content }
    } catch (error) {
        console.error('[Main] Error reading file:', error)
        return { success: false, error: String(error) }
    }
})

// Write file content
ipcMain.handle('write-file', async (_, filePath: string, content: string) => {
    try {
        await fs.writeFile(filePath, content, 'utf-8')
        return { success: true }
    } catch (error) {
        console.error('[Main] Error writing file:', error)
        return { success: false, error: String(error) }
    }
})

// List directory
ipcMain.handle('list-directory', async (_, dirPath: string) => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        const result = await Promise.all(entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name)
            let size = 0
            if (entry.isFile()) {
                try {
                    const stat = await fs.stat(fullPath)
                    size = stat.size
                } catch { }
            }
            return {
                name: entry.name,
                path: fullPath,
                isDirectory: entry.isDirectory(),
                size
            }
        }))
        return { success: true, entries: result }
    } catch (error) {
        console.error('[Main] Error listing directory:', error)
        return { success: false, error: String(error) }
    }
})

// Check if file exists
ipcMain.handle('file-exists', async (_, filePath: string) => {
    try {
        await fs.access(filePath)
        return true
    } catch {
        return false
    }
})

// Run terminal command
import { ChildProcess } from 'node:child_process'
const runningProcesses: Map<string, ChildProcess> = new Map()

ipcMain.handle('run-command', async (event, command: string, cwd: string) => {
    return new Promise((resolve) => {
        const commandId = `cmd_${Date.now()}`
        let output = ''
        let errorOutput = ''

        const child = spawn(command, {
            shell: true,
            cwd,
            env: process.env
        })

        runningProcesses.set(commandId, child)

        child.stdout?.on('data', (data) => {
            const text = data.toString()
            output += text
            // Send streaming output
            event.sender.send('command-output', { commandId, type: 'stdout', data: text })
        })

        child.stderr?.on('data', (data) => {
            const text = data.toString()
            errorOutput += text
            event.sender.send('command-output', { commandId, type: 'stderr', data: text })
        })

        child.on('close', (code) => {
            runningProcesses.delete(commandId)
            resolve({
                success: code === 0,
                commandId,
                output,
                errorOutput,
                exitCode: code
            })
        })

        child.on('error', (err) => {
            runningProcesses.delete(commandId)
            resolve({
                success: false,
                commandId,
                error: err.message
            })
        })

        // Timeout after 60 seconds
        setTimeout(() => {
            if (runningProcesses.has(commandId)) {
                child.kill()
                runningProcesses.delete(commandId)
                resolve({
                    success: false,
                    commandId,
                    error: 'Command timed out after 60 seconds'
                })
            }
        }, 60000)
    })
})

// Kill running command
ipcMain.handle('kill-command', async (_, commandId: string) => {
    const process = runningProcesses.get(commandId)
    if (process) {
        process.kill()
        runningProcesses.delete(commandId)
        return { success: true }
    }
    return { success: false, error: 'Command not found' }
})

// ===== Interactive PTY Terminal =====
interface PtyTerminal {
    process: ChildProcess
    output: string
}

const ptyTerminals: Map<string, PtyTerminal> = new Map()

// Create interactive terminal
ipcMain.handle('pty-create', async (event, { cwd, shell }: { cwd?: string; shell?: string }) => {
    const id = `pty_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const shellPath = shell || (process.platform === 'win32' ? 'powershell.exe' : 'bash')

    const child = spawn(shellPath, [], {
        shell: false,
        cwd: cwd || process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' },
        stdio: ['pipe', 'pipe', 'pipe']
    })

    let output = ''

    child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        output += text
        event.sender.send('pty-data', { id, data: text })
    })

    child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        output += text
        event.sender.send('pty-data', { id, data: text })
    })

    child.on('close', (code) => {
        event.sender.send('pty-exit', { id, exitCode: code })
        ptyTerminals.delete(id)
    })

    child.on('error', (err) => {
        console.error('[PTY] Error:', err)
        event.sender.send('pty-exit', { id, exitCode: -1 })
        ptyTerminals.delete(id)
    })

    ptyTerminals.set(id, { process: child, output })
    console.log(`[PTY] Created terminal ${id} (shell: ${shellPath}, cwd: ${cwd})`)

    return { id, shell: shellPath }
})

// Write to terminal (stdin)
ipcMain.handle('pty-write', async (_, { id, data }: { id: string; data: string }) => {
    const terminal = ptyTerminals.get(id)
    if (terminal?.process.stdin) {
        terminal.process.stdin.write(data)
        return { success: true }
    }
    return { success: false, error: 'Terminal not found' }
})

// Kill terminal
ipcMain.handle('pty-kill', async (_, { id }: { id: string }) => {
    const terminal = ptyTerminals.get(id)
    if (terminal) {
        terminal.process.kill()
        ptyTerminals.delete(id)
        return { success: true }
    }
    return { success: false, error: 'Terminal not found' }
})

// List active terminals
ipcMain.handle('pty-list', async () => {
    return Array.from(ptyTerminals.keys())
})


// Web search using DuckDuckGo instant answer API
ipcMain.handle('web-search', async (_, query: string) => {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
        const response = await fetch(url)
        const data = await response.json()

        const results: Array<{ title: string, url: string, snippet: string }> = []

        // Abstract (main result)
        if (data.Abstract) {
            results.push({
                title: data.Heading || query,
                url: data.AbstractURL || '',
                snippet: data.Abstract
            })
        }

        // Related topics
        if (data.RelatedTopics) {
            for (const topic of data.RelatedTopics.slice(0, 5)) {
                if (topic.Text && topic.FirstURL) {
                    results.push({
                        title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 50),
                        url: topic.FirstURL,
                        snippet: topic.Text
                    })
                }
            }
        }

        return { success: true, results }
    } catch (error) {
        console.error('[Main] Web search error:', error)
        return { success: false, error: String(error), results: [] }
    }
})

// Stream Gemini response via ACP
ipcMain.handle('stream-gemini', async (event, prompt: string, conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>) => {
    const webContents = event.sender
    const acp = getAcpService()

    const mode = acp.getMode()
    console.log(`[Main] Streaming with mode: ${mode}, history: ${conversationHistory?.length || 0} messages`)
    webContents.send('gemini-mode', mode)

    return new Promise<void>((resolve) => {
        acp.prompt(prompt, {
            onThinking: (text) => {
                webContents.send('gemini-thinking', text)
            },
            onThinkingDelta: (delta) => {
                webContents.send('gemini-thinking-delta', delta)
            },
            onContent: (text) => {
                webContents.send('gemini-stream-token', text)
            },
            onContentDelta: (delta) => {
                webContents.send('gemini-stream-delta', delta)
            },
            onToolCall: (title, status, output) => {
                webContents.send('gemini-tool-call', { title, status, output })
            },
            onTerminalOutput: (terminalId, output, exitCode) => {
                webContents.send('gemini-terminal-output', { terminalId, output, exitCode })
            },
            onApprovalRequest: (title, description, respond) => {
                // Store the respond callback for this request
                const requestId = Date.now().toString()
                approvalCallbacks.set(requestId, respond)
                webContents.send('gemini-approval-request', { requestId, title, description })
            },
            onProgress: (text) => {
                webContents.send('gemini-progress', text)
            },
            onError: (error) => {
                console.error('[Main] ACP Error:', error)
                webContents.send('gemini-stream-error', error.message)
                resolve()
            },
            onComplete: () => {
                console.log('[Main] ACP Complete')
                webContents.send('gemini-stream-end', {})
                resolve()
            }
        }, conversationHistory)
    })
})

// Handle approval response from UI
ipcMain.handle('gemini:approval-response', async (_event: Electron.IpcMainInvokeEvent, { requestId, approved }: { requestId: string; approved: boolean }) => {
    const callback = approvalCallbacks.get(requestId)
    if (callback) {
        callback(approved)
        approvalCallbacks.delete(requestId)
    }
})

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'Codex UI',
        autoHideMenuBar: true,
        icon: path.join(process.env.VITE_PUBLIC || '', 'icon.png'),
        backgroundColor: '#121212',
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#21222c',
            symbolColor: '#888888',
            height: 32
        },
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        show: true,
    })

    win.once('ready-to-show', () => {
        win?.show()
        // Initialize ACP when window is ready (non-blocking)
        const initialPath = db.getFirstWorkspacePath()
        console.log('[Main] Initial workspace path:', initialPath)
        getAcpService().initialize(initialPath || undefined).then(async success => {
            console.log('[Main] ACP initialized:', success)
            win?.webContents.send('acp-ready', success)

            // Warmup: preload Gemini model to reduce first response latency
            if (success) {
                console.log('[Main] Starting warmup to preload model...')
                getAcpService().warmup().then(() => {
                    console.log('[Main] Warmup complete - ready for fast responses')
                }).catch(err => {
                    console.log('[Main] Warmup failed (non-critical):', err)
                })
            }
        }).catch(err => {
            console.error('[Main] ACP init failed:', err)
            win?.webContents.send('acp-ready', false)
        })
    })

    if (VITE_DEV_SERVER_URL) {
        win.loadURL(VITE_DEV_SERVER_URL)
        win.webContents.openDevTools()
    } else {
        win.loadFile(path.join(RENDERER_DIST, 'index.html'))
    }

    globalShortcut.register('F12', () => {
        win?.webContents.toggleDevTools()
    })
}

app.on('window-all-closed', () => {
    getAcpService().destroy()
    db.closeDatabase()
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(() => {
    db.initDatabase()
    createWindow()
})

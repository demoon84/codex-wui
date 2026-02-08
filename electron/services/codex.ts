import { ChildProcess } from 'child_process';
import { dialog, BrowserWindow } from 'electron';
import { WebContents } from 'electron';
import { AppState, CliOptions, CommandResult, ModelInfo, RunningCodexProcess } from './models';
import {
    buildCodexExecArgs,
    cleanProgressText,
    commandSpawnOptions,
    defaultModels,
    expandTildePath,
    parseCodexEvent,
    spawnCommand,
    StreamParseCache,
} from './utils';
import * as readline from 'readline';

// ===== Mode / Model / Config =====

export function setMode(state: AppState, mode: string): string {
    state.config.mode = mode;
    return mode;
}

export function getMode(state: AppState): string {
    return state.config.mode;
}

export function setYoloMode(state: AppState, enabled: boolean): boolean {
    state.config.yoloMode = enabled;
    return enabled;
}

export function getYoloMode(state: AppState): boolean {
    return state.config.yoloMode;
}

export function getModels(): ModelInfo[] {
    return defaultModels();
}

export function getModel(state: AppState): string {
    return state.config.model;
}

export function setModel(state: AppState, modelId: string): string {
    state.config.model = modelId;
    return modelId;
}

export function setCliOptions(state: AppState, options: Partial<CliOptions>): CliOptions {
    const merged = { ...state.config.cliOptions };
    if (options.profile !== undefined) merged.profile = options.profile;
    if (options.sandbox !== undefined) merged.sandbox = options.sandbox;
    if (options.askForApproval !== undefined) merged.askForApproval = options.askForApproval;
    if (options.skipGitRepoCheck !== undefined) merged.skipGitRepoCheck = options.skipGitRepoCheck;
    if (options.cwdOverride !== undefined) merged.cwdOverride = options.cwdOverride;
    if (options.extraArgs !== undefined) merged.extraArgs = options.extraArgs;
    if (options.enableWebSearch !== undefined) merged.enableWebSearch = options.enableWebSearch;
    state.config.cliOptions = merged;
    return merged;
}

export function getCliOptions(state: AppState): CliOptions {
    return state.config.cliOptions;
}

// ===== ACP / Workspace =====

export function initAcp(webContents: WebContents): { success: boolean } {
    webContents.send('acp-ready', true);
    return { success: true };
}

export function switchWorkspace(
    state: AppState,
    workspaceId: string,
    cwd: string,
): { success: boolean; sessionId?: string } {
    state.config.cwd = expandTildePath(cwd);
    return { success: true, sessionId: workspaceId };
}

export function debugLog(msg: string): void {
    console.error(`[FRONTEND] ${msg}`);
}

// ===== Check / Install Codex =====

export function checkCodex(): { installed: boolean } {
    try {
        const { execSync } = require('child_process');
        const opts = commandSpawnOptions();
        execSync('codex --version', { ...opts, stdio: 'ignore' });
        return { installed: true };
    } catch {
        return { installed: false };
    }
}

export function installCodex(webContents: WebContents): { success: boolean; error?: string } {
    webContents.send('codex-install-progress', {
        status: 'installing',
        message: 'Installing Codex CLI...',
        percent: 0,
    });

    const opts = commandSpawnOptions();
    const child = spawnCommand('npm', ['install', '-g', '@openai/codex']);

    return new Promise((resolve) => {
        let lineCount = 0;

        if (child.stderr) {
            const rl = readline.createInterface({ input: child.stderr });
            rl.on('line', (line: string) => {
                if (!line.trim()) return;
                lineCount++;
                const percent = Math.min(10 + lineCount * 5, 80);
                webContents.send('codex-install-progress', {
                    status: 'installing',
                    message: line.trim(),
                    percent,
                });
            });
        }

        if (child.stdout) {
            const rl = readline.createInterface({ input: child.stdout });
            rl.on('line', (line: string) => {
                if (!line.trim()) return;
                webContents.send('codex-install-progress', {
                    status: 'installing',
                    message: line.trim(),
                    percent: 85,
                });
            });
        }

        child.on('exit', (code) => {
            if (code === 0) {
                webContents.send('codex-install-progress', {
                    status: 'complete',
                    message: 'Codex CLI installed successfully',
                    percent: 100,
                });
                resolve({ success: true });
            } else {
                const msg = `Install failed: exit ${code}`;
                webContents.send('codex-install-progress', {
                    status: 'error',
                    message: msg,
                    percent: 0,
                });
                resolve({ success: false, error: 'Installation failed' });
            }
        });

        child.on('error', (err) => {
            const msg = err.message.includes('ENOENT')
                ? 'npm executable was not found. Please install Node.js and make sure npm is available in PATH.'
                : err.message;
            webContents.send('codex-install-progress', {
                status: 'error',
                message: msg,
                percent: 0,
            });
            resolve({ success: false, error: msg });
        });
    }) as any;
}

// ===== Open Workspace =====

export async function openWorkspace(): Promise<{ path: string; name: string } | null> {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = result.filePaths[0];
    const folderName = require('path').basename(folderPath);
    return { path: folderPath, name: folderName };
}

// ===== Cancel / Stream Codex =====

export function cancelPrompt(
    webContents: WebContents,
    conversationId: string,
    state: AppState,
): { success: boolean } {
    let hadProcess = false;
    const process = state.runningCodex.get(conversationId);
    if (process) {
        hadProcess = true;
        try {
            process.child.kill();
        } catch { }
        state.runningCodex.delete(conversationId);
    }

    // Clean up pending approvals for this conversation
    for (const [key, pending] of state.pendingApprovals) {
        if (pending.conversationId === conversationId) {
            state.pendingApprovals.delete(key);
        }
    }

    if (hadProcess) {
        webContents.send('codex-stream-end', { cid: conversationId, cancelled: true });
    }
    return { success: true };
}

export function streamCodex(
    webContents: WebContents,
    conversationId: string,
    prompt: string,
    conversationHistory: Array<{ role: string; content: string }> | undefined,
    state: AppState,
): void {
    // Kill existing process for this conversation
    const existing = state.runningCodex.get(conversationId);
    if (existing) {
        try {
            existing.child.kill();
        } catch { }
        state.runningCodex.delete(conversationId);
    }

    // Clean up pending approvals
    for (const [key, pending] of state.pendingApprovals) {
        if (pending.conversationId === conversationId) {
            state.pendingApprovals.delete(key);
        }
    }

    const [_fullPrompt, runCwd, args] = buildCodexExecArgs(prompt, state.config, conversationHistory);

    console.error(`[streamCodex] codex ${args.join(' ')}`);
    console.error(`[streamCodex] cwd=${runCwd}`);

    const child = spawnCommand('codex', args, runCwd);

    state.runningCodex.set(conversationId, {
        child,
        stdin: child.stdin,
    });

    // Read stdout (JSON events)
    if (child.stdout) {
        const cache = new StreamParseCache();
        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', (line: string) => {
            if (!line.trim()) return;
            try {
                const value = JSON.parse(line);
                const approval = parseCodexEvent(webContents, conversationId, value, cache);
                if (approval) {
                    state.pendingApprovals.set(approval.requestId, {
                        conversationId,
                    });
                }
            } catch {
                webContents.send('codex-stream-token', { cid: conversationId, data: line });
            }
        });
    }

    // Read stderr (progress)
    let stderrAccum = '';
    if (child.stderr) {
        const rl = readline.createInterface({ input: child.stderr });
        rl.on('line', (line: string) => {
            stderrAccum += line + '\n';
            console.error(`[streamCodex:stderr] ${line}`);
            const cleaned = cleanProgressText(line);
            if (cleaned) {
                webContents.send('codex-progress', { cid: conversationId, data: cleaned });
            }
        });
    }

    // Monitor process exit
    child.on('exit', (code) => {
        state.runningCodex.delete(conversationId);

        // Clean up approvals for this conversation
        for (const [key, pending] of state.pendingApprovals) {
            if (pending.conversationId === conversationId) {
                state.pendingApprovals.delete(key);
            }
        }

        if (code === 0 || code === null) {
            webContents.send('codex-stream-end', { cid: conversationId });
        } else {
            const detail = stderrAccum.trim();
            const msg = detail
                ? `Codex exited with code ${code}: ${detail}`
                : `Codex exited with code ${code}`;
            console.error(`[streamCodex] ${msg}`);
            webContents.send('codex-stream-error', {
                cid: conversationId,
                data: msg,
            });
        }
    });

    child.on('error', (err) => {
        state.runningCodex.delete(conversationId);
        webContents.send('codex-stream-error', {
            cid: conversationId,
            data: err.message,
        });
    });
}

// ===== Run Codex Command =====

export function runCodexCommand(
    state: AppState,
    subcommand: string,
    args: string[],
    cwd?: string,
): CommandResult {
    const runCwd = expandTildePath(cwd || state.config.cwd);

    try {
        const { execSync } = require('child_process');
        const opts = commandSpawnOptions(runCwd);
        const result = execSync(`codex ${subcommand} ${args.join(' ')}`, {
            ...opts,
            stdio: ['pipe', 'pipe', 'pipe'],
            maxBuffer: 10 * 1024 * 1024,
        });
        return {
            success: true,
            stdout: result.toString(),
            stderr: '',
            exitCode: 0,
        };
    } catch (err: any) {
        return {
            success: false,
            stdout: err.stdout?.toString() || '',
            stderr: err.stderr?.toString() || '',
            exitCode: err.status ?? -1,
            error: err.message,
        };
    }
}

// ===== Title Bar Overlay =====

export function updateTitleBarOverlay(
    _color: string,
    _symbolColor: string,
): { success: boolean } {
    return { success: true };
}

// ===== Respond to Approval =====

export function respondToApproval(
    requestId: string,
    approved: boolean,
    state: AppState,
): { success: boolean; error?: string } {
    const pending = state.pendingApprovals.get(requestId);
    if (!pending) {
        return { success: false, error: 'Approval request not found' };
    }
    state.pendingApprovals.delete(requestId);

    const process = state.runningCodex.get(pending.conversationId);
    if (!process) {
        return { success: false, error: 'Conversation process not running' };
    }

    if (!process.stdin) {
        return { success: false, error: 'Process stdin is not available' };
    }

    const payload = JSON.stringify({ request_id: requestId, approved });
    try {
        process.stdin.write(payload + '\n');
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

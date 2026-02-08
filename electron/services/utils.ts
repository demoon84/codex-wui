import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ModelInfo, RuntimeConfig } from './models';
import { WebContents } from 'electron';

let counter = 0;

export function nowIso(): string {
    return String(Math.floor(Date.now() / 1000));
}

export function generateId(prefix: string): string {
    counter += 1;
    return `${prefix}_${Date.now()}_${counter}`;
}

export function homeDir(): string | null {
    return os.homedir() || process.env.HOME || process.env.USERPROFILE || null;
}

export function expandTildePath(p: string): string {
    const home = homeDir();
    if (p === '~' && home) return home;
    if ((p.startsWith('~/') || p.startsWith('~\\')) && home) {
        return path.join(home, p.slice(2));
    }
    return p;
}

export function isCommandAvailable(bin: string): boolean {
    try {
        const locator = process.platform === 'win32' ? 'where' : 'which';
        const { execSync } = require('child_process');
        execSync(`${locator} ${bin}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Build spawn options with enriched PATH, matching Rust command_for behavior.
 */
export function commandSpawnOptions(cwd?: string): SpawnOptions {
    const opts: SpawnOptions = { cwd, env: { ...process.env } };

    if (process.platform === 'darwin') {
        const currentPath = process.env.PATH || '';
        const home = homeDir() || '/Users/unknown';

        const extraPaths: string[] = [
            '/opt/homebrew/bin',
            '/opt/homebrew/sbin',
            '/usr/local/bin',
            '/usr/local/sbin',
            '/usr/local/share/npm/bin',
            `${home}/.local/bin`,
            `${home}/.volta/bin`,
            `${home}/.fnm/aliases/default/bin`,
            `${home}/.cargo/bin`,
            `${home}/.bun/bin`,
        ];

        // Scan nvm versions
        const nvmDir = process.env.NVM_DIR || `${home}/.nvm`;
        const nvmVersions = `${nvmDir}/versions/node`;
        try {
            const entries = fs.readdirSync(nvmVersions);
            for (const entry of entries) {
                const binPath = path.join(nvmVersions, entry, 'bin');
                if (fs.existsSync(binPath)) {
                    extraPaths.push(binPath);
                }
            }
        } catch {
            // nvm not installed, ignore
        }

        const defaultBin = `${nvmDir}/alias/default`;
        if (fs.existsSync(defaultBin)) {
            extraPaths.push(defaultBin);
        }

        opts.env!.PATH = [...extraPaths, ...currentPath.split(':')].join(':');
    }

    return opts;
}

/**
 * Spawn a command with enriched PATH.
 */
export function spawnCommand(bin: string, args: string[], cwd?: string) {
    const opts = commandSpawnOptions(cwd);
    return spawn(bin, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
}

export function parseExtraArgs(raw: string): string[] {
    const args: string[] = [];
    let current = '';
    let quote: string | null = null;

    for (const ch of raw) {
        if (quote) {
            if (ch === quote) {
                quote = null;
            } else {
                current += ch;
            }
        } else {
            if (ch === '"' || ch === "'") {
                quote = ch;
            } else if (/\s/.test(ch)) {
                if (current) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += ch;
            }
        }
    }

    if (current) args.push(current);
    return args;
}

export function cleanProgressText(input: string): string {
    const stripped = input.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
    return stripped
        .replace(/\r/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join('\n');
}

export function defaultModels(): ModelInfo[] {
    return [
        { id: 'codex', name: 'GPT-5.3-Codex', description: 'Most capable coding model' },
        { id: 'o3', name: 'O3', description: 'Advanced reasoning model' },
        { id: 'o4-mini', name: 'O4.1-mini', description: 'Fast and efficient' },
        { id: 'gpt-4.1', name: 'GPT-4.1', description: 'General purpose model' },
    ];
}

// ===== Stream Parsing =====

export class StreamParseCache {
    itemTextById: Map<string, string> = new Map();
}

function valueAsObjectText(value: any): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return JSON.stringify(value, null, 2);
}

function extractTextDelta(
    cache: StreamParseCache,
    itemId: string,
    fullText: string,
    isTerminal: boolean,
): string {
    if (!fullText || !itemId) return '';

    const previous = cache.itemTextById.get(itemId) || '';
    const delta = fullText.startsWith(previous) ? fullText.slice(previous.length) : fullText;

    if (isTerminal) {
        cache.itemTextById.delete(itemId);
    } else {
        cache.itemTextById.set(itemId, fullText);
    }

    return delta;
}

export interface ApprovalRequestEvent {
    requestId: string;
    title: string;
    description: string;
}

export function tryExtractApprovalRequest(event: any): ApprovalRequestEvent | null {
    const eventType = (event.type || '').toLowerCase();
    const method = (event.method || '').toLowerCase();
    if (!eventType.includes('approval') && !method.includes('approval')) return null;

    const requestId = event.requestId || event.request_id || event.id || '';
    if (!requestId) return null;

    const title = event.title || event.method || 'Approval requested';
    const description = event.description
        ? valueAsObjectText(event.description)
        : event.params
            ? valueAsObjectText(event.params)
            : valueAsObjectText(event);

    return { requestId, title, description };
}

export function parseCodexEvent(
    webContents: WebContents,
    cid: string,
    event: any,
    cache: StreamParseCache,
): ApprovalRequestEvent | null {
    const approval = tryExtractApprovalRequest(event);
    if (approval) {
        webContents.send('codex-approval-request', {
            cid,
            requestId: approval.requestId,
            title: approval.title,
            description: approval.description,
        });
        return approval;
    }

    const eventType = event.type || '';

    switch (eventType) {
        case 'item.streaming': {
            const item = event.item;
            if (item) {
                const delta = item?.delta?.text || '';
                if (delta) {
                    const itemType = item.type || '';
                    if (itemType === 'reasoning') {
                        const payload = { cid, data: delta };
                        webContents.send('codex-thinking-delta', payload);
                        webContents.send('codex-thinking', payload);
                    } else {
                        webContents.send('codex-stream-delta', { cid, data: delta });
                    }
                }
            }
            break;
        }
        case 'item.started':
        case 'item.updated':
        case 'item.completed': {
            const item = event.item;
            if (item) {
                const itemType = (item.type || '').toLowerCase();
                const itemId = item.id || '';
                const terminal = eventType === 'item.completed';

                if (itemType === 'reasoning') {
                    const text = item.text || '';
                    const delta = extractTextDelta(cache, itemId, text, terminal);
                    if (delta) {
                        const payload = { cid, data: delta };
                        webContents.send('codex-thinking-delta', payload);
                        webContents.send('codex-thinking', payload);
                    }
                } else if (itemType === 'agent_message' || itemType === 'message') {
                    const text = item.text || '';
                    const delta = extractTextDelta(cache, itemId, text, terminal);
                    if (delta) {
                        webContents.send('codex-stream-delta', { cid, data: delta });
                    }
                } else if (itemType === 'command_execution') {
                    const command = item.command || 'command';
                    const output = item.aggregated_output || '';
                    const status = (item.status || 'in_progress').toLowerCase();
                    const exitCode =
                        status === 'completed' || status === 'failed' || status === 'declined'
                            ? item.exit_code ?? -1
                            : null;
                    const terminalId = itemId || `${cid}-command`;

                    webContents.send('codex-terminal-output', {
                        cid,
                        terminalId,
                        output,
                        exitCode,
                    });

                    const toolStatus =
                        status === 'completed' ? 'done' : status === 'failed' || status === 'declined' ? 'error' : 'running';
                    webContents.send('codex-tool-call', { cid, title: command, status: toolStatus, output });
                } else if (itemType === 'mcp_tool_call') {
                    const server = item.server || 'mcp';
                    const tool = item.tool || 'tool';
                    const status = (item.status || 'in_progress').toLowerCase();
                    const output = valueAsObjectText(item.result || item.error || '');
                    const toolStatus =
                        status === 'completed' ? 'done' : status === 'failed' ? 'error' : 'running';
                    webContents.send('codex-tool-call', {
                        cid,
                        title: `${server}:${tool}`,
                        status: toolStatus,
                        output,
                    });
                } else if (itemType === 'file_change') {
                    const status = (item.status || 'in_progress').toLowerCase();
                    const changes = item.changes || null;
                    const toolStatus =
                        status === 'completed' ? 'done' : status === 'failed' ? 'error' : 'running';
                    webContents.send('codex-tool-call', {
                        cid,
                        title: 'file_change',
                        status: toolStatus,
                        output: valueAsObjectText(changes),
                    });
                }
            }
            break;
        }
        case 'turn.failed': {
            const msg =
                event.error?.message || event.error?.error || 'Turn failed';
            webContents.send('codex-stream-error', { cid, data: msg });
            break;
        }
        case 'error': {
            const msg = event.message || 'Unknown error';
            webContents.send('codex-stream-error', { cid, data: msg });
            break;
        }
    }

    return null;
}

export function buildCodexExecArgs(
    prompt: string,
    cfg: RuntimeConfig,
    history?: Array<{ role: string; content: string }>,
): [string, string, string[]] {
    let fullPrompt = prompt;
    if (history && history.length > 0) {
        const recent = history.slice(-10);
        const lines = recent.map((msg) => {
            const prefix = msg.role === 'assistant' ? 'Assistant' : 'User';
            return `${prefix}: ${msg.content}`;
        });
        fullPrompt = `[Previous conversation]\n${lines.join('\n')}\n\n[Current question]\n${prompt}`;
    }

    const requestedCwd = cfg.cliOptions.cwdOverride.trim() || cfg.cwd;
    const runCwd = expandTildePath(requestedCwd);

    const args: string[] = ['exec', '--json'];

    if (cfg.model) {
        args.push('-m', cfg.model);
    }

    if (cfg.cliOptions.profile.trim()) {
        args.push('-p', cfg.cliOptions.profile.trim());
    }

    if (cfg.yoloMode) {
        args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
        const sandboxMap: Record<string, string> = {
            'read-only': 'read-only',
            'danger-full-access': 'danger-full-access',
        };
        const sandbox = sandboxMap[cfg.cliOptions.sandbox] || 'workspace-write';
        args.push('-s', sandbox);

        const approvalMap: Record<string, string> = {
            untrusted: 'untrusted',
            'on-failure': 'on-failure',
            never: 'never',
        };
        const approvalPolicy = approvalMap[cfg.cliOptions.askForApproval] || 'on-request';
        args.push('--config', `approval_policy="${approvalPolicy}"`);
    }

    // Note: web search is not yet supported by codex CLI v0.98.0
    // if (cfg.cliOptions.enableWebSearch) {
    //     args.push('--enable', 'web-search');
    // }

    args.push('-C', runCwd);

    if (cfg.cliOptions.skipGitRepoCheck) {
        args.push('--skip-git-repo-check');
    }

    args.push(...parseExtraArgs(cfg.cliOptions.extraArgs));
    args.push(fullPrompt);

    return [fullPrompt, runCwd, args];
}

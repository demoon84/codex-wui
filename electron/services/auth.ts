import * as fs from 'fs';
import * as path from 'path';
import { CodexUser } from './models';
import { commandSpawnOptions, homeDir, spawnCommand } from './utils';

function codexAuthPath(): string | null {
    const home = homeDir();
    if (!home) return null;
    return path.join(home, '.codex', 'auth.json');
}

function parseJwtPayload(token: string): any | null {
    try {
        const payload = token.split('.')[1];
        if (!payload) return null;
        // Handle URL-safe base64
        const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = Buffer.from(padded, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

function parseCodexUser(auth: any): CodexUser | null {
    const authMode = auth.auth_mode || 'unknown';
    const accountId = auth.tokens?.account_id || 'codex-user';

    let email = '';
    let authProvider = '';

    const idToken = auth.tokens?.id_token;
    if (idToken) {
        const payload = parseJwtPayload(idToken);
        if (payload) {
            email = payload.email || '';
            authProvider = payload.auth_provider || '';
        }
    }

    if (authMode === 'api_key') {
        authProvider = 'api_key';
    }

    const name = email ? email.split('@')[0] || 'codex-user' : `codex-${authMode}`;

    return {
        id: accountId,
        email,
        name,
        picture: '',
        authMode,
        authProvider,
    };
}

export function checkCachedCredentials(): CodexUser | null {
    const authPath = codexAuthPath();
    if (!authPath || !fs.existsSync(authPath)) return null;

    try {
        const content = fs.readFileSync(authPath, 'utf-8');
        const value = JSON.parse(content);
        return parseCodexUser(value);
    } catch {
        return null;
    }
}

export function codexLogin(
    method?: string,
    apiKey?: string,
): Promise<{ success: boolean; user?: CodexUser; error?: string }> {
    const cached = checkCachedCredentials();
    if (cached) {
        return Promise.resolve({ success: true, user: cached });
    }

    const chosen = (method || 'browser').toLowerCase();

    if (chosen === 'api-key') {
        const trimmed = (apiKey || '').trim();
        if (!trimmed) {
            return Promise.resolve({
                success: false,
                error: 'API key login requires a non-empty apiKey value',
            });
        }
    }

    return new Promise((resolve) => {
        const args = ['login'];
        if (chosen === 'device-auth') {
            args.push('--device-auth');
        } else if (chosen === 'api-key') {
            args.push('--with-api-key');
        }

        const child = spawnCommand('codex', args);

        if (chosen === 'api-key' && child.stdin) {
            const key = (apiKey || '').trim();
            child.stdin.write(key + '\n');
            try { child.stdin.end(); } catch { }
        }

        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', (data) => { stdout += data.toString(); });
        }
        if (child.stderr) {
            child.stderr.on('data', (data) => { stderr += data.toString(); });
        }

        child.on('exit', (code) => {
            if (code === 0) {
                const user = checkCachedCredentials();
                resolve({ success: true, user: user || undefined });
            } else {
                resolve({
                    success: false,
                    error: stderr || stdout || `Login failed with exit code ${code}`,
                });
            }
        });

        child.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
}

export function codexLogout(): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
        const child = spawnCommand('codex', ['logout']);

        child.on('exit', (code) => {
            if (code === 0) {
                resolve({ success: true });
            } else {
                resolve({
                    success: false,
                    error: `codex logout failed with exit code ${code}`,
                });
            }
        });

        child.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
}

export function getUser(): CodexUser | null {
    return checkCachedCredentials();
}

export function codexLoginMethods(): {
    methods: Array<{ id: string; label: string }>;
} {
    return {
        methods: [
            { id: 'browser', label: 'Browser OAuth' },
            { id: 'device-auth', label: 'Device Auth' },
            { id: 'api-key', label: 'API Key' },
        ],
    };
}

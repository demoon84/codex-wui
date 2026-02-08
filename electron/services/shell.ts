import { ChildProcess, spawn } from 'child_process';
import { WebContents } from 'electron';
import { AppState, ShellCommandResult } from './models';
import { commandSpawnOptions, expandTildePath, generateId } from './utils';

export function runCommand(
    webContents: WebContents,
    command: string,
    cwd: string,
    state: AppState,
): ShellCommandResult {
    const commandId = generateId('cmd');
    const runCwd = expandTildePath(cwd.trim() || state.config.cwd);

    try {
        const { execSync } = require('child_process');
        const opts = commandSpawnOptions(runCwd);
        const result = execSync(command, {
            ...opts,
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            maxBuffer: 10 * 1024 * 1024,
        });

        const stdout = result.toString();
        if (stdout) {
            webContents.send('command-output', { commandId, type: 'stdout', data: stdout });
        }

        return {
            success: true,
            commandId,
            output: stdout,
            exitCode: 0,
        };
    } catch (err: any) {
        const stdout = err.stdout?.toString() || '';
        const stderr = err.stderr?.toString() || '';

        if (stdout) {
            webContents.send('command-output', { commandId, type: 'stdout', data: stdout });
        }
        if (stderr) {
            webContents.send('command-output', { commandId, type: 'stderr', data: stderr });
        }

        return {
            success: false,
            commandId,
            output: stdout,
            errorOutput: stderr,
            exitCode: err.status ?? -1,
            error: err.message,
        };
    }
}

export function killCommand(_commandId: string): { success: boolean; error?: string } {
    return { success: false, error: 'Not supported in current runtime' };
}

// ===== PTY Terminals =====

export function ptyCreate(
    webContents: WebContents,
    state: AppState,
    cwd?: string,
    shell?: string,
): { id: string; shell: string } {
    const id = generateId('pty');
    const shellPath = shell || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
    const runCwd = expandTildePath(cwd || state.config.cwd);
    const opts = commandSpawnOptions(runCwd);

    const child = spawn(shellPath, [], {
        ...opts,
        cwd: runCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    state.ptyTerminals.set(id, child);

    if (child.stdout) {
        child.stdout.on('data', (data: Buffer) => {
            webContents.send('pty-data', { id, data: data.toString() });
        });
    }

    if (child.stderr) {
        child.stderr.on('data', (data: Buffer) => {
            webContents.send('pty-data', { id, data: data.toString() });
        });
    }

    child.on('exit', (code) => {
        state.ptyTerminals.delete(id);
        webContents.send('pty-exit', { id, exitCode: code ?? -1 });
    });

    return { id, shell: shellPath };
}

export function ptyWrite(
    state: AppState,
    id: string,
    data: string,
): { success: boolean; error?: string } {
    const child = state.ptyTerminals.get(id);
    if (!child) return { success: false, error: 'Terminal not found' };

    try {
        if (child.stdin && !child.stdin.destroyed) {
            child.stdin.write(data);
            return { success: true };
        }
        return { success: false, error: 'Failed to write to terminal' };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export function ptyKill(
    state: AppState,
    id: string,
): { success: boolean; error?: string } {
    const child = state.ptyTerminals.get(id);
    if (!child) return { success: false, error: 'Terminal not found' };

    state.ptyTerminals.delete(id);
    try {
        child.kill();
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export function ptyList(state: AppState): string[] {
    return Array.from(state.ptyTerminals.keys());
}

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { DirectoryEntry, FileSearchResult, SearchResult } from './models';
import { expandTildePath } from './utils';

function canonicalizeWorkspaceRoot(workspacePath?: string): string {
    if (!workspacePath) throw new Error('workspacePath is required');
    const workspace = expandTildePath(workspacePath);
    const canonical = fs.realpathSync(workspace);
    if (!fs.statSync(canonical).isDirectory()) {
        throw new Error('workspacePath is not a directory');
    }
    return canonical;
}

function resolveWorkspaceScopedPath(rawPath: string, workspacePath?: string): string {
    const workspaceRoot = canonicalizeWorkspaceRoot(workspacePath);
    const target = path.isAbsolute(rawPath) ? rawPath : path.join(workspaceRoot, rawPath);

    let normalized: string;
    if (fs.existsSync(target)) {
        normalized = fs.realpathSync(target);
    } else {
        const parent = path.dirname(target);
        if (!fs.existsSync(parent)) throw new Error('Target parent directory does not exist');
        const canonicalParent = fs.realpathSync(parent);
        normalized = path.join(canonicalParent, path.basename(target));
    }

    if (!normalized.startsWith(workspaceRoot)) {
        throw new Error('Path is outside workspace root');
    }

    return normalized;
}

const IGNORE_DIRS = [
    'node_modules', '.git', 'dist', 'dist-electron', '.next',
    '.vite', 'coverage', '__pycache__', '.cache',
];

function walkFiles(
    dir: string,
    base: string,
    depth: number,
    maxDepth: number,
    out: FileSearchResult[],
): void {
    if (depth > maxDepth) return;

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(base, fullPath);

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.includes(entry.name) || entry.name.startsWith('.')) continue;
            out.push({ name: entry.name, path: fullPath, relativePath: rel, isDirectory: true });
            walkFiles(fullPath, base, depth + 1, maxDepth, out);
        } else {
            out.push({ name: entry.name, path: fullPath, relativePath: rel, isDirectory: false });
        }
    }
}

export function searchFiles(workspacePath: string, query: string): FileSearchResult[] {
    const base = expandTildePath(workspacePath);
    const allFiles: FileSearchResult[] = [];
    walkFiles(base, base, 0, 4, allFiles);

    const q = query.toLowerCase();
    let filtered = allFiles.filter(
        (f) => f.relativePath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q),
    );

    filtered.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return b.isDirectory ? 1 : -1;
        const aExact = a.name.toLowerCase() === q;
        const bExact = b.name.toLowerCase() === q;
        if (aExact !== bExact) return bExact ? 1 : -1;
        return a.relativePath.length - b.relativePath.length;
    });

    return filtered.slice(0, 20);
}

export function readFileContent(
    filePath: string,
    workspacePath?: string,
): { success: boolean; content?: string; error?: string } {
    try {
        const resolved = resolveWorkspaceScopedPath(filePath, workspacePath);
        const content = fs.readFileSync(resolved, 'utf-8');
        return { success: true, content };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export function writeFile(
    filePath: string,
    content: string,
    workspacePath?: string,
): { success: boolean; error?: string } {
    try {
        const resolved = resolveWorkspaceScopedPath(filePath, workspacePath);
        fs.writeFileSync(resolved, content);
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export function listDirectory(
    dirPath: string,
    workspacePath?: string,
): { success: boolean; entries?: DirectoryEntry[]; error?: string } {
    try {
        const resolved = resolveWorkspaceScopedPath(dirPath, workspacePath);
        const entries = fs.readdirSync(resolved, { withFileTypes: true }).map((entry) => {
            const fullPath = path.join(resolved, entry.name);
            let size = 0;
            try {
                size = fs.statSync(fullPath).size;
            } catch { }
            return {
                name: entry.name,
                path: fullPath,
                isDirectory: entry.isDirectory(),
                size,
            };
        });
        return { success: true, entries };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

export function fileExists(filePath: string, workspacePath?: string): boolean {
    try {
        const resolved = resolveWorkspaceScopedPath(filePath, workspacePath);
        return fs.existsSync(resolved);
    } catch {
        return false;
    }
}

export async function webSearch(
    query: string,
): Promise<{ success: boolean; results: SearchResult[]; error?: string }> {
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
        const response = await fetch(url);
        const data = await response.json();

        const results: SearchResult[] = [];

        const abs = data.Abstract;
        if (abs) {
            results.push({
                title: data.Heading || query,
                url: data.AbstractURL || '',
                snippet: abs,
            });
        }

        if (Array.isArray(data.RelatedTopics)) {
            for (const topic of data.RelatedTopics.slice(0, 5)) {
                if (topic.Text && topic.FirstURL) {
                    results.push({
                        title: topic.Text.split(' - ')[0] || topic.Text,
                        url: topic.FirstURL,
                        snippet: topic.Text,
                    });
                }
            }
        }

        return { success: true, results };
    } catch (err: any) {
        return { success: false, results: [], error: err.message };
    }
}

export function openInEditor(
    filePath: string,
    editor?: string,
): { success: boolean; editor?: string; error?: string } {
    const expandedPath = expandTildePath(filePath);
    if (!fs.existsSync(expandedPath)) {
        return { success: false, error: 'File does not exist' };
    }

    const editorsToTry = editor ? [editor] : ['code', 'cursor'];

    for (const ed of editorsToTry) {
        try {
            spawn(ed, [expandedPath], { detached: true, stdio: 'ignore' }).unref();
            return { success: true, editor: ed };
        } catch { }
    }

    // Fallback: system open
    try {
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : 'start';
        spawn(openCmd, [expandedPath], { detached: true, stdio: 'ignore' }).unref();
        return { success: true, editor: 'system' };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
}

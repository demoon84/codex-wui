/**
 * Automated backend service verification script.
 * Run: npx ts-node --project tsconfig.electron.json electron/test-services.ts
 * Or:  node dist-electron/test-services.js  (after tsc compile)
 *
 * This tests each migrated service WITHOUT the Electron window or browser.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ===== Test Utilities =====
let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, label: string) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${label}`);
    } else {
        failed++;
        errors.push(label);
        console.log(`  ❌ ${label}`);
    }
}

function section(name: string) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`  📦 ${name}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

// ===== 1. Models =====
section('models.ts — Type Definitions');
import { AppState, RuntimeConfig, CliOptions } from './services/models';

const testConfig: RuntimeConfig = {
    mode: 'fast',
    yoloMode: false,
    model: '',
    cwd: process.cwd(),
    cliOptions: {
        profile: '',
        sandbox: 'workspace-write',
        askForApproval: 'on-request',
        skipGitRepoCheck: true,
        cwdOverride: '',
        extraArgs: '',
        enableWebSearch: false,
    },
};
assert(testConfig.mode === 'fast', 'RuntimeConfig creation');
assert(testConfig.cliOptions.sandbox === 'workspace-write', 'CliOptions defaults');

// ===== 2. Utils =====
section('utils.ts — Utility Functions');
import {
    homeDir,
    expandTildePath,
    commandSpawnOptions,
    parseExtraArgs,
    cleanProgressText,
    defaultModels,
    buildCodexExecArgs,
    StreamParseCache,
    generateId,
    nowIso,
} from './services/utils';

assert(typeof homeDir() === 'string' && homeDir()!.length > 0, 'homeDir() returns path');
assert(expandTildePath('~/test') === path.join(homeDir()!, 'test'), 'expandTildePath("~/test")');
assert(expandTildePath('/abs/path') === '/abs/path', 'expandTildePath preserves absolute');
assert(expandTildePath('~') === homeDir(), 'expandTildePath("~") => home');

const spawnOpts = commandSpawnOptions('/tmp');
assert(spawnOpts.cwd === '/tmp', 'commandSpawnOptions sets cwd');
assert(typeof spawnOpts.env?.PATH === 'string', 'commandSpawnOptions enriches PATH');
if (process.platform === 'darwin') {
    assert(spawnOpts.env!.PATH!.includes('/opt/homebrew/bin'), 'PATH includes /opt/homebrew/bin');
    assert(spawnOpts.env!.PATH!.includes('.cargo/bin'), 'PATH includes .cargo/bin');
}

assert(JSON.stringify(parseExtraArgs('--foo bar')) === '["--foo","bar"]', 'parseExtraArgs simple');
assert(JSON.stringify(parseExtraArgs('"hello world" --x')) === '["hello world","--x"]', 'parseExtraArgs quoted');
assert(parseExtraArgs('').length === 0, 'parseExtraArgs empty');

assert(cleanProgressText('\x1B[32m progress \x1B[0m') === 'progress', 'cleanProgressText strips ANSI');
assert(cleanProgressText('') === '', 'cleanProgressText empty');

const models = defaultModels();
assert(models.length > 0, 'defaultModels returns non-empty');
assert(models[0].id === 'codex', 'defaultModels first is codex');

const id1 = generateId('test');
const id2 = generateId('test');
assert(id1 !== id2, 'generateId produces unique IDs');
assert(id1.startsWith('test_'), 'generateId has correct prefix');

assert(typeof nowIso() === 'string', 'nowIso returns string');

// buildCodexExecArgs
const [prompt, cwd, args] = buildCodexExecArgs('hello', testConfig);
assert(prompt === 'hello', 'buildCodexExecArgs prompt');
assert(args.includes('exec'), 'buildCodexExecArgs includes exec');
assert(args.includes('--json'), 'buildCodexExecArgs includes --json');
assert(!args.includes('-m'), 'buildCodexExecArgs no -m when model empty');
assert(args.includes('-s'), 'buildCodexExecArgs includes -s');
assert(args.includes('--skip-git-repo-check'), 'buildCodexExecArgs includes skip-git-repo-check');
assert(args[args.length - 1] === 'hello', 'buildCodexExecArgs prompt is last arg');

// With model set
const configWithModel = { ...testConfig, model: 'o4-mini' };
const [, , argsWithModel] = buildCodexExecArgs('test', configWithModel);
assert(argsWithModel.includes('-m'), 'buildCodexExecArgs includes -m with model');
assert(argsWithModel[argsWithModel.indexOf('-m') + 1] === 'o4-mini', 'buildCodexExecArgs correct model');

// With yolo mode 
const yoloConfig = { ...testConfig, yoloMode: true };
const [, , yoloArgs] = buildCodexExecArgs('test', yoloConfig);
assert(yoloArgs.includes('--dangerously-bypass-approvals-and-sandbox'), 'buildCodexExecArgs yolo mode');
assert(!yoloArgs.includes('-s'), 'buildCodexExecArgs no sandbox in yolo mode');

// With conversation history
const [histPrompt] = buildCodexExecArgs('question', testConfig, [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
]);
assert(histPrompt.includes('[Previous conversation]'), 'buildCodexExecArgs includes history');
assert(histPrompt.includes('[Current question]'), 'buildCodexExecArgs includes current question');

// StreamParseCache
const cache = new StreamParseCache();
assert(cache.itemTextById.size === 0, 'StreamParseCache initializes empty');

// ===== 3. Database =====
section('db.ts — SQLite Database');
import { openDatabase, dbGetState, dbCreateWorkspace, dbDeleteWorkspace, dbCreateConversation, dbUpdateConversationTitle, dbDeleteConversation, dbCreateMessage, dbGetMessages, dbGetConversations } from './services/db';
import Database from 'better-sqlite3';

// Use a temp DB for testing
const testDbPath = path.join(os.tmpdir(), `codex-test-${Date.now()}.sqlite3`);
const testDb = new Database(testDbPath);

// Initialize schema manually
testDb.pragma('foreign_keys = ON');
testDb.pragma('journal_mode = WAL');
testDb.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, thinking TEXT, thinking_duration INTEGER, timestamp TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
`);

// Test workspace CRUD
const ws = dbCreateWorkspace(testDb, 'ws-1', 'Test Workspace', '/tmp/test');
assert(ws.id === 'ws-1', 'dbCreateWorkspace returns workspace');
assert(ws.name === 'Test Workspace', 'dbCreateWorkspace correct name');

const ws2 = dbCreateWorkspace(testDb, 'ws-2', 'Workspace 2', '/tmp/test2');
assert(ws2.id === 'ws-2', 'dbCreateWorkspace second workspace');

// Test conversation CRUD
const conv = dbCreateConversation(testDb, 'conv-1', 'ws-1', 'Chat 1');
assert(conv.id === 'conv-1', 'dbCreateConversation returns conversation');

const conv2 = dbCreateConversation(testDb, 'conv-2', 'ws-1', 'Chat 2');

const conversations = dbGetConversations(testDb, 'ws-1');
assert(conversations.length === 2, 'dbGetConversations returns 2');

dbUpdateConversationTitle(testDb, 'conv-1', 'Updated Chat 1');
const updatedConvs = dbGetConversations(testDb, 'ws-1');
const updatedConv = updatedConvs.find((c: any) => c.id === 'conv-1');
assert(updatedConv?.title === 'Updated Chat 1', 'dbUpdateConversationTitle works');

// Test message CRUD
dbCreateMessage(testDb, {
    id: 'msg-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'Hello world',
    timestamp: new Date().toISOString(),
});
dbCreateMessage(testDb, {
    id: 'msg-2',
    conversationId: 'conv-1',
    role: 'assistant',
    content: 'Hi there!',
    thinking: 'Thinking about greeting...',
    thinkingDuration: 2,
    timestamp: new Date().toISOString(),
});

const msgs = dbGetMessages(testDb, 'conv-1');
assert(msgs.length === 2, 'dbGetMessages returns 2 messages');
assert(msgs[0].role === 'user', 'first message is user');
assert(msgs[1].thinking === 'Thinking about greeting...', 'thinking field preserved');
assert(msgs[1].thinkingDuration === 2, 'thinkingDuration preserved');

// Test getState
const state = dbGetState(testDb);
assert(state.workspaces.length === 2, 'dbGetState returns 2 workspaces');
const wsWithConvs = state.workspaces.find((w: any) => w.id === 'ws-1');
assert(wsWithConvs?.conversations.length === 2, 'workspace has 2 conversations');

// Test cascade delete
dbDeleteConversation(testDb, 'conv-2');
const afterDeleteConvs = dbGetConversations(testDb, 'ws-1');
assert(afterDeleteConvs.length === 1, 'dbDeleteConversation removed conversation');

dbDeleteWorkspace(testDb, 'ws-2');
const afterDeleteState = dbGetState(testDb);
assert(afterDeleteState.workspaces.length === 1, 'dbDeleteWorkspace removed workspace');

// Cleanup test DB
testDb.close();
fs.unlinkSync(testDbPath);
assert(!fs.existsSync(testDbPath), 'Test DB cleaned up');

// Test openDatabase (uses real path)
const realDb = openDatabase();
assert(realDb !== null, 'openDatabase() succeeds');
realDb.close();

// ===== 4. FS Ops =====
section('fs-ops.ts — File System Operations');
import { searchFiles, readFileContent, writeFile, listDirectory, fileExists, openInEditor } from './services/fs-ops';

const testDir = path.join(os.tmpdir(), `codex-fstest-${Date.now()}`);
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(path.join(testDir, 'test.txt'), 'Hello World');
fs.writeFileSync(path.join(testDir, 'readme.md'), '# Test');
fs.mkdirSync(path.join(testDir, 'subdir'));
fs.writeFileSync(path.join(testDir, 'subdir', 'nested.ts'), 'export const x = 1;');

// searchFiles
const searchResults = searchFiles(testDir, 'test');
assert(searchResults.length >= 1, 'searchFiles finds files');
assert(searchResults.some((r: any) => r.name === 'test.txt'), 'searchFiles finds test.txt');

// readFileContent
const readResult = readFileContent(path.join(testDir, 'test.txt'), testDir);
assert(readResult.success === true, 'readFileContent succeeds');
assert(readResult.content === 'Hello World', 'readFileContent reads correct content');

// writeFile
const writeResult = writeFile(path.join(testDir, 'new.txt'), 'New Content', testDir);
assert(writeResult.success === true, 'writeFile succeeds');
assert(fs.readFileSync(path.join(testDir, 'new.txt'), 'utf-8') === 'New Content', 'writeFile writes correct content');

// listDirectory
const dirResult = listDirectory(testDir, testDir);
assert(dirResult.success === true, 'listDirectory succeeds');
assert(dirResult.entries!.length >= 3, 'listDirectory returns entries');
assert(dirResult.entries!.some((e: any) => e.name === 'subdir' && e.isDirectory), 'listDirectory finds subdir');
assert(dirResult.entries!.some((e: any) => e.name === 'test.txt' && !e.isDirectory), 'listDirectory finds file');

// fileExists
assert(fileExists(path.join(testDir, 'test.txt'), testDir) === true, 'fileExists returns true for existing');
assert(fileExists(path.join(testDir, 'nonexistent.txt'), testDir) === false, 'fileExists returns false for missing');

// Cleanup
fs.rmSync(testDir, { recursive: true });

// ===== 5. Auth =====
section('auth.ts — Authentication');
import { codexLoginMethods, getUser } from './services/auth';

const loginMethods = codexLoginMethods();
assert(Array.isArray(loginMethods), 'codexLoginMethods returns array');

// getUser — may return null if not logged in, but should not throw
try {
    const user = getUser();
    assert(true, `getUser() returns ${user ? user.email : 'null'} (no crash)`);
} catch (e) {
    assert(false, `getUser() threw: ${e}`);
}

// ===== 6. Shell =====
section('shell.ts — Command Execution');
import { runCommand, killCommand } from './services/shell';

// Fake webContents for testing
const fakeWebContents = {
    send: (_channel: string, _data: any) => { },
} as any;

const shellTestState: AppState = {
    config: { ...testConfig },
    db: null as any,
    runningCodex: new Map(),
    pendingApprovals: new Map(),
    ptyTerminals: new Map(),
};

const cmdResult = runCommand(fakeWebContents, 'echo "hello from shell test"', process.cwd(), shellTestState);
assert(cmdResult.success === true, 'runCommand succeeds');
assert(typeof cmdResult.commandId === 'string', 'runCommand returns commandId');

// killCommand for non-existent — should not throw
const killResult = killCommand('nonexistent-id');
assert(killResult.success === false || killResult.success === true, 'killCommand handles missing id');

// ===== 7. Teams =====
section('teams.ts — MS Teams Integration');
import { sendToTeams } from './services/teams';

// Test with invalid URL (should fail gracefully)
sendToTeams('http://invalid-webhook-url.test', 'Test', 'Content')
    .then((teamsResult) => {
        // Won't reach this during sync test
    })
    .catch(() => { });
assert(true, 'sendToTeams called without crash');

// ===== 8. Codex Service =====
section('codex.ts — Codex CLI Integration');
import { setMode, getMode, setYoloMode, getYoloMode, getModels, setModel, getModel, setCliOptions, getCliOptions, checkCodex, initAcp, switchWorkspace, debugLog, updateTitleBarOverlay } from './services/codex';

const testState: AppState = {
    config: { ...testConfig },
    db: openDatabase(),
    runningCodex: new Map(),
    pendingApprovals: new Map(),
    ptyTerminals: new Map(),
};

// Mode
assert(setMode(testState, 'planning') === 'planning', 'setMode returns new mode');
assert(getMode(testState) === 'planning', 'getMode returns correct mode');

// Yolo
assert(setYoloMode(testState, true) === true, 'setYoloMode returns true');
assert(getYoloMode(testState) === true, 'getYoloMode returns true');
setYoloMode(testState, false);
assert(getYoloMode(testState) === false, 'setYoloMode/getYoloMode round trip');

// Models
const codexModels = getModels();
assert(codexModels.length > 0, 'getModels returns models');

assert(setModel(testState, 'o4-mini') === 'o4-mini', 'setModel works');
assert(getModel(testState) === 'o4-mini', 'getModel returns set model');

// CLI Options
const newOpts = setCliOptions(testState, { profile: 'test-profile', enableWebSearch: true });
assert(newOpts.profile === 'test-profile', 'setCliOptions merges profile');
assert(newOpts.enableWebSearch === true, 'setCliOptions merges enableWebSearch');
assert(newOpts.sandbox === 'workspace-write', 'setCliOptions preserves sandbox');

const retrievedOpts = getCliOptions(testState);
assert(retrievedOpts.profile === 'test-profile', 'getCliOptions returns merged options');

// Check codex
const codexCheck = checkCodex();
assert(typeof codexCheck.installed === 'boolean', 'checkCodex returns { installed: boolean }');
if (codexCheck.installed) {
    console.log('    ℹ️  Codex CLI is installed');
} else {
    console.log('    ℹ️  Codex CLI is NOT installed');
}

// initAcp
const acpResult = initAcp(fakeWebContents);
assert(acpResult.success === true, 'initAcp returns success');

// switchWorkspace
const switchResult = switchWorkspace(testState, 'ws-test', '/tmp/test-workspace');
assert(switchResult.success === true, 'switchWorkspace returns success');
assert(testState.config.cwd === '/tmp/test-workspace', 'switchWorkspace updates cwd');

// debugLog (should not throw)
debugLog('test message');
assert(true, 'debugLog does not throw');

// updateTitleBarOverlay
const overlayResult = updateTitleBarOverlay('#000', '#fff');
assert(overlayResult.success === true, 'updateTitleBarOverlay returns success');

// Cleanup
testState.db.close();

// ===== SUMMARY =====
console.log(`\n${'═'.repeat(50)}`);
console.log(`  🏁 VERIFICATION COMPLETE`);
console.log(`${'═'.repeat(50)}`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}`);
if (errors.length > 0) {
    console.log(`\n  Failed tests:`);
    errors.forEach(e => console.log(`    - ${e}`));
}
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);

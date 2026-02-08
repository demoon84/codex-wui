import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as path from 'path';
import { AppState } from './services/models';
import { openDatabase } from './services/db';
import * as codex from './services/codex';
import * as db from './services/db';
import * as fsOps from './services/fs-ops';
import * as auth from './services/auth';
import * as shell from './services/shell';
import * as teams from './services/teams';

let mainWindow: BrowserWindow | null = null;
let appState: AppState;

function createAppState(): AppState {
    const database = openDatabase();
    return {
        config: {
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
        },
        db: database,
        runningCodex: new Map(),
        pendingApprovals: new Map(),
        ptyTerminals: new Map(),
    };
}

function createWindow() {
    mainWindow = new BrowserWindow({
        title: 'Codex UI',
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 12, y: 12 },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // In development, load from Vite dev server
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
        // In production, load from built files
        mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function getWebContents() {
    return mainWindow!.webContents;
}

function registerIpcHandlers() {
    // ===== Codex: Mode / Model / Config =====
    ipcMain.handle('set-mode', (_e, mode) => codex.setMode(appState, mode));
    ipcMain.handle('get-mode', () => codex.getMode(appState));
    ipcMain.handle('set-yolo-mode', (_e, enabled) => codex.setYoloMode(appState, enabled));
    ipcMain.handle('get-yolo-mode', () => codex.getYoloMode(appState));
    ipcMain.handle('get-models', () => codex.getModels());
    ipcMain.handle('get-model', () => codex.getModel(appState));
    ipcMain.handle('set-model', (_e, modelId) => codex.setModel(appState, modelId));
    ipcMain.handle('set-cli-options', (_e, options) => codex.setCliOptions(appState, options));
    ipcMain.handle('get-cli-options', () => codex.getCliOptions(appState));

    // ===== Codex: ACP / Workspace =====
    ipcMain.handle('init-acp', () => codex.initAcp(getWebContents()));
    ipcMain.handle('switch-workspace', (_e, workspaceId, cwd) =>
        codex.switchWorkspace(appState, workspaceId, cwd),
    );
    ipcMain.handle('debug-log', (_e, msg) => codex.debugLog(msg));

    // ===== Codex: Check / Install =====
    ipcMain.handle('check-codex', () => codex.checkCodex());
    ipcMain.handle('install-codex', () => codex.installCodex(getWebContents()));

    // ===== Codex: Workspace =====
    ipcMain.handle('open-workspace', () => codex.openWorkspace());

    // ===== Codex: Stream / Cancel =====
    ipcMain.handle('stream-codex', (_e, conversationId, prompt, conversationHistory) =>
        codex.streamCodex(getWebContents(), conversationId, prompt, conversationHistory, appState),
    );
    ipcMain.handle('cancel-prompt', (_e, conversationId) =>
        codex.cancelPrompt(getWebContents(), conversationId, appState),
    );
    ipcMain.handle('run-codex-command', (_e, subcommand, args, cwd) =>
        codex.runCodexCommand(appState, subcommand, args, cwd),
    );
    ipcMain.handle('update-title-bar-overlay', (_e, color, symbolColor) =>
        codex.updateTitleBarOverlay(color, symbolColor),
    );
    ipcMain.handle('respond-to-approval', (_e, requestId, approved) =>
        codex.respondToApproval(requestId, approved, appState),
    );

    // ===== Auth =====
    ipcMain.handle('codex-login', (_e, method, apiKey) => auth.codexLogin(method, apiKey));
    ipcMain.handle('codex-logout', () => auth.codexLogout());
    ipcMain.handle('codex-login-methods', () => auth.codexLoginMethods());
    ipcMain.handle('get-user', () => auth.getUser());

    // ===== File System =====
    ipcMain.handle('search-files', (_e, workspacePath, query) =>
        fsOps.searchFiles(workspacePath, query),
    );
    ipcMain.handle('read-file-content', (_e, filePath, workspacePath) =>
        fsOps.readFileContent(filePath, workspacePath),
    );
    ipcMain.handle('write-file', (_e, filePath, content, workspacePath) =>
        fsOps.writeFile(filePath, content, workspacePath),
    );
    ipcMain.handle('list-directory', (_e, dirPath, workspacePath) =>
        fsOps.listDirectory(dirPath, workspacePath),
    );
    ipcMain.handle('file-exists', (_e, filePath, workspacePath) =>
        fsOps.fileExists(filePath, workspacePath),
    );
    ipcMain.handle('open-in-editor', (_e, filePath, editor) =>
        fsOps.openInEditor(filePath, editor),
    );

    // ===== Web Search =====
    ipcMain.handle('web-search', (_e, query) => fsOps.webSearch(query));

    // ===== Shell =====
    ipcMain.handle('run-command', (_e, command, cwd) =>
        shell.runCommand(getWebContents(), command, cwd, appState),
    );
    ipcMain.handle('kill-command', (_e, commandId) => shell.killCommand(commandId));

    // ===== PTY =====
    ipcMain.handle('pty-create', (_e, cwd, shellPath) =>
        shell.ptyCreate(getWebContents(), appState, cwd, shellPath),
    );
    ipcMain.handle('pty-write', (_e, id, data) => shell.ptyWrite(appState, id, data));
    ipcMain.handle('pty-kill', (_e, id) => shell.ptyKill(appState, id));
    ipcMain.handle('pty-list', () => shell.ptyList(appState));

    // ===== Teams =====
    ipcMain.handle('send-to-teams', (_e, webhookUrl, title, content) =>
        teams.sendToTeams(webhookUrl, title, content),
    );

    // ===== Database =====
    ipcMain.handle('db-get-state', () => db.dbGetState(appState.db));
    ipcMain.handle('db-create-workspace', (_e, id, name, workspacePath) =>
        db.dbCreateWorkspace(appState.db, id, name, workspacePath),
    );
    ipcMain.handle('db-delete-workspace', (_e, id) => db.dbDeleteWorkspace(appState.db, id));
    ipcMain.handle('db-update-workspace-name', (_e, id, name) =>
        db.dbUpdateWorkspaceName(appState.db, id, name),
    );
    ipcMain.handle('db-get-conversations', (_e, workspaceId) =>
        db.dbGetConversations(appState.db, workspaceId),
    );
    ipcMain.handle('db-create-conversation', (_e, id, workspaceId, title) =>
        db.dbCreateConversation(appState.db, id, workspaceId, title),
    );
    ipcMain.handle('db-update-conversation-title', (_e, id, title) =>
        db.dbUpdateConversationTitle(appState.db, id, title),
    );
    ipcMain.handle('db-delete-conversation', (_e, id) =>
        db.dbDeleteConversation(appState.db, id),
    );
    ipcMain.handle('db-get-messages', (_e, conversationId) =>
        db.dbGetMessages(appState.db, conversationId),
    );
    ipcMain.handle('db-create-message', (_e, message) =>
        db.dbCreateMessage(appState.db, message),
    );
}

app.whenReady().then(() => {
    appState = createAppState();
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    // Clean up running processes
    for (const [, proc] of appState.runningCodex) {
        try { proc.child.kill(); } catch { }
    }
    for (const [, child] of appState.ptyTerminals) {
        try { child.kill(); } catch { }
    }
    // Close database
    try { appState.db.close(); } catch { }
});

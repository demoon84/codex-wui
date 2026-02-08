import { ChildProcess } from 'child_process';
import Database from 'better-sqlite3';

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
}

export interface CliOptions {
  profile: string;
  sandbox: string;
  askForApproval: string;
  skipGitRepoCheck: boolean;
  cwdOverride: string;
  extraArgs: string;
  enableWebSearch: boolean;
}

export interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  thinking?: string;
  thinkingDuration?: number;
  timestamp: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  conversations: Conversation[];
}

export interface DbState {
  workspaces: Workspace[];
}

export interface FileSearchResult {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface CodexUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  authMode: string;
  authProvider: string;
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export interface ShellCommandResult {
  success: boolean;
  commandId: string;
  output?: string;
  errorOutput?: string;
  exitCode?: number;
  error?: string;
}

export interface RuntimeConfig {
  mode: string;
  yoloMode: boolean;
  model: string;
  cwd: string;
  cliOptions: CliOptions;
}

export interface RunningCodexProcess {
  child: ChildProcess;
  stdin: NodeJS.WritableStream | null;
}

export interface PendingApproval {
  conversationId: string;
}

export interface AppState {
  config: RuntimeConfig;
  db: Database.Database;
  runningCodex: Map<string, RunningCodexProcess>;
  pendingApprovals: Map<string, PendingApproval>;
  ptyTerminals: Map<string, ChildProcess>;
}

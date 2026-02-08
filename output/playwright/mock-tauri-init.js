(() => {
  const STATE_KEY = '__codex_wui_mock_db_v1';
  const SETTINGS_KEY = '__codex_wui_mock_settings_v1';

  const defaultCliOptions = {
    profile: '',
    sandbox: 'workspace-write',
    askForApproval: 'on-request',
    skipGitRepoCheck: true,
    cwdOverride: '',
    extraArgs: '',
    enableWebSearch: false
  };

  const defaultModels = [
    { id: 'gpt-5-codex', name: 'GPT-5 Codex', description: 'Default coding model' },
    { id: 'gpt-5-codex-high', name: 'GPT-5 Codex High', description: 'High reasoning' },
    { id: 'gpt-5', name: 'GPT-5', description: 'General model' }
  ];

  let callbackSeq = 1;
  let listenerSeq = 1;
  const callbacks = new Map();
  const listenersByEvent = new Map();

  function nowIso() {
    return new Date().toISOString();
  }

  function safeParse(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function loadState() {
    return safeParse(localStorage.getItem(STATE_KEY), { workspaces: [] });
  }

  function saveState(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function loadSettings() {
    return safeParse(localStorage.getItem(SETTINGS_KEY), {
      mode: 'fast',
      yolo: false,
      model: 'gpt-5-codex',
      cliOptions: defaultCliOptions,
      user: null
    });
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function emitEvent(event, payload) {
    const listeners = listenersByEvent.get(event);
    if (!listeners) return;
    for (const [eventId, callbackId] of listeners.entries()) {
      const cb = callbacks.get(callbackId);
      if (cb) {
        cb({ event, id: eventId, payload });
      }
    }
  }

  function ensureWorkspace(state, workspaceId) {
    return state.workspaces.find((w) => w.id === workspaceId);
  }

  function ensureConversation(workspace, conversationId) {
    return workspace?.conversations.find((c) => c.id === conversationId);
  }

  const internals = window.__TAURI_INTERNALS__ || {};

  internals.transformCallback = (cb, once = false) => {
    const id = callbackSeq++;
    const wrapped = (...args) => {
      if (once) callbacks.delete(id);
      return cb(...args);
    };
    callbacks.set(id, wrapped);
    return id;
  };

  internals.unregisterCallback = (id) => {
    callbacks.delete(id);
  };

  internals.convertFileSrc = (filePath, protocol = 'asset') => `${protocol}://${filePath}`;

  internals.invoke = async (cmd, args = {}) => {
    if (cmd === 'plugin:event|listen') {
      const event = args.event;
      const callbackId = args.handler;
      const eventId = listenerSeq++;
      if (!listenersByEvent.has(event)) listenersByEvent.set(event, new Map());
      listenersByEvent.get(event).set(eventId, callbackId);
      return eventId;
    }

    if (cmd === 'plugin:event|unlisten') {
      const listeners = listenersByEvent.get(args.event);
      if (listeners) listeners.delete(args.eventId);
      return null;
    }

    if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
      emitEvent(args.event, args.payload);
      return null;
    }

    const settings = loadSettings();

    switch (cmd) {
      case 'set_mode':
        settings.mode = args.mode;
        saveSettings(settings);
        return settings.mode;
      case 'get_mode':
        return settings.mode || 'fast';
      case 'set_yolo_mode':
        settings.yolo = !!args.enabled;
        saveSettings(settings);
        return settings.yolo;
      case 'get_yolo_mode':
        return !!settings.yolo;
      case 'get_models':
        return defaultModels;
      case 'get_model':
        return settings.model || 'gpt-5-codex';
      case 'set_model':
        settings.model = args.modelId || 'gpt-5-codex';
        saveSettings(settings);
        return settings.model;
      case 'set_cli_options':
        settings.cliOptions = { ...defaultCliOptions, ...(settings.cliOptions || {}), ...(args.options || {}) };
        saveSettings(settings);
        return settings.cliOptions;
      case 'get_cli_options':
        return { ...defaultCliOptions, ...(settings.cliOptions || {}) };
      case 'check_codex':
        return { installed: true };
      case 'install_codex':
        setTimeout(() => emitEvent('codex-install-progress', { status: 'installing', message: 'mock install start', percent: 20 }), 10);
        setTimeout(() => emitEvent('codex-install-progress', { status: 'installing', message: 'mock install running', percent: 70 }), 40);
        setTimeout(() => emitEvent('codex-install-progress', { status: 'complete', message: 'mock install complete', percent: 100 }), 80);
        return { success: true };
      case 'init_acp':
        setTimeout(() => emitEvent('acp-ready', true), 0);
        return { success: true };
      case 'open_workspace':
        return { path: '/tmp/mock-workspace', name: 'mock-workspace' };
      case 'switch_workspace':
        return { success: true, sessionId: `mock-${args.workspaceId || 'session'}` };
      case 'stream_codex': {
        const cid = args.conversationId || '';
        const prompt = args.prompt || '';
        const response = `Mock response: ${prompt}`;
        setTimeout(() => emitEvent('codex-thinking', { cid, data: 'Mock reasoning...' }), 20);
        setTimeout(() => emitEvent('codex-tool-call', { cid, title: 'mock command', status: 'running' }), 35);
        setTimeout(() => emitEvent('codex-terminal-output', { cid, terminalId: 'mock-terminal', output: '$ echo mock\\nmock\\n', exitCode: 0 }), 50);
        response.split('').forEach((char, index) => {
          setTimeout(() => emitEvent('codex-stream-delta', { cid, data: char }), 70 + index * 12);
        });
        const doneAt = 70 + response.length * 12 + 20;
        setTimeout(() => emitEvent('codex-tool-call', { cid, title: 'mock command', status: 'done' }), doneAt);
        setTimeout(() => emitEvent('codex-stream-end', { cid }), doneAt + 20);
        return null;
      }
      case 'cancel_prompt':
        return { success: true };
      case 'update_title_bar_overlay':
        return { success: true };
      case 'respond_to_approval':
        return { success: true };
      case 'codex_login': {
        const user = {
          id: 'mock-user',
          email: 'mock@example.com',
          name: 'Mock User',
          picture: ''
        };
        settings.user = user;
        saveSettings(settings);
        return { success: true, user };
      }
      case 'codex_logout':
        settings.user = null;
        saveSettings(settings);
        return { success: true };
      case 'codex_login_methods':
        return { methods: [{ id: 'browser', label: 'Browser Login' }, { id: 'device-auth', label: 'Device Auth' }, { id: 'api-key', label: 'API Key' }] };
      case 'get_user':
        return settings.user || null;
      case 'search_files':
        return [];
      case 'read_file_content':
        return { success: true, content: '' };
      case 'write_file':
        return { success: true };
      case 'list_directory':
        return { success: true, entries: [] };
      case 'file_exists':
        return false;
      case 'run_command':
        return { success: true, commandId: `cmd-${Date.now()}`, output: '', exitCode: 0 };
      case 'run_codex_command':
        return { success: true, stdout: 'mock', stderr: '', exitCode: 0 };
      case 'kill_command':
        return { success: true };
      case 'pty_create':
        return { id: `pty-${Date.now()}`, shell: '/bin/zsh' };
      case 'pty_write':
        return { success: true };
      case 'pty_kill':
        return { success: true };
      case 'pty_list':
        return [];
      case 'web_search':
        return { success: true, results: [] };
      case 'db_get_state':
        return loadState();
      case 'db_create_workspace': {
        const state = loadState();
        if (!state.workspaces.some((w) => w.id === args.id)) {
          state.workspaces.push({
            id: args.id,
            name: args.name,
            path: args.workspacePath,
            conversations: []
          });
          saveState(state);
        }
        return true;
      }
      case 'db_delete_workspace': {
        const state = loadState();
        state.workspaces = state.workspaces.filter((w) => w.id !== args.id);
        saveState(state);
        return true;
      }
      case 'db_get_conversations': {
        const state = loadState();
        const workspace = ensureWorkspace(state, args.workspaceId);
        return workspace?.conversations || [];
      }
      case 'db_create_conversation': {
        const state = loadState();
        const workspace = ensureWorkspace(state, args.workspaceId);
        if (!workspace) return false;
        if (!workspace.conversations.some((c) => c.id === args.id)) {
          const now = nowIso();
          workspace.conversations.push({
            id: args.id,
            workspaceId: args.workspaceId,
            title: args.title,
            createdAt: now,
            updatedAt: now,
            messages: []
          });
          saveState(state);
        }
        return true;
      }
      case 'db_update_conversation_title': {
        const state = loadState();
        for (const workspace of state.workspaces) {
          const conv = ensureConversation(workspace, args.id);
          if (conv) {
            conv.title = args.title;
            conv.updatedAt = nowIso();
            saveState(state);
            break;
          }
        }
        return true;
      }
      case 'db_delete_conversation': {
        const state = loadState();
        for (const workspace of state.workspaces) {
          workspace.conversations = workspace.conversations.filter((c) => c.id !== args.id);
        }
        saveState(state);
        return true;
      }
      case 'db_get_messages': {
        const state = loadState();
        for (const workspace of state.workspaces) {
          const conv = ensureConversation(workspace, args.conversationId);
          if (conv) return conv.messages || [];
        }
        return [];
      }
      case 'db_create_message': {
        const state = loadState();
        const message = args.message;
        for (const workspace of state.workspaces) {
          const conv = ensureConversation(workspace, message.conversationId);
          if (conv) {
            conv.messages = conv.messages || [];
            conv.messages.push(message);
            conv.updatedAt = nowIso();
            saveState(state);
            return true;
          }
        }
        return false;
      }
      default:
        throw new Error(`Mock Tauri invoke not implemented: ${cmd}`);
    }
  };

  window.__TAURI_INTERNALS__ = internals;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = window.__TAURI_EVENT_PLUGIN_INTERNALS__ || {
    unregisterListener(event, eventId) {
      const listeners = listenersByEvent.get(event);
      if (listeners) listeners.delete(eventId);
    }
  };

  setTimeout(() => emitEvent('acp-ready', true), 0);
})();

// English (default) translations
const en = {
    // Common
    loading: 'Loading...',

    // Login
    loginTitle: 'Codex Login',
    loginButton: 'Sign in with Browser',
    loginBusy: 'Signing in...',

    // Codex Install
    checkingEnv: 'Checking environment...',
    installRequired: 'Codex CLI Installation Required',
    installDescription1: 'OpenAI Codex CLI is required to use Codex UI.',
    installDescription2: 'Click the button below to install automatically.',
    installing: 'Installing...',
    preparing: 'Preparing...',
    retry: 'Retry',
    installButton: 'Install Codex CLI',
    installHint: 'Runs npm install -g @openai/codex',

    // Chat
    chatPlaceholder: 'Ask me anything',
    chatPlaceholderNoWorkspace: 'Open a workspace to get started...',
    chatPlaceholderLoading: 'Type to cancel current response...',
    startConversation: 'Start a conversation with Codex',
    stopResponse: 'Stop response',
    responseCancelled: '(Response cancelled)',
    errorOccurred: 'An error occurred: ',

    // Comments (code-level)
    recentHistoryComment: 'Send recent 3 search history',

    // Sidebar

    // Status Bar
    yoloTooltipOn: 'full access: auto-approve all actions',
    yoloTooltipOff: 'permission: confirm before actions',

    // Approval Dialog
    approvalTitle: 'Proceed with this plan?',
    approvalReject: 'Reject',
    approvalApproving: 'Approving...',
    approvalApprove: 'Approve',

    // Model Selector
    selectModel: 'Select AI Model',
    thinkingBadge: 'reasoning',

    // Model Descriptions
    'model.gpt-5.3-codex': 'Latest top-performance coding model, optimized for complex agent tasks',
    'model.gpt-5.2-codex': 'Advanced coding model, suitable for engineering tasks',
    'model.gpt-5.1-codex-max': 'Optimized for long-running agent coding tasks',
    'model.gpt-5.1-codex-mini': 'Cost-effective small coding model',
    'model.o4-mini': 'Default model, fast responses',
    'model.gpt-4.1': 'Smartest non-reasoning model',
    'model.gpt-4o': 'Suitable for multimodal tasks',

    // Context Menu
    searching: 'Searching...',
    navigate: 'Navigate',
    select: 'Select',
    close: 'Close',

    // Chat Panel
    copied: 'Copied!',
    copy: 'Copy',
    thinking: 'Thinking',
    'tool.search': 'Search',
    'tool.fileRead': 'Read file',
    'tool.edit': 'Edit',
    'tool.command': 'Run command',
    'tool.analyze': 'Analyze',
    'tool.other': 'Task',

    // Task Summary
    taskComplete: 'Task complete',

    // Terminal & Generation
    runningTerminal: 'Running terminal',
    terminalOutput: 'Terminal output',
    generating: 'Generating...',
} as const

export type TranslationKey = keyof typeof en
export type Translations = Record<TranslationKey, string>
export default en

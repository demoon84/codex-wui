import { useState } from 'react'

type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'

export interface CliOptions {
    profile: string
    sandbox: SandboxMode
    askForApproval: ApprovalPolicy
    skipGitRepoCheck: boolean
    cwdOverride: string
    extraArgs: string
    enableWebSearch: boolean
}

export interface CliPreset {
    id: string
    name: string
    options: CliOptions
}

interface CliControlPanelProps {
    visible: boolean
    yoloMode: boolean
    options: CliOptions
    presets: CliPreset[]
    selectedPresetId: string
    commandOutput: string
    onClose: () => void
    onToggleYolo: (value: boolean) => void
    onChangeOptions: (next: CliOptions) => void
    onApplyPreset: (id: string) => void
    onSavePreset: (name: string) => void
    onDeletePreset: (id: string) => void
    onSelectPreset: (id: string) => void
    onRunQuickCommand: (command: 'version' | 'exec-help' | 'review-help' | 'mcp-help' | 'features') => void
    onRunCustomCommand: (raw: string) => void
}

export function CliControlPanel({
    visible,
    yoloMode,
    options,
    presets,
    selectedPresetId,
    commandOutput,
    onClose,
    onToggleYolo,
    onChangeOptions,
    onApplyPreset,
    onSavePreset,
    onDeletePreset,
    onSelectPreset,
    onRunQuickCommand,
    onRunCustomCommand
}: CliControlPanelProps) {
    const [presetName, setPresetName] = useState('')
    const [customCommand, setCustomCommand] = useState('help')

    if (!visible) return null

    return (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-sidebar)] px-4 py-3">
            <div className="max-w-4xl mx-auto space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-[12px] font-semibold text-[var(--color-text-primary)]">Codex CLI Control</h3>
                    <button onClick={onClose} className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">Close</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="text-[11px] text-[var(--color-text-secondary)]">
                        Profile
                        <input
                            value={options.profile}
                            onChange={(e) => onChangeOptions({ ...options, profile: e.target.value })}
                            placeholder="default"
                            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-1.5 text-[12px]"
                        />
                    </label>
                    <label className="text-[11px] text-[var(--color-text-secondary)]">
                        CWD Override
                        <input
                            value={options.cwdOverride}
                            onChange={(e) => onChangeOptions({ ...options, cwdOverride: e.target.value })}
                            placeholder="(workspace default)"
                            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-1.5 text-[12px]"
                        />
                    </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="text-[11px] text-[var(--color-text-secondary)]">
                        Sandbox
                        <select
                            value={options.sandbox}
                            onChange={(e) => onChangeOptions({ ...options, sandbox: e.target.value as SandboxMode })}
                            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-1.5 text-[12px]"
                            disabled={yoloMode}
                        >
                            <option value="read-only">read-only</option>
                            <option value="workspace-write">workspace-write</option>
                            <option value="danger-full-access">danger-full-access</option>
                        </select>
                    </label>

                    <label className="text-[11px] text-[var(--color-text-secondary)]">
                        Ask For Approval
                        <select
                            value={options.askForApproval}
                            onChange={(e) => onChangeOptions({ ...options, askForApproval: e.target.value as ApprovalPolicy })}
                            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-1.5 text-[12px]"
                            disabled={yoloMode}
                        >
                            <option value="untrusted">untrusted</option>
                            <option value="on-failure">on-failure</option>
                            <option value="on-request">on-request</option>
                            <option value="never">never</option>
                        </select>
                    </label>

                    <div className="flex items-end gap-3 text-[11px] text-[var(--color-text-secondary)]">
                        <label className="flex items-center gap-1.5">
                            <input
                                type="checkbox"
                                checked={options.skipGitRepoCheck}
                                onChange={(e) => onChangeOptions({ ...options, skipGitRepoCheck: e.target.checked })}
                            />
                            skip git check
                        </label>
                        <label className="flex items-center gap-1.5">
                            <input
                                type="checkbox"
                                checked={options.enableWebSearch}
                                onChange={(e) => onChangeOptions({ ...options, enableWebSearch: e.target.checked })}
                            />
                            web search
                        </label>
                        <label className="flex items-center gap-1.5">
                            <input
                                type="checkbox"
                                checked={yoloMode}
                                onChange={(e) => onToggleYolo(e.target.checked)}
                            />
                            full access
                        </label>
                    </div>
                </div>

                <label className="text-[11px] text-[var(--color-text-secondary)] block">
                    Extra Args (raw)
                    <input
                        value={options.extraArgs}
                        onChange={(e) => onChangeOptions({ ...options, extraArgs: e.target.value })}
                        placeholder="--output-last-message out.txt"
                        className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-1.5 text-[12px] font-mono"
                    />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={selectedPresetId}
                        onChange={(e) => onSelectPreset(e.target.value)}
                        className="rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-1.5 text-[11px]"
                    >
                        <option value="">Preset (workspace)</option>
                        {presets.map((preset) => (
                            <option key={preset.id} value={preset.id}>{preset.name}</option>
                        ))}
                    </select>
                    <button onClick={() => selectedPresetId && onApplyPreset(selectedPresetId)} className="px-2 py-1.5 rounded bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[11px]">Apply</button>
                    <button onClick={() => selectedPresetId && onDeletePreset(selectedPresetId)} className="px-2 py-1.5 rounded bg-[var(--color-bg-card)] border border-[var(--color-border)] text-[11px]">Delete</button>
                    <input
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder="New preset name"
                        className="rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-1.5 text-[11px]"
                    />
                    <button
                        onClick={() => {
                            if (!presetName.trim()) return
                            onSavePreset(presetName.trim())
                            setPresetName('')
                        }}
                        className="px-2 py-1.5 rounded bg-[var(--color-primary)] text-white text-[11px]"
                    >
                        Save Preset
                    </button>
                </div>

                <div className="flex flex-wrap gap-2">
                    <button onClick={() => onRunQuickCommand('version')} className="px-2 py-1 rounded border border-[var(--color-border)] text-[11px]">codex --version</button>
                    <button onClick={() => onRunQuickCommand('exec-help')} className="px-2 py-1 rounded border border-[var(--color-border)] text-[11px]">codex exec --help</button>
                    <button onClick={() => onRunQuickCommand('review-help')} className="px-2 py-1 rounded border border-[var(--color-border)] text-[11px]">codex review --help</button>
                    <button onClick={() => onRunQuickCommand('mcp-help')} className="px-2 py-1 rounded border border-[var(--color-border)] text-[11px]">codex mcp --help</button>
                    <button onClick={() => onRunQuickCommand('features')} className="px-2 py-1 rounded border border-[var(--color-border)] text-[11px]">codex features</button>
                </div>

                <div className="flex items-center gap-2">
                    <input
                        value={customCommand}
                        onChange={(e) => setCustomCommand(e.target.value)}
                        className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-1.5 text-[11px] font-mono"
                        placeholder="custom subcommand, e.g. completion --help"
                    />
                    <button onClick={() => onRunCustomCommand(customCommand)} className="px-2 py-1.5 rounded bg-[var(--color-primary)] text-white text-[11px]">Run</button>
                </div>

                {commandOutput && (
                    <pre className="max-h-48 overflow-auto rounded border border-[var(--color-border)] bg-[#0d1117] p-2 text-[10px] text-[var(--color-text-secondary)] whitespace-pre-wrap">
                        {commandOutput}
                    </pre>
                )}
            </div>
        </div>
    )
}

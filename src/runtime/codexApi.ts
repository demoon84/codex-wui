/**
 * Runtime codexApi setup.
 *
 * In Electron, codexApi is set up by the preload script via contextBridge
 * before the renderer process loads. This file is now a no-op.
 */

export async function setupRuntimeCodexApi(): Promise<void> {
  // In Electron, window.codexApi is already set by preload.ts
  // Nothing to do here.
  if (typeof window !== 'undefined' && (window as any).codexApi) {
    // Apply default CLI options
    try {
      await (window as any).codexApi.setCliOptions({
        profile: '',
        sandbox: 'workspace-write',
        askForApproval: 'on-request',
        skipGitRepoCheck: true,
        cwdOverride: '',
        extraArgs: '',
        enableWebSearch: false,
      })
    } catch (e) {
      console.warn('Failed to set default CLI options:', e)
    }
  }
}

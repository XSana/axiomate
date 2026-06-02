import { feature } from 'bun:bundle';
import { appendFileSync } from 'fs';
import React from 'react';
import { gracefulShutdown, gracefulShutdownSync } from './utils/gracefulShutdown.js';
import { setSessionTrustAccepted, setStatsStore } from './bootstrap/state.js';
import type { Command } from './commands.js';
import { createStatsStore, type StatsStore } from './context/stats.js';
import { isSynchronizedOutputSupported } from './ink/terminal.js';
import type { RenderOptions, Root, TextProps } from './ink.js';
import { KeybindingSetup } from './keybindings/KeybindingProviderSetup.js';
import { startDeferredPrefetches } from './main.js';
import { AppStateProvider } from './state/AppState.js';
import { onChangeAppState } from './state/onChangeAppState.js';
import { checkHasTrustDialogAccepted, getGlobalConfig } from './utils/config.js';
import { type FpsMetrics, FpsTracker } from './utils/fpsTracker.js';
import type { PermissionMode } from './utils/permissions/PermissionMode.js';
import { getBaseRenderOptions } from './utils/renderOptions.js';
export function showDialog<T = void>(root: Root, renderer: (done: (result: T) => void) => React.ReactNode): Promise<T> {
  return new Promise<T>(resolve => {
    const done = (result: T): void => void resolve(result);
    root.render(renderer(done));
  });
}

/**
 * Render an error message through Ink, then unmount and exit.
 * Use this for fatal errors after the Ink root has been created —
 * console.error is swallowed by Ink's patchConsole, so we render
 * through the React tree instead.
 */
export async function exitWithError(root: Root, message: string, beforeExit?: () => Promise<void>): Promise<never> {
  return exitWithMessage(root, message, {
    color: 'error',
    beforeExit
  });
}

/**
 * Render a message through Ink, then unmount and exit.
 * Use this for messages after the Ink root has been created —
 * console output is swallowed by Ink's patchConsole, so we render
 * through the React tree instead.
 */
export async function exitWithMessage(root: Root, message: string, options?: {
  color?: TextProps['color'];
  exitCode?: number;
  beforeExit?: () => Promise<void>;
}): Promise<never> {
  const {
    Text
  } = await import('./ink.js');
  const color = options?.color;
  const exitCode = options?.exitCode ?? 1;
  root.render(color ? <Text color={color}>{message}</Text> : <Text>{message}</Text>);
  root.unmount();
  await options?.beforeExit?.();
  // eslint-disable-next-line custom-rules/no-process-exit -- exit after Ink unmount
  process.exit(exitCode);
}

/**
 * Show a setup dialog wrapped in AppStateProvider + KeybindingSetup.
 * Reduces boilerplate in showSetupScreens() where every dialog needs these wrappers.
 */
export function showSetupDialog<T = void>(root: Root, renderer: (done: (result: T) => void) => React.ReactNode, options?: {
  onChangeAppState?: typeof onChangeAppState;
}): Promise<T> {
  return showDialog<T>(root, done => <AppStateProvider onChangeAppState={options?.onChangeAppState}>
      <KeybindingSetup>{renderer(done)}</KeybindingSetup>
    </AppStateProvider>);
}

/**
 * Render the main UI into the root and wait for it to exit.
 * Handles the common epilogue: start deferred prefetches, wait for exit, graceful shutdown.
 */
export async function renderAndRun(root: Root, element: React.ReactNode): Promise<void> {
  root.render(element);
  startDeferredPrefetches();
  await root.waitUntilExit();
  await gracefulShutdown(0);
}
export async function showSetupScreens(root: Root, _permissionMode: PermissionMode, commands?: Command[]): Promise<boolean> {
  // First-run signal: no models configured yet. Returning users skip the
  // wizard entirely. /theme and /terminal-setup remain available as commands.
  const isFirstRun = Object.keys(getGlobalConfig().models ?? {}).length === 0;
  if (isFirstRun) {
    const { Onboarding } = await import('./components/Onboarding.js');
    await showSetupDialog(root, done => <Onboarding onDone={() => done()} />);
  }

  // Workspace trust is independent of first-run onboarding. Returning users
  // still need to pass the trust gate before trust-protected features run.
  if (!checkHasTrustDialogAccepted()) {
    const { TrustDialog } = await import('./components/TrustDialog/TrustDialog.js');
    await showSetupDialog(root, done => <TrustDialog onDone={done} commands={commands} />);
  }

  setSessionTrustAccepted(true);

  const { handleMcpjsonServerApprovals } = await import('./services/mcpServerApproval.js');
  await handleMcpjsonServerApprovals(root);

  const {
    clearMemoryFileCaches,
    getExternalAxiomateMdIncludes,
    getMemoryFiles,
    shouldShowAxiomateMdExternalIncludesWarning,
  } = await import('./utils/axiomatemd.js');
  if (await shouldShowAxiomateMdExternalIncludesWarning()) {
    const { AxiomateMdExternalIncludesDialog } = await import('./components/MdExternalIncludesDialog.js');
    const externalIncludes = getExternalAxiomateMdIncludes(
      await getMemoryFiles(true),
    );
    await showSetupDialog(root, done => (
      <AxiomateMdExternalIncludesDialog
        onDone={() => {
          clearMemoryFileCaches();
          done();
        }}
        isStandaloneDialog
        externalIncludes={externalIncludes}
      />
    ));
  }

  return isFirstRun;
}
export function getRenderContext(exitOnCtrlC: boolean): {
  renderOptions: RenderOptions;
  getFpsMetrics: () => FpsMetrics | undefined;
  stats: StatsStore;
} {
  let lastFlickerTime = 0;
  const baseOptions = getBaseRenderOptions(exitOnCtrlC);

  // Log analytics event when stdin override is active
  if (baseOptions.stdin) {
  }
  const fpsTracker = new FpsTracker();
  const stats = createStatsStore();
  setStatsStore(stats);

  // Bench mode: when set, append per-frame phase timings as JSONL for
  // offline analysis by bench/repl-scroll.ts. Captures the full TUI
  // render pipeline (yoga → screen buffer → diff → optimize → stdout)
  // so perf work on any phase can be validated against real user flows.
  const frameTimingLogPath = process.env.AXIOMATE_CODE_FRAME_TIMING_LOG;
  return {
    getFpsMetrics: () => fpsTracker.getMetrics(),
    stats,
    renderOptions: {
      ...baseOptions,
      onFrame: event => {
        fpsTracker.record(event.durationMs);
        stats.observe('frame_duration_ms', event.durationMs);
        if (frameTimingLogPath && event.phases) {
          // Bench-only env-var-gated path: sync write so no frames dropped
          // on abrupt exit. ~100 bytes at ≤60fps is negligible. rss/cpu are
          // single syscalls; cpu is cumulative — bench side computes delta.
          const line =
          // eslint-disable-next-line custom-rules/no-direct-json-operations -- tiny object, hot bench path
          JSON.stringify({
            total: event.durationMs,
            ...event.phases,
            rss: process.memoryUsage.rss(),
            cpu: process.cpuUsage()
          }) + '\n';
          // eslint-disable-next-line custom-rules/no-sync-fs -- bench-only, sync so no frames dropped on exit
          appendFileSync(frameTimingLogPath, line);
        }
        // Skip flicker reporting for terminals with synchronized output —
        // DEC 2026 buffers between BSU/ESU so clear+redraw is atomic.
        if (isSynchronizedOutputSupported()) {
          return;
        }
        for (const flicker of event.flickers) {
          if (flicker.reason === 'resize') {
            continue;
          }
          const now = Date.now();
          if (now - lastFlickerTime < 1000) {
          }
          lastFlickerTime = now;
        }
      }
    }
  };
}

/**
 * Resolves the bundled agent-browser CLI binary path at runtime.
 *
 * Mirrors agent/src/utils/rtk.ts:findRtkBinary — the same dual-search that
 * every sidecar binary in axiomate uses (rg, rtk). Both branches derive from
 * runtime values, so no build-machine absolute path is baked into the bundle.
 *
 *   1. Packaged Bun-compiled exe (isInBundledMode): agent-browser[.exe] sits
 *      next to axiomate.exe — package-{win,mac,linux}.ts copy it there.
 *      Resolve via dirname(process.execPath). MUST come first: the
 *      createRequire fallback fails inside Bun-compiled exes (their virtual
 *      fs has no node_modules).
 *
 *   2. Bun-runtime / pnpm install (pnpm start): process.execPath is bun/node,
 *      not useful. Resolve the agent-browser-axiomate workspace package via
 *      createRequire; its index.js exports `agentBrowserPath`.
 *
 * Returns null when neither location has the binary (bootstrap not run, no
 * packaged build) — callers fail open and report the browser feature
 * unavailable rather than crashing.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const AGENT_BROWSER_BINARY =
  process.platform === "win32" ? "agent-browser.exe" : "agent-browser";

/**
 * Bun-compiled-exe detection. Inlined (not imported from the agent package)
 * because browser-bridge-axiomate is an independent workspace package. Mirrors
 * agent/src/utils/bundledMode.ts: trust Bun.embeddedFiles when populated, else
 * fall back to the execPath basename (Bun 1.3.x Linux empties embeddedFiles in
 * compiled binaries).
 */
function isInBundledMode(): boolean {
  const bun = (globalThis as { Bun?: { embeddedFiles?: unknown[] } }).Bun;
  if (bun && Array.isArray(bun.embeddedFiles) && bun.embeddedFiles.length > 0) {
    return true;
  }
  if (process.versions.bun !== undefined) {
    const execName = process.execPath.split(/[\\/]/).pop() ?? "";
    if (execName === "axiomate" || execName === "axiomate.exe") return true;
  }
  return false;
}

let cached: string | null | undefined;

export function resolveAgentBrowserPath(): string | null {
  if (cached !== undefined) return cached;
  cached = findAgentBrowserBinary();
  return cached;
}

function findAgentBrowserBinary(): string | null {
  // 1. Next to the compiled exe (packaged mode).
  if (isInBundledMode()) {
    const candidate = join(dirname(process.execPath), AGENT_BROWSER_BINARY);
    if (existsSync(candidate)) return candidate;
  }

  // 2. Workspace package via createRequire (dev / pnpm).
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("agent-browser-axiomate") as {
      agentBrowserPath?: string | null;
    };
    if (pkg.agentBrowserPath && existsSync(pkg.agentBrowserPath)) {
      return pkg.agentBrowserPath;
    }
  } catch {
    // Package not linked (e.g. not bootstrapped) — fall through to null.
  }

  return null;
}

/** Test seam: reset the memoized resolution. */
export function __resetAgentBrowserPathForTesting(): void {
  cached = undefined;
}

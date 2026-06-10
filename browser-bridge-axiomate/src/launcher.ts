/**
 * Browser launcher — isolated-profile path (Phase 2a).
 *
 * Spawns a Chromium-family browser with `--remote-debugging-port` against a
 * dedicated profile dir under `~/.axiomate/browser-bridge/profile`. The
 * spawned process is detached so the agent's lifecycle doesn't tie to it;
 * `browser_detach` kills the PID explicitly when the bridge is torn down.
 *
 * Direct port of hermes_cli/browser_connect.py. Binary tables, spawn flags,
 * and the CDP-ready retry loop match upstream so the operational behavior
 * (which browsers are tried, in what order, with what flags) stays
 * consistent with hermes-agent.
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection, createServer, Socket } from "node:net";
import { execa } from "execa";
import type { BrowserKind } from "./types.js";

export const DEFAULT_CDP_PORT = 9222;

/** Candidate binaries on macOS, in preference order. */
const DARWIN_APPS: Array<{ kind: BrowserKind; path: string }> = [
  { kind: "chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
  { kind: "edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
  { kind: "brave", path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
  { kind: "vivaldi", path: "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi" },
  { kind: "opera", path: "/Applications/Opera.app/Contents/MacOS/Opera" },
  { kind: "arc", path: "/Applications/Arc.app/Contents/MacOS/Arc" },
  { kind: "thorium", path: "/Applications/Thorium.app/Contents/MacOS/Thorium" },
  { kind: "chromium", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" },
];

/**
 * Candidate binaries on Windows, expressed as (env-var, suffix) so we can
 * resolve %ProgramFiles% / %ProgramFiles(x86)% / %LOCALAPPDATA% at runtime.
 */
const WINDOWS_INSTALL_PARTS: Array<{
  kind: BrowserKind;
  env: "ProgramFiles" | "ProgramFiles(x86)" | "LOCALAPPDATA";
  suffix: string;
}> = [
  { kind: "chrome", env: "ProgramFiles", suffix: "Google\\Chrome\\Application\\chrome.exe" },
  { kind: "chrome", env: "ProgramFiles(x86)", suffix: "Google\\Chrome\\Application\\chrome.exe" },
  { kind: "chrome", env: "LOCALAPPDATA", suffix: "Google\\Chrome\\Application\\chrome.exe" },
  { kind: "edge", env: "ProgramFiles", suffix: "Microsoft\\Edge\\Application\\msedge.exe" },
  { kind: "edge", env: "ProgramFiles(x86)", suffix: "Microsoft\\Edge\\Application\\msedge.exe" },
  { kind: "brave", env: "ProgramFiles", suffix: "BraveSoftware\\Brave-Browser\\Application\\brave.exe" },
  { kind: "brave", env: "ProgramFiles(x86)", suffix: "BraveSoftware\\Brave-Browser\\Application\\brave.exe" },
  { kind: "brave", env: "LOCALAPPDATA", suffix: "BraveSoftware\\Brave-Browser\\Application\\brave.exe" },
  { kind: "vivaldi", env: "LOCALAPPDATA", suffix: "Vivaldi\\Application\\vivaldi.exe" },
  { kind: "opera", env: "LOCALAPPDATA", suffix: "Programs\\Opera\\opera.exe" },
];

export interface BrowserCandidate {
  kind: BrowserKind;
  path: string;
}

/**
 * Resolved candidate binaries that exist on disk, in preference order.
 * Pure (no FS in test build): callers can stub `existsSync` via fs mocking.
 */
export function getBrowserCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): BrowserCandidate[] {
  if (platform === "darwin") {
    return DARWIN_APPS.filter((c) => existsSync(c.path));
  }
  if (platform === "win32") {
    const out: BrowserCandidate[] = [];
    for (const { kind, env: envKey, suffix } of WINDOWS_INSTALL_PARTS) {
      const base = env[envKey];
      if (!base) continue;
      const path = join(base, suffix);
      if (existsSync(path)) out.push({ kind, path });
    }
    return out;
  }
  return [];
}

/**
 * The profile dir for THIS axiomate process: `~/.axiomate/browser-bridge/
 * profile-<pid>`. ONE dir per process, constant for the process's whole life.
 *
 * This single fact satisfies both profile requirements with NO persisted state,
 * NO ownership registry, NO sidecar:
 *  - #1 instances never collide: different processes → different pids →
 *    different dirs → Chrome's single-instance lock never conflicts across
 *    instances.
 *  - #2 one instance's start/stop cycles share a profile: the pid doesn't
 *    change, so every attach/detach/re-attach uses the same dir → the user's
 *    logins persist for the life of the process.
 *
 * We deliberately do NOT share one stable profile across instances. An earlier
 * design did, which forced an on-disk ownership sidecar (pid/port/ownerPid) to
 * arbitrate sharing — and that sidecar was a SNAPSHOT of OS truth (process
 * liveness, Chrome's lock) that inevitably went stale, producing the whole
 * class of "trusted dirty data" bugs (recycled-pid kills, dead-port hangs,
 * false "already attached"). Per-pid profiles delete that snapshot entirely:
 * the only truth left is live (in-memory session + a real-time CDP probe).
 */
export function profileDir(): string {
  return join(homedir(), ".axiomate", "browser-bridge", `profile-${process.pid}`);
}

/**
 * Best-effort GC for leaked profile dirs from instances that already exited
 * (clean exit removes our own dir; SIGKILL leaves it). Removes any
 * `profile-<pid>` whose pid is DEAD — never our own, never a live instance's.
 * Pure DISK cleanup, NOT a state source: we never READ these dirs to make
 * decisions, so a recycled-pid false-"alive" only SKIPS a delete (harmless
 * leak), never a wrong delete. Called once per attach; cheap, never throws.
 */
function sweepDeadProfiles(): void {
  const root = join(homedir(), ".axiomate", "browser-bridge");
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return; // root missing — nothing to sweep
  }
  for (const name of entries) {
    const m = /^profile-(\d+)$/.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue; // our own live dir
    if (isPidAlive(pid)) continue; // another live instance's dir
    try {
      rmSync(join(root, name), { recursive: true, force: true });
    } catch {
      // best effort — a leftover dir doesn't break anything
    }
  }
}

/**
 * Is `pid` a live process we can see? process.kill(pid,0) is the safe
 * cross-platform liveness check in Node (ESRCH = gone, EPERM = alive but not
 * ours). Used only by the disk GC above to skip live instances' dirs.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Clear a stale single-instance lock left by THIS process's prior bridge
 * browser that didn't exit cleanly (the agent-browser daemon died but Chrome
 * lived, within the same pid). The lock is what makes a fresh launch on the
 * same profile silently forward to the dead instance and never open its own CDP
 * port ("CDP did not become ready").
 *
 * POSIX: Chrome leaves Singleton{Lock,Socket,Cookie} symlinks that can outlive
 * the process; remove them. Windows: the lock is held by the PROCESS, not a
 * file — no Singleton* artifact, so this is a no-op there (a lingering same-pid
 * Chrome is killed by teardown before re-attach).
 *
 * We do NOT kill any pid here: with per-pid profiles there's no cross-instance
 * zombie to reap, and we keep no persisted pid to chase (that persisted pid was
 * exactly the recycled-pid-kill hazard we deleted along with the sidecar).
 */

/**
 * Clear a stale single-instance lock left by a prior bridge browser that
 * didn't exit cleanly (agent crash without detach). The lock is what makes a
 * fresh launch on the same profile silently forward to the dead instance and
 * never open its own CDP port ("CDP did not become ready").
 *
 * Windows: the lock is held by the PROCESS, not a file — there's no Singleton*
 * artifact to delete (verified: an idle bridge profile has none). POSIX: Chrome
 * leaves Singleton{Lock,Socket,Cookie} symlinks that can outlive the process;
 * remove them. Never deletes profile DATA (logins survive).
 */
function clearStaleLock(userDataDir: string): void {
  if (process.platform !== "win32") {
    for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      try {
        rmSync(join(userDataDir, name), { force: true });
      } catch {
        // best effort
      }
    }
  }
}

/**
 * Pick a free TCP port by binding to 0 and reading what the OS handed back.
 * Avoids colliding with whatever the user might already have on 9222.
 */
export async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("could not resolve listening port"));
      }
    });
  });
}

/**
 * One TCP connect attempt with a timeout. Used by the readiness retry loop —
 * we don't speak HTTP here; CDP listens on a TCP socket and accepting the
 * connection is sufficient evidence that the port is live.
 */
export async function probeCdpEndpoint(
  host: string,
  port: number,
  timeoutMs: number = 1000,
): Promise<boolean> {
  return await new Promise((resolve) => {
    let settled = false;
    const sock: Socket = createConnection({ host, port });
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // Already destroyed — ignore.
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      finish(true);
    });
    sock.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

/**
 * Poll the CDP port until it accepts connections, or give up. Mirrors
 * hermes_cli/cli.py:7940-7949 (10 attempts × 500ms = 5s window).
 */
export async function waitForCdpReady(
  host: string,
  port: number,
  attempts: number = 10,
  intervalMs: number = 500,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await probeCdpEndpoint(host, port, 1000)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export interface LaunchResult {
  ok: boolean;
  pid?: number;
  binary?: string;
  kind?: BrowserKind;
  port?: number;
  reason?: string;
  /** Profile dir actually used — for scoped cleanup. */
  userDataDir?: string;
}

export interface LaunchOptions {
  /** Override the auto-picked free port (mostly for tests). */
  port?: number;
  /** Override the default isolated profile dir. */
  userDataDir?: string;
  /** Pin to a specific binary (skips candidate search). */
  binary?: string;
  /** Pin browser kind when a custom binary is supplied. */
  kind?: BrowserKind;
}

/**
 * Spawn the first available Chromium-family browser with the isolated-profile
 * flags set. Detaches the child so it survives the agent process; release
 * paths kill the PID explicitly.
 *
 * Returns `{ok:false, reason}` on no-binary-found / port-in-use / spawn-error
 * so the caller can surface a clean MCP tool result instead of throwing
 * past the dispatch layer.
 */
export async function tryLaunchIsolated(
  opts: LaunchOptions = {},
): Promise<LaunchResult> {
  const platform = process.platform;
  let chosen: BrowserCandidate | null = null;
  if (opts.binary) {
    chosen = { kind: opts.kind ?? "unknown", path: opts.binary };
  } else {
    const candidates = getBrowserCandidates(platform);
    chosen = candidates[0] ?? null;
  }
  if (!chosen) {
    return {
      ok: false,
      reason: `no Chromium-family browser found on ${platform}`,
    };
  }
  // One profile per process (profile-<pid>); a pinned userDataDir (tests)
  // overrides it.
  const userDataDir = opts.userDataDir ?? profileDir();
  // GC leaked profile dirs from already-dead instances. Best-effort, skip for
  // pinned-dir test launches.
  if (opts.userDataDir === undefined) sweepDeadProfiles();
  mkdirSync(userDataDir, { recursive: true, mode: 0o700 });

  // Clear any stale single-instance lock our OWN prior browser left in this
  // profile (same-pid re-attach after the agent-browser daemon died but Chrome
  // didn't fully release the POSIX Singleton symlinks). No cross-instance
  // concern: each process has its own profile-<pid>. Skip for pinned-port tests.
  if (opts.port === undefined) clearStaleLock(userDataDir);

  const port = opts.port ?? (await pickFreePort());

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  try {
    const child = execa(chosen.path, args, {
      detached: true,
      windowsHide: platform === "win32",
      stdio: "ignore",
      cleanup: false,
    });
    // Detach so the child outlives this process — we don't await it.
    child.unref?.();
    // We intentionally never await `child`, so swallow its eventual
    // settlement: when the browser later exits (or we kill it), execa would
    // otherwise surface an unhandled promise rejection.
    child.catch(() => {});
    const pid = child.pid;
    const ready = await waitForCdpReady("127.0.0.1", port);
    if (!ready) {
      return {
        ok: false,
        pid,
        binary: chosen.path,
        kind: chosen.kind,
        port,
        reason: `CDP did not become ready on port ${port} within 5s`,
      };
    }
    // No sidecar to write: per-pid profile + live in-memory session are the
    // only state, so there's nothing to persist for a later attach to trust.
    return { ok: true, pid, binary: chosen.path, kind: chosen.kind, port, userDataDir };
  } catch (err) {
    return {
      ok: false,
      binary: chosen.path,
      kind: chosen.kind,
      port,
      reason: `spawn failed: ${(err as Error).message}`,
    };
  }
}

/**
 * String the user can paste into a terminal if the auto-launcher fails —
 * mirrors hermes' "manual fallback" pattern. Diagnostics-only; no shell
 * escaping needed because the user runs it themselves.
 */
export function manualLaunchCommand(
  port: number,
  platform: NodeJS.Platform,
): string | null {
  const userDataDir = profileDir();
  if (platform === "darwin") {
    const c = DARWIN_APPS.find((c) => existsSync(c.path));
    if (!c) return null;
    return `"${c.path}" --remote-debugging-port=${port} --user-data-dir="${userDataDir}" --no-first-run --no-default-browser-check`;
  }
  if (platform === "win32") {
    const c = getBrowserCandidates("win32")[0];
    if (!c) return null;
    return `"${c.path}" --remote-debugging-port=${port} --user-data-dir="${userDataDir}" --no-first-run --no-default-browser-check`;
  }
  return null;
}

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

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection, createServer, Socket } from "node:net";
import { execa } from "execa";
import { spawnSync } from "node:child_process";
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

/** Default isolated-profile dir under the user's home. */
export function isolatedProfileDir(): string {
  return join(homedir(), ".axiomate", "browser-bridge", "profile");
}

/**
 * Per-PROCESS profile dir, used only when the stable profile is already owned
 * by another LIVE axiomate. Chrome's single-instance lock forbids two
 * concurrent instances on one `--user-data-dir` (verified: the 2nd instance's
 * CDP port never opens — the lock forwards it to the 1st), so concurrent
 * axiomate processes MUST get distinct profiles or they collide.
 */
export function perProcessProfileDir(): string {
  return join(homedir(), ".axiomate", "browser-bridge", `profile-${process.pid}`);
}

/**
 * Best-effort reaper for leaked per-pid profile dirs. A `profile-<pid>` is
 * created when a concurrent instance can't use the stable profile; on a clean
 * exit we only delete its sidecar (not the dir), and on SIGKILL nothing is
 * cleaned — so these dirs accumulate. Here we scan the browser-bridge root and
 * remove any `profile-<pid>` whose pid is DEAD (and never our own live pid).
 * Recursive rm of a dead instance's profile is safe: that pid can't be using
 * it, and a recycled-pid false-"alive" only causes us to SKIP deletion (leak),
 * never a wrong delete. Called once per attach; cheap, never throws.
 */
function sweepDeadPerProcessProfiles(): void {
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
    if (pid === process.pid) continue; // never our own live dir
    if (isPidAlive(pid)) continue; // another live instance owns it
    try {
      rmSync(join(root, name), { recursive: true, force: true });
    } catch {
      // best effort — a leftover dir doesn't break anything
    }
  }
}

/**
 * Pick the profile dir for THIS attach.
 *
 * Prefer the stable shared profile so a single axiomate's start/stop debugging
 * cycles keep the user's logged-in session (cookies/Login Data persist there).
 * But if that profile's session sidecar names a DIFFERENT, still-alive owner
 * pid — another axiomate is running and holds the single-instance lock — fall
 * back to a per-pid profile so we don't collide. A stale record (owner dead, or
 * it's our own pid) keeps us on the stable profile, preserving logins.
 */
/**
 * Profile this process committed to on its FIRST attach. Once set, every later
 * attach in this process reuses it — even across detach (which deletes the
 * profile's session sidecar) — so a single axiomate's start/stop cycles always
 * land on the same profile and keep their logins. Without this, a detach that
 * cleared the sidecar could let another instance claim the stable profile in
 * the gap, bouncing our re-attach to a per-pid profile and losing the session.
 */
let committedProfileDir: string | undefined;

/** Test seam: forget the committed profile so each test picks fresh. */
export function __resetCommittedProfileForTesting(): void {
  committedProfileDir = undefined;
}

/**
 * Pick the profile dir for THIS attach.
 *
 * Prefer the stable shared profile so a single axiomate's start/stop debugging
 * cycles keep the user's logged-in session (cookies/Login Data persist there).
 * But if that profile's session sidecar names a DIFFERENT, still-alive owner
 * pid — another axiomate is running and holds the single-instance lock — fall
 * back to a per-pid profile so we don't collide. A stale record (owner dead, or
 * it's our own pid) keeps us on the stable profile, preserving logins.
 *
 * The choice is STICKY per process: the first attach's decision is remembered
 * and returned for all later attaches, so detach (which clears the sidecar)
 * can't let a racing instance bounce us off our profile.
 */
export function selectProfileDir(): string {
  if (committedProfileDir !== undefined) return committedProfileDir;
  const stable = isolatedProfileDir();
  const prior = readSessionState(stable);
  const ownedByOtherLive =
    prior &&
    typeof prior.ownerPid === "number" &&
    prior.ownerPid !== process.pid &&
    isPidAlive(prior.ownerPid);
  committedProfileDir = ownedByOtherLive ? perProcessProfileDir() : stable;
  return committedProfileDir;
}

/**
 * Path to the small JSON sidecar where we record the browser we launched
 * ({pid, port}). Lives INSIDE the profile dir so it's scoped to that profile.
 * On the next attach we read it to (a) reconnect to a browser that survived an
 * agent crash, or (b) kill a zombie that's still holding the profile's
 * single-instance lock. We never touch the profile's data files, so the user's
 * logged-in session (cookies/Login Data) persists across attaches.
 */
function sessionStatePath(userDataDir: string): string {
  return join(userDataDir, ".bridge-session.json");
}

interface PersistedSession {
  /** Chrome process pid. Absent in an "owned but detached" marker. */
  pid?: number;
  /** CDP port. Absent in an "owned but detached" marker. */
  port?: number;
  kind?: BrowserKind;
  /** axiomate process pid that launched this browser (≠ Chrome pid). Lets a
   *  later attach tell "I previously launched here" from "another live
   *  axiomate owns this profile". Older records without it are treated as
   *  ownerless (safe: falls through to the stale-clear path). A record with
   *  ownerPid but no pid/port is an OWNERSHIP marker: this live axiomate still
   *  owns the profile across a detach, so other instances avoid it, but there's
   *  no browser to reuse. */
  ownerPid?: number;
}

function readSessionState(userDataDir: string): PersistedSession | null {
  try {
    const raw = readFileSync(sessionStatePath(userDataDir), "utf8");
    const v = JSON.parse(raw) as Partial<PersistedSession>;
    const hasBrowser = typeof v.pid === "number" && typeof v.port === "number";
    const hasOwner = typeof v.ownerPid === "number";
    // Accept either a full browser record OR an ownership-only marker.
    if (hasBrowser || hasOwner) {
      return {
        pid: hasBrowser ? v.pid : undefined,
        port: hasBrowser ? v.port : undefined,
        kind: v.kind,
        ownerPid: hasOwner ? v.ownerPid : undefined,
      };
    }
  } catch {
    // Missing/corrupt — treat as no prior session.
  }
  return null;
}

function writeSessionState(userDataDir: string, s: PersistedSession): void {
  try {
    // Atomic write: a bare writeFileSync can be SIGKILLed mid-flush, leaving a
    // truncated sidecar. A truncated full-browser record reads back as null (no
    // prior session), so we'd LOSE a live zombie Chrome's recorded pid and
    // never be able to clearStaleLock it — fresh launches then silently forward
    // to the zombie and CDP never opens. Write to a temp file in the same dir,
    // then rename (atomic on one filesystem) so a reader sees either the whole
    // old file or the whole new one, never a partial.
    const dest = sessionStatePath(userDataDir);
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
    renameSync(tmp, dest);
  } catch {
    // Non-fatal: state-file write is an optimization, not correctness.
  }
}

/**
 * Detach-time release: drop the BROWSER half (Chrome pid/port — there's no live
 * browser to reuse after detach) but KEEP an ownership marker (ownerPid = us)
 * so other axiomate instances still see this profile as taken while WE are
 * alive. This honors "a single instance's start/stop cycles always share the
 * same profile": a racing instance can't grab our profile in the detach gap and
 * bounce our re-attach onto a per-pid profile. Full release happens only at our
 * process exit (clearSessionState). Defaults to the isolated profile dir.
 */
export function releaseProfileOwnership(
  userDataDir: string = isolatedProfileDir(),
): void {
  writeSessionState(userDataDir, { ownerPid: process.pid });
}

/**
 * Forget the recorded session entirely — removes both the browser record AND
 * our ownership marker, freeing the profile for any instance. Called at process
 * exit and on connect-failure cleanup. Also prevents the next attach from
 * trying to kill a pid the OS may have recycled. Defaults to the isolated
 * profile dir.
 */
export function clearSessionState(userDataDir: string = isolatedProfileDir()): void {
  try {
    rmSync(sessionStatePath(userDataDir), { force: true });
  } catch {
    // best effort
  }
}

/**
 * Is `pid` a live process we can see? process.kill(pid,0) is the safe
 * cross-platform liveness check in Node (ESRCH = gone, EPERM = alive but not
 * ours). Mirrors toolCalls.isSessionAlive's process half.
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
 * Confirm a CDP endpoint is not just an open socket but really a Chrome
 * DevTools endpoint, via GET /json/version. Guards reuse against another
 * process having grabbed the old port.
 */
async function isChromeCdp(port: number): Promise<boolean> {
  try {
    await discoverWebSocketUrl("127.0.0.1", port);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort check that `pid` is actually a Chromium-family browser process
 * (chrome/msedge/brave/vivaldi/opera/chromium/thorium/arc), NOT an unrelated
 * process the OS recycled the pid onto. Used to gate clearStaleLock's kill so a
 * stale sidecar pointing at a recycled pid can't make us terminate an innocent
 * process. Returns false when it can't confirm (command failed / unknown name)
 * — we'd rather skip a zombie-lock cleanup (recoverable: user sees a clear
 * "CDP did not become ready") than kill the wrong process (not recoverable).
 */
function isLikelyBrowserPid(pid: number): boolean {
  const NAMES = [
    "chrome",
    "msedge",
    "brave",
    "vivaldi",
    "opera",
    "chromium",
    "thorium",
    "arc",
  ];
  try {
    if (process.platform === "win32") {
      // tasklist with a PID filter; /FO CSV /NH = bare CSV rows. The image
      // name is the first quoted field.
      const r = spawnSync(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        { timeout: 4000, encoding: "utf8" },
      );
      const out = (r.stdout ?? "").toLowerCase();
      // "No tasks" message (or empty) → can't confirm → false.
      return NAMES.some((n) => out.includes(`${n}.exe`));
    }
    // POSIX: ps -o comm= -p <pid> prints just the command name.
    const r = spawnSync("ps", ["-o", "comm=", "-p", String(pid)], {
      timeout: 4000,
      encoding: "utf8",
    });
    const out = (r.stdout ?? "").toLowerCase();
    return NAMES.some((n) => out.includes(n));
  } catch {
    // Command unavailable/failed — cannot confirm; do NOT kill.
    return false;
  }
}

/**
 * Clear a stale single-instance lock left by a prior bridge browser that
 * didn't exit cleanly (agent crash without detach). The lock is what makes a
 * fresh launch on the same profile silently forward to the dead instance and
 * never open its own CDP port ("CDP did not become ready").
 *
 * Windows: the lock is held by the PROCESS, not a file — there's no Singleton*
 * artifact to delete (verified: an idle bridge profile has none). Killing the
 * zombie pid releases it. POSIX: Chrome also leaves Singleton{Lock,Socket,
 * Cookie} symlinks that can outlive the process; remove them too.
 *
 * Only kills the recorded pid when it's STILL a browser process — guards
 * against the OS having recycled that pid to an innocent unrelated process
 * after an unclean exit left a stale sidecar. Never deletes profile DATA.
 */
function clearStaleLock(
  userDataDir: string,
  prior: { pid: number; port: number },
): void {
  if (isPidAlive(prior.pid) && isLikelyBrowserPid(prior.pid)) {
    try {
      process.kill(prior.pid);
    } catch {
      // Already gone or not ours — best effort.
    }
  }
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

/**
 * `GET /json/version` returns the top-level browser-target debugger URL.
 * `chrome-remote-interface` does this internally on connect, but we expose
 * it for diagnostics and direct-WebSocket callers.
 */
export async function discoverWebSocketUrl(
  host: string,
  port: number,
): Promise<string> {
  const res = await fetch(`http://${host}:${port}/json/version`);
  if (!res.ok) {
    throw new Error(
      `CDP /json/version returned ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!body.webSocketDebuggerUrl) {
    throw new Error("CDP /json/version did not include webSocketDebuggerUrl");
  }
  return body.webSocketDebuggerUrl;
}

export interface LaunchResult {
  ok: boolean;
  pid?: number;
  binary?: string;
  kind?: BrowserKind;
  port?: number;
  reason?: string;
  /** True when we reconnected to a browser that survived (no new spawn). */
  reused?: boolean;
  /** Profile dir actually used (stable or per-pid) — for scoped cleanup. */
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
  // Stable profile when free; per-pid profile when another live axiomate owns
  // it (Chrome single-instance lock forbids sharing concurrently). A pinned
  // userDataDir (tests) overrides selection.
  const userDataDir = opts.userDataDir ?? selectProfileDir();
  // Reap leaked per-pid profile dirs from dead instances (SIGKILL or clean exit
  // both leave the dir). Best-effort, skip for pinned-dir test launches.
  if (opts.userDataDir === undefined) sweepDeadPerProcessProfiles();
  mkdirSync(userDataDir, { recursive: true, mode: 0o700 });

  // Reuse-or-clear: a prior bridge browser recorded in the profile's state
  // file may have (a) survived an agent crash — reconnect to it, keeping its
  // tabs and avoiding a needless relaunch — or (b) died but left the profile's
  // single-instance lock held, which would make a fresh launch silently
  // forward to the dead instance and never open CDP. Skip when the caller
  // pinned a port (tests) so this stays deterministic.
  if (opts.port === undefined) {
    const prior = readSessionState(userDataDir);
    // Only consider reusing/clearing a record we OWN (or a legacy ownerless
    // one). A record owned by a different LIVE axiomate means selectProfileDir
    // already routed us to a per-pid profile, so we won't see it here; but if a
    // different owner is DEAD, its browser is ours to clean up.
    const reusable =
      prior &&
      (prior.ownerPid === undefined ||
        prior.ownerPid === process.pid ||
        !isPidAlive(prior.ownerPid));
    if (prior && reusable) {
      // Only a full browser record (pid+port present) is reusable; an
      // ownership-only marker (our own, post-detach) has no browser to reconnect.
      if (
        prior.pid !== undefined &&
        prior.port !== undefined &&
        isPidAlive(prior.pid) &&
        (await isChromeCdp(prior.port))
      ) {
        return {
          ok: true,
          pid: prior.pid,
          binary: chosen.path,
          kind: prior.kind ?? chosen.kind,
          port: prior.port,
          reused: true,
          userDataDir,
        };
      }
      // Stale browser record (dead/unreachable): kill the zombie holding the
      // lock (+ POSIX Singleton symlinks). A marker with no pid has no zombie.
      if (prior.pid !== undefined) {
        clearStaleLock(userDataDir, { pid: prior.pid, port: prior.port ?? 0 });
      }
    }
  }

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
    // Record what we launched so the next attach can reuse it or clear its
    // stale lock. Only on a confirmed-ready launch with a real pid. ownerPid is
    // THIS axiomate so a concurrent instance can tell our profile is taken.
    if (pid !== undefined) {
      writeSessionState(userDataDir, {
        pid,
        port,
        kind: chosen.kind,
        ownerPid: process.pid,
      });
    }
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
  const userDataDir = isolatedProfileDir();
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

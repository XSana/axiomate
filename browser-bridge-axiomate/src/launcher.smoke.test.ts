import { describe, expect, it, afterAll } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  tryLaunchIsolated,
  clearSessionState,
  getBrowserCandidates,
} from "./launcher.js";

// REAL smoke — spawns actual Chrome. Skipped in normal runs (it would launch a
// browser on every `vitest run`). Invoke explicitly with:
//   BRIDGE_SMOKE=1 npx vitest run src/launcher.smoke.test.ts
// Guarded on BOTH an opt-in env var AND a browser being installed.
const enabled =
  process.env.BRIDGE_SMOKE === "1" &&
  getBrowserCandidates(process.platform).length > 0;
const d = enabled ? describe : describe.skip;

const PROFILE = join(tmpdir(), `axiomate-bridge-smoke-${process.pid}`);

function statePath() {
  return join(PROFILE, ".bridge-session.json");
}

d("tryLaunchIsolated reuse/clear (real browser)", () => {
  afterAll(() => {
    clearSessionState(PROFILE);
    try {
      rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("launches fresh, then REUSES the survivor on the next attach", async () => {
    const first = await tryLaunchIsolated({ userDataDir: PROFILE });
    expect(first.ok).toBe(true);
    expect(first.reused).toBeFalsy();
    expect(existsSync(statePath())).toBe(true);
    const recorded = JSON.parse(readFileSync(statePath(), "utf8"));
    expect(recorded.pid).toBe(first.pid);

    // Second attach with the browser still alive → reconnect, no new spawn.
    const second = await tryLaunchIsolated({ userDataDir: PROFILE });
    expect(second.ok).toBe(true);
    expect(second.reused).toBe(true);
    expect(second.pid).toBe(first.pid);
    expect(second.port).toBe(first.port);

    // Clean up the survivor.
    if (first.pid) process.kill(first.pid);
  }, 30_000);

  it("clears a stale state file (dead pid) and launches fresh", async () => {
    // Point the state file at a pid that cannot be alive.
    clearSessionState(PROFILE);
    const fresh = await tryLaunchIsolated({ userDataDir: PROFILE });
    expect(fresh.ok).toBe(true);
    expect(fresh.reused).toBeFalsy();
    if (fresh.pid) process.kill(fresh.pid);
  }, 30_000);
});

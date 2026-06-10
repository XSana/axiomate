import { describe, expect, it, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  tryLaunchIsolated,
  getBrowserCandidates,
  profileDir,
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

d("tryLaunchIsolated (real browser, per-pid profile model)", () => {
  afterAll(() => {
    try {
      rmSync(PROFILE, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("launches a fresh browser with a real pid + CDP-ready port", async () => {
    const first = await tryLaunchIsolated({ userDataDir: PROFILE });
    expect(first.ok).toBe(true);
    expect(typeof first.pid).toBe("number");
    expect(typeof first.port).toBe("number");
    expect(first.userDataDir).toBe(PROFILE);
    if (first.pid) process.kill(first.pid);
  }, 30_000);

  it("a second launch on the same profile dir spawns fresh again (no sidecar reuse)", async () => {
    const a = await tryLaunchIsolated({ userDataDir: PROFILE });
    expect(a.ok).toBe(true);
    if (a.pid) process.kill(a.pid);
    // Give the OS a moment to release the single-instance lock.
    await new Promise((r) => setTimeout(r, 1000));
    const b = await tryLaunchIsolated({ userDataDir: PROFILE });
    expect(b.ok).toBe(true);
    // Fresh spawn → a new pid (there's no reuse path anymore).
    expect(b.pid).not.toBe(a.pid);
    if (b.pid) process.kill(b.pid);
  }, 40_000);

  it("profileDir is per-process and stable within the process", () => {
    expect(profileDir()).toBe(profileDir());
    expect(profileDir().endsWith(`profile-${process.pid}`)).toBe(true);
  });
});

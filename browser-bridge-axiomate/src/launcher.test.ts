import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getBrowserCandidates,
  manualLaunchCommand,
  isolatedProfileDir,
  perProcessProfileDir,
  selectProfileDir,
  __resetCommittedProfileForTesting,
} from "./launcher.js";

vi.mock("node:fs", async () => {
  const real = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...real,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from "node:fs";

describe("getBrowserCandidates", () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
  });

  it("returns no candidates on linux", () => {
    expect(getBrowserCandidates("linux", {})).toEqual([]);
  });

  it("filters darwin candidates by existsSync", () => {
    vi.mocked(existsSync).mockImplementation((p: any) =>
      String(p).includes("Google Chrome.app"),
    );
    const out = getBrowserCandidates("darwin", {});
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("chrome");
  });

  it("orders darwin candidates: chrome before edge before brave", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const out = getBrowserCandidates("darwin", {});
    const kinds = out.map((c) => c.kind);
    expect(kinds.indexOf("chrome")).toBeLessThan(kinds.indexOf("edge"));
    expect(kinds.indexOf("edge")).toBeLessThan(kinds.indexOf("brave"));
  });

  it("requires env vars on win32", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    expect(getBrowserCandidates("win32", {})).toEqual([]);
  });

  it("expands win32 env vars", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const out = getBrowserCandidates("win32", {
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]?.path).toMatch(/Program Files.*chrome\.exe$/);
  });
});

describe("isolatedProfileDir", () => {
  it("lives under ~/.axiomate/browser-bridge", () => {
    expect(isolatedProfileDir()).toMatch(/[\\/]\.axiomate[\\/]browser-bridge[\\/]profile$/);
  });
});

describe("selectProfileDir (concurrent-instance isolation + sticky)", () => {
  beforeEach(() => {
    __resetCommittedProfileForTesting();
    vi.mocked(readFileSync).mockReset();
  });

  it("uses the stable profile when no prior session exists", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(selectProfileDir()).toBe(isolatedProfileDir());
  });

  it("uses the stable profile when the prior owner is OUR pid", () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ pid: 4242, port: 9999, ownerPid: process.pid }),
    );
    expect(selectProfileDir()).toBe(isolatedProfileDir());
  });

  it("falls back to a per-pid profile when another LIVE axiomate owns the stable one", () => {
    // process.ppid is reliably alive and isn't us — models a concurrent
    // instance. (pid 1 is ESRCH on Windows, so it can't stand in for "live".)
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ pid: 4242, port: 9999, ownerPid: process.ppid }),
    );
    expect(selectProfileDir()).toBe(perProcessProfileDir());
  });

  it("is STICKY: once committed to stable, a later 'owned-by-other' read can't bounce us off", () => {
    // First attach: profile free → commit to stable.
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(selectProfileDir()).toBe(isolatedProfileDir());
    // Simulate: we detached (sidecar cleared), another LIVE instance claimed it.
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ pid: 5, port: 1, ownerPid: process.ppid }),
    );
    // Re-attach must STILL return the stable profile — logins preserved.
    expect(selectProfileDir()).toBe(isolatedProfileDir());
  });
});

describe("manualLaunchCommand", () => {
  it("returns null on linux", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(manualLaunchCommand(9222, "linux")).toBeNull();
  });

  it("returns null on darwin when no candidate exists", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(manualLaunchCommand(9222, "darwin")).toBeNull();
  });

  it("includes port and profile flags on darwin", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const cmd = manualLaunchCommand(9222, "darwin");
    expect(cmd).toContain("--remote-debugging-port=9222");
    expect(cmd).toContain("--user-data-dir=");
    expect(cmd).toContain("--no-first-run");
  });
});

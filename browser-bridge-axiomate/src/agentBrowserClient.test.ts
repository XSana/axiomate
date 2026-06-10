import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the argv that runAgentBrowser hands to execa, so we can assert the
// flags it injects WITHOUT mocking the client itself (toolCalls.test.ts mocks
// the whole client, so it can't see argv — this file fills that gap).
const execaCalls = vi.hoisted(() => [] as Array<{ bin: string; argv: string[] }>);

vi.mock("execa", () => ({
  execa: vi.fn(async (bin: string, argv: string[]) => {
    execaCalls.push({ bin, argv });
    return { exitCode: 0, stdout: "", stderr: "" };
  }),
}));

vi.mock("./agentBrowser.js", () => ({
  resolveAgentBrowserPath: vi.fn(() => "/fake/agent-browser"),
}));

import { runAgentBrowser, AGENT_BROWSER_SESSION } from "./agentBrowserClient.js";

beforeEach(() => {
  execaCalls.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

function lastArgv(): string[] {
  return execaCalls[execaCalls.length - 1]!.argv;
}

describe("runAgentBrowser argv injection", () => {
  it("prefixes --cdp, --session, and --no-auto-dialog before the subcommand", async () => {
    await runAgentBrowser(["open", "https://x.test"], { cdpPort: 9222 });
    expect(lastArgv()).toEqual([
      "--cdp",
      "9222",
      "--session",
      AGENT_BROWSER_SESSION,
      "--no-auto-dialog",
      "open",
      "https://x.test",
    ]);
  });

  it("always sets --no-auto-dialog (hermes must_respond parity) even without a port", async () => {
    await runAgentBrowser(["snapshot"]);
    // No --cdp when port is omitted, but the dialog policy flag still rides along.
    expect(lastArgv()).toContain("--no-auto-dialog");
    expect(lastArgv()).not.toContain("--cdp");
    // Order: session flag precedes the subcommand.
    const i = lastArgv().indexOf("--no-auto-dialog");
    expect(i).toBeLessThan(lastArgv().indexOf("snapshot"));
  });

  it("maps a non-zero exit to ok:false with stderr surfaced", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 2,
      stdout: "",
      stderr: "boom",
    } as never);
    const r = await runAgentBrowser(["click", "@e1"], { cdpPort: 9222 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("boom");
  });
});

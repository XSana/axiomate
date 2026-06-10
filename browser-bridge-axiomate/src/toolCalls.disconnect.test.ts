import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake CdpClient defined inside vi.hoisted so it exists before the hoisted
// vi.mock factory below references it. It's a real EventEmitter (so the
// `.on('disconnect', fn)` wiring in handleAttach is exercised and tests can
// emit 'disconnect' to simulate the user quitting Chrome) and IS the mocked
// CdpClient class with a static connect, so `c instanceof CdpClient` holds.
const { FakeCdpClient, clients } = vi.hoisted(() => {
  // require inside hoisted: the top-level `import` is itself hoisted below this
  // block, so EventEmitter isn't bound yet when this factory runs.
  const { EventEmitter } = require("node:events");
  const instances: any[] = [];
  class FakeCdpClient extends EventEmitter {
    closed = false;
    static instances = instances;
    static connect = vi.fn(async () => {
      const c = new FakeCdpClient();
      instances.push(c);
      return c;
    });
    async send(): Promise<any> {
      return {};
    }
    async close(): Promise<void> {
      this.closed = true;
    }
  }
  return { FakeCdpClient, clients: instances };
});

vi.mock("./launcher.js", () => ({
  tryLaunchIsolated: vi.fn(async () => ({
    ok: true,
    kind: "chromium",
    port: 9222,
    pid: 4242,
  })),
}));

vi.mock("./cdpClient.js", () => ({ CdpClient: FakeCdpClient }));

import {
  __resetBridgeForTesting,
  dispatchBrowserBridgeTool,
} from "./toolCalls.js";

async function statusState(): Promise<string> {
  const r = await dispatchBrowserBridgeTool("browser_status", {});
  return JSON.parse((r.content[0] as any).text).state;
}

beforeEach(() => {
  clients.length = 0;
  FakeCdpClient.connect.mockClear();
});

afterEach(() => {
  __resetBridgeForTesting();
});

describe("browser-bridge disconnect detection", () => {
  it("reports detached after the CDP socket disconnects", async () => {
    const attach = await dispatchBrowserBridgeTool("browser_attach", {});
    expect(attach.isError).toBeFalsy();
    expect(await statusState()).toBe("attached");

    // User closes Chrome: chrome-remote-interface emits 'disconnect' on WS close.
    clients[0]!.emit("disconnect");

    expect(await statusState()).toBe("detached");
  });

  it("rejects tool calls needing a client after disconnect", async () => {
    await dispatchBrowserBridgeTool("browser_attach", {});
    clients[0]!.emit("disconnect");

    const snap = await dispatchBrowserBridgeTool("browser_snapshot", {});
    expect(snap.isError).toBe(true);
    expect((snap.content[0] as any).text).toMatch(/not attached/i);
  });

  it("allows re-attaching after a disconnect", async () => {
    await dispatchBrowserBridgeTool("browser_attach", {});
    clients[0]!.emit("disconnect");
    expect(await statusState()).toBe("detached");

    const reattach = await dispatchBrowserBridgeTool("browser_attach", {});
    expect(reattach.isError).toBeFalsy();
    expect(await statusState()).toBe("attached");
    expect(clients).toHaveLength(2); // a fresh client was created
  });

  it("ignores a stale client's late disconnect after reattach (guard)", async () => {
    await dispatchBrowserBridgeTool("browser_attach", {}); // clients[0]
    clients[0]!.emit("disconnect"); // detaches
    await dispatchBrowserBridgeTool("browser_attach", {}); // clients[1], live
    expect(await statusState()).toBe("attached");

    // The OLD client fires a late 'disconnect'. The session.client === client
    // guard must make this a no-op — the live session (clients[1]) survives.
    clients[0]!.emit("disconnect");
    expect(await statusState()).toBe("attached");

    // The LIVE client disconnecting still works.
    clients[1]!.emit("disconnect");
    expect(await statusState()).toBe("detached");
  });
});

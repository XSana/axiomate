# End-to-End Tests

Spawns the full CLI process (`bun dist/cli.js`) to verify checkpoint
commands end-to-end. These are **not** unit tests and **not** integration
tests that call internal APIs — they cross the process boundary and
exercise real Commander subcommand dispatch.

## Prerequisites

`dist/cli.js` must exist. Run `pnpm run build` first.

Each test creates an isolated temp project and checkpoint store via env
vars (`AXIOMATE_CHECKPOINT_BASE`, `AXIOMATE_CONFIG_DIR` set per spawn) so
no real user data is touched.

## Running

```bash
pnpm run build            # one-time, or after code changes
pnpm run test:e2e         # all e2e tests
pnpm run test:e2e -- --run checkpoint.cli.test.ts
```

## Why separate from integration?

- E2E is **slow** (seconds per test — full CLI boot)
- E2E is **fragile** (terminal quirks, color codes, async timing)
- E2E tests **run last** or on release — not per-PR

Integration tests at `../integration/` cover LLM-dependent flows.

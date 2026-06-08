# End-to-End Tests

End-to-end tests spawn the compiled CLI bundle (`agent/dist/cli.js`) with Bun
and drive real commands through the same process boundary a user hits from a
shell. These are **not** unit tests and **not** real-LLM integration tests; the
behavior under test crosses command registration, Commander dispatch, process
env wiring, and the real runtime entrypoint together.

Current coverage is focused on checkpoint CLI behavior:

- `axiomate checkpoints status`
- `axiomate checkpoints prune --force`
- `axiomate checkpoints clear --force`
- `axiomate checkpoints list` reading snapshots created through the real
  file-history/checkpoint store path
- `fileHistoryRewind` restoring a selected snapshot before checking the store
  through the CLI-visible checkpoint model

The checkpoint E2E suite uses internal file-history helpers to seed or verify
state that is not yet practical to create through a noninteractive CLI command.
Keep that helper usage narrow; the behavior being proved should still depend on
the spawned CLI boundary.

These tests do not exercise the interactive REPL, terminal key handling, or
real LLM/API calls. Those belong in a future E2E suite or in
`../integration/` if they need real model providers without spawning the CLI.

## Prerequisites

Run from the repository root unless noted otherwise.

- `agent/dist/cli.js` must exist. Run `pnpm run build` first, or
  `pnpm run build:agent` when support workspaces are already built.
- Bun must be available on `PATH`; the test harness runs
  `bun <absolute path to agent/dist/cli.js>`.
- Git must be available on `PATH`; checkpoint storage is git-backed.
- API keys and `agent/src/__tests__/integration/config/local.json` are not
  required.

Rebuild after changing CLI startup, Commander registration, checkpoint/file
history runtime code, or any code bundled into `agent/dist/cli.js`. If you only
changed tests or docs, rebuilding is not needed.

## Isolation

Every test creates a fresh temp workspace and checkpoint store. The test harness
sets these env vars per spawn:

- `AXIOMATE_CHECKPOINT_BASE=<temp>/cp`
- `AXIOMATE_CONFIG_DIR=<temp>/config`
- `AXIOMATE_CODE_DISABLE_FILE_CHECKPOINTING=0`

The spawned CLI runs with `cwd` set to the temp worktree. This keeps
`~/.axiomate`, the user's real config, and the user's real checkpoint store out
of the test path.

## Running

```bash
pnpm run build            # one-time, or after code changes
pnpm run test:e2e         # all e2e tests
pnpm run test:e2e -- checkpoint.cli.test.ts
```

From `agent/`, the equivalent commands are:

```bash
pnpm run build
pnpm run test:e2e
pnpm run test:e2e -- checkpoint.cli.test.ts
```

`pnpm run test:all` includes E2E tests. Use it for release confidence after the
CLI has already been built; use `pnpm run test` for the default fast unit suite.

## Why separate from integration?

- E2E is **slow** (seconds per test — full CLI boot)
- E2E is **fragile** (terminal quirks, color codes, async timing)
- E2E has a build artifact dependency (`agent/dist/cli.js`)
- E2E should run late in local/release verification, not on every save

Integration tests at `../integration/` cover LLM-dependent flows.

## Adding a new E2E test

Use E2E only when the behavior depends on the compiled CLI boundary. Prefer a
unit or integration test when direct function calls prove the behavior with less
setup.

Good E2E candidates:

- A new top-level CLI command or subcommand must be registered and dispatched
  correctly.
- Runtime behavior depends on process env, `cwd`, startup initialization, or
  the built artifact shape.
- A regression only appears when the CLI is spawned as a child process.

Avoid E2E for:

- Pure formatting, parsing, and validation logic.
- Real LLM behavior; use `../integration/`.
- UI-only slash-command rendering that can be tested through component or
  command-level unit tests.

Implementation conventions:

- Create all files under a temp root with `mkdtempSync(join(tmpdir(), ...))`.
- Pass isolation env vars explicitly to each spawned CLI process.
- Use `execFile`/argument arrays instead of shell strings.
- Keep per-test timeouts explicit; current checkpoint tests use `60_000`.
- Assert stable behavior, not full terminal output. CLI formatting can contain
  colors, spacing, and platform-specific details.
- Clean temp dirs in `afterEach` with retry-friendly removal.
- Do not import helpers from `../integration/`; shared helpers should live in a
  neutral test-helper location if a second E2E file needs them.

## Troubleshooting

- `agent/dist/cli.js` missing or stale: run `pnpm run build:agent`.
- `bun` not found: install Bun or fix `PATH`; the child process is launched via
  the `bun` executable.
- Git-related failures: verify `git --version` works in the same shell.
- Unexpected reads from real config/checkpoints: check that the test sets both
  `AXIOMATE_CONFIG_DIR` and `AXIOMATE_CHECKPOINT_BASE` before spawning.
- Timeout on a loaded machine: rerun the single file first. If it is
  consistently slow, increase that test's explicit timeout and document why.

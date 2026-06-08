# Integration Tests

Tests that exercise axiomate's core functions (`compactConversation`,
`runToolUse`, etc.) with **real** collaborators:

- **Real LLM** via the user's configured models (Qwen3 8B default, see
  [`config/testModels.ts`](./config/testModels.ts))
- **Real runtime pipeline** (provider → stream accumulator → repair →
  dispatch) wired through axiomate's actual code paths

These are **not** unit tests (no synthetic I/O isolation) and **not**
end-to-end tests (no CLI spawn, no REPL). They sit in the middle of the
test pyramid and catch classes of bugs unit tests can't:

- Prompt behavior changes in the wild (LLM stopped obeying our instructions)
- Runtime wiring regressions (refactor disconnected a component)
- Multi-step pipeline bugs (tool_use → repair → dispatch paths)

## Running

```bash
# Default `pnpm run test` excludes integration — these do NOT run automatically.
pnpm run test:integration         # run all integration tests (from repo root)
pnpm run test:api:integration     # run the real API fallback gate only
pnpm run gate:api:integration     # local API gate + real API fallback gate
pnpm run test:all                 # unit + integration + e2e in one go
pnpm run test:coverage:all        # coverage including integration + e2e
```

## Required setup

Integration tests use their own credentials file — they **do NOT read
from `~/.axiomate.json`**. This isolation prevents tests from
accidentally affecting your real production config or spending money
on your main account if a test has a bug.

### First-time setup

```bash
cd agent/src/__tests__/integration/config
cp example.json local.json
# edit local.json — fill in real API keys
```

`local.json` is **gitignored** at the project root. Never commit
it. Every developer sets up their own copy.

### Config structure

`local.json` mirrors the model-resource entries from `~/.axiomate.json`.
Each entry in `testModels.ts` (like `TEST_MODELS.summarization =
'Qwen/Qwen3-8B'`) must have a matching `models["Qwen/Qwen3-8B"]`
entry in `local.json`.

The real API fallback gate derives an unavailable primary endpoint from the
summarization model's provider settings, then falls back to the real
summarization model through `model.routes` and `auxiliary.sessionTitle`. You do
not need a second API key for that gate.

If a required model is missing, the test throws a clear setup message
pointing at the exact fix.

## Adding a new integration test

1. Decide if you need a real LLM or a mocked provider:
   - Real LLM: use `helpers/realLLMContext.ts` — tests prompt behavior
   - Mocked: use `helpers/mockedProvider.ts` — tests pipeline wiring given
     a specific response shape
2. If you need a new test-model category (e.g., vision), add it to
   `config/testModels.ts` and document why
3. Keep assertions **tolerant** — LLM output varies. Assert on structural
   properties (`expect(s).toContain('bug3')`, section headers present),
   not exact strings
4. Set a generous test timeout (e.g., 60s) for real-LLM tests; they're
   slow and may rate-limit

## When to run

- After landing any PR that modifies compact or jsonRepair / toolCall repair
- Before cutting a release
- Manually by developer triggering `pnpm run test:integration` — no CI
  auto-run (yet)

## Not in this folder

- Pure-synthetic unit tests → stay in `agent/src/**/__tests__/*.test.ts`
  colocated with source
- Full CLI process spawn tests → `../e2e/`
- Interactive REPL / terminal key-handling tests → future E2E coverage

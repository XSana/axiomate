# Doctor API / UI Plan

## Scope

This plan covers the product-facing API diagnostics shown from `/doctor`.
It is a consumer of the existing API recovery harness, not a new retry
mechanism. The retry architecture remains:

1. observe protocol/provider failure into semantic reason fields
2. decide recovery action from rules, policy, and model route configuration
3. execute retry/adaptation/fallback
4. emit structured recovery traces

`/doctor` turns those traces into user-readable failure cards.

Out of scope for this plan:

- changing retry rules
- adding new provider-specific error classifiers
- MCP/plugin/settings failure cards
- computer-use diagnostics
- persistent disk storage of API failure history

## Current State

Status as of 2026-05-30: Doctor API implementation is complete for the
session-local interactive UI slice. Remaining work is real-provider dogfood and
optional UI expansion policy, not core trace plumbing.

Architecture review note:

- Doctor API remains a trace consumer. It does not call `decideRecovery`, mutate
  `RecoverySession`, or choose retry/fallback behavior.
- Recovery rules can emit only decision outcomes such as `retrying`,
  `delegated`, `salvaged`, `fallback_triggered`, `failing`, and `aborted`.
  `recovered` is a trace-only execution outcome emitted after a retry succeeds.
- Policy-gate values in trace events are snapshots. Later retry attempts may
  recompute `reasonAllowed`/`actionAllowed`, but they must not rewrite earlier
  diagnostic events.
- Fallback availability is resolved as a structured per-observation value:
  current model, candidate model, optional denial reason, and policy snapshot.
  Route and auxiliary policy inputs are not mutated by the recovery loop.
- `blocked_by_policy` cards are reserved for final failures where model
  fallback was the relevant recovery path and route/task policy denied it.
  A recovered request remains recovered even if model fallback was disallowed.
- Stream-creation `model_not_found` uses a two-step trace: `withRetry` records
  the delegated handoff, then the stream boundary emits the formal
  `fallback_model` decision if route policy still permits it. If policy denies
  fallback, the retry-layer policy failure remains the only final trace.
- Recovery traces carry a monotonic in-process `sequence` field. Doctor uses it
  to order events emitted in the same millisecond before falling back to
  timestamp, decision id, observation id, and attempt number.

Implemented:

- `agent/src/services/api/apiRecoveryDiagnostics.ts`
  - process-local in-memory ring buffer
  - newest-first listing
  - 200-event bound
  - safe projection of `RecoveryTraceEvent`
  - no prompt, payload, API key, authorization header, raw provider body, or
    raw `innerCause` persistence
- `agent/src/screens/REPL.tsx`
  - wires `ToolUseContext.onRecoveryTrace` to `appendApiRecoveryTrace`
- `agent/src/services/api/apiFailureCards.ts`
  - groups events into user-facing `ApiFailureCard`
  - preserves multi-attempt timelines
  - maps semantic reason/action/intent to next actions
  - distinguishes request recovery from route-policy-blocked model fallback
- `agent/src/components/api/ApiProviderDoctorSection.tsx`
  - mounted from `Doctor.tsx`
  - uses the repo's built-in Ink `Box` / `Text` style
  - silent empty state
  - newest API cards first
- Tests:
  - ring-buffer bound, copies, safe-header filtering
  - multi-attempt grouping and fallback grouping
  - final auth failure severity/guidance
  - Doctor section empty/non-empty render shape
  - built-in Ink static-render coverage for card text, hidden-card footer,
    long timeline truncation, and narrow terminal smoke rendering

Validation run:

```bash
pnpm --dir agent exec vitest run src/__tests__/unit/services/api/apiRecoveryDiagnostics.test.ts src/__tests__/unit/services/api/apiFailureCards.test.ts src/__tests__/unit/components/api/ApiProviderDoctorSection.test.tsx src/__tests__/unit/query/recoveryTracePlumbing.test.ts src/__tests__/unit/services/api/contracts/retryTraceContract.test.ts src/__tests__/unit/services/api/contracts/auxiliaryRecoveryTraceContract.test.ts
pnpm --dir agent exec tsc --noEmit
git diff --check
```

## Data Contract

### Source Event

Input is `RecoveryTraceEvent`, emitted by:

- main streaming retry loop
- non-streaming fallback
- stream salvage / watchdog paths
- side queries
- auxiliary task runner
- verify connection
- token counting

### Stored Event

The Doctor store keeps `SafeApiRecoveryTraceEvent`, a deliberately smaller
projection:

- identity: timestamp, sequence, trace id, protocol, operation, route id,
  auxiliary task
- model path: model, from model, to model, chain index
- observation: reason, status code, retryable/compress/fallback booleans
- decision/execution: intent, action, outcome, rule id, mutation, delay
- timing: timeout kind/ms, stream phase, elapsed/TTFB, bytes received
- safe metadata: request id, allowlisted safe headers, policy gate
- sequence hints: attempt/max attempts, previous reason/action, final flag

Never store:

- prompts
- request/response payloads
- file contents
- tool inputs
- API keys
- `Authorization`, cookies, bearer tokens, or arbitrary headers
- raw provider error body
- raw `innerCause`

## UI Contract

`/doctor` shows an **API Providers** section only when recent API recovery
events exist. No success card is shown for a clean session.

Each card should answer:

- what failed
- where it failed
- what Axiomate tried next
- whether recovery succeeded, degraded, switched model, or stopped
- what the user can do now

Card fields:

- severity: `error`, `warning`, `info`
- title: short status such as `API request switched model`
- scope: route, auxiliary task, helper operation, or query source
- impact: main response, model validation, token counting, side query, etc.
- model path: `primary -> fallback` when available
- observed: semantic reason, HTTP status, request id
- recovery summary: action/mutation/fallback overview
- stopped reason: policy gate, exhausted budget, no fallback, abort, etc.
- next action: one concrete command/config/account action
- timeline: compact ordered attempt list
- advanced details: dim text only in the first slice

## Implementation Plan

### D1: Trace Store Hardening

Status: complete for the process-local `/doctor` slice.

Landed:

- Store is bounded to 200 safe events and returns newest-first copies.
- Stored events are sanitized before entering the Doctor projection.
- Listed events are defensive deep copies, including nested mutation arrays,
  safe headers, and policy-gate arrays.
- Trace `sequence` is preserved in the safe projection so same-millisecond
  events remain deterministic in Doctor cards.
- `/clear` and foreground session resume clear the process-local store so
  Doctor does not show stale API failures from a previous conversation.
- Current scope is intentionally process-local and session-local; no disk
  persistence is added for API failure history.

Remaining:

- decide whether buffer size 200 is correct after dogfood
- optionally add a session id/conversation id partition only if background
  sessions make the process-local view confusing during dogfood

### D2: Trace Coverage Audit

Status: complete by unit/contract coverage; real-provider dogfood remains.

Landed:

- Main query path can route API traces into the Doctor diagnostics store.
- `createSubagentContext` now inherits `parentContext.onRecoveryTrace` by
  default, so AgentTool/forked-agent API failures can reach the same store.
  Callers may still override or clear the sink explicitly.
- Existing hook/auxiliary tests confirm API query hooks pass the sink to
  `queryModelWithoutStreaming` and `runAuxiliaryTask`.
- Existing auxiliary trace tests confirm auxiliary recovery emits route/task
  metadata suitable for Doctor cards.
- `withRetry` now emits one stable trace id per retry session, while retaining
  `observationId` and `decisionId` per attempt, so Doctor groups a whole
  observe/decide/execute sequence into one card instead of one card per
  failed attempt.
- `withRetry` and `withAuxiliaryRecovery` now emit a trace-only `recovered`
  execution event when a retry/adaptation succeeds, so Doctor does not leave a
  completed recovery session displayed as still retrying.
- Route policy gates are recomputed for each observed failure reason and then
  snapshotted into each trace event, preventing one attempt's
  allow/deny result from leaking into another attempt's card.
- Stream-creation model-not-found fallback cannot bypass the same policy gate:
  retry emits a delegated handoff and the boundary emits the actual
  `fallback_model` decision only when a distinct fallback candidate and route
  policy allow it.
- Doctor grouping uses the trace event sequence for ordering, so delegated,
  recovered, and fallback-triggered events emitted in the same millisecond are
  projected in execution order.
- Main `withRetry` traces now carry the semantic operation (`stream`,
  `non_streaming_fallback`, `verify_connection`, etc.) when the caller knows it.
- Non-streaming fallback retries are tagged as `non_streaming_fallback`, not
  generic stream retries.
- Anthropic `verifyConnection` passes the recovery trace sink into the retry
  loop, so verification retries preserve observe/decide/execute details.
- OpenAI-compatible `verifyConnection` emits a safe Doctor trace for auth
  failures that return `false`, not only thrown transport errors.
- Projection tests cover representative Doctor cards for:
  - main streaming retry
  - non-streaming fallback
  - completed stream salvage
  - auxiliary side query fallback
  - token counting failure
  - provider verification failure
- Contract tests lock the observe/decide/execute boundary: Doctor consumes
  traces and `recovered` remains a trace-only execution outcome, not a
  recovery rule decision.

Tasks:

- dogfood main-loop streaming trace appears in `/doctor`
- dogfood non-streaming fallback trace appears in `/doctor`
- dogfood stream watchdog/salvage trace appears in `/doctor`
- dogfood auxiliary task failure trace appears in `/doctor`
- dogfood token counting failure trace appears in `/doctor`
- dogfood model `verifyConnection` failure trace appears in `/doctor`
- confirm whether SDK/print mode should intentionally stay outside the
  session-local Doctor store or get its own diagnostics output
- document any intentional non-interactive gaps, such as SDK/print mode

Output:

- one test or dogfood note per source path
- missing plumbing fixed without changing retry semantics

### D3: Card Projection Quality

Status: complete for current trace sources.

Landed:

- Request-mode fallback is distinct from model fallback
  (`switched_request_mode` vs `switched_model`).
- Fallback candidate metadata (`toModel`) is not treated as a completed model
  switch unless the executed action is `fallback_model`.
- Request-shape adaptation is distinct from ordinary retrying
  (`adapted_request`).
- Failed request-shape adaptation is shown as an error
  (`adaptation_failed`).
- Conversation compaction delegation is shown as delegated recovery, not as a
  provider failure (`delegated_recovery`).
- Route policy blocks are shown as policy-blocked failures with route guidance
  (`blocked_by_policy`).
- Regression fixtures cover:
  - `400 unsupported_parameter -> mutation -> retry`
  - `400 unsupported_parameter -> 502 server_error` in one retry session
  - adaptation followed by final failure
  - `request_compaction` delegation
  - policy-gated model fallback
  - stream fallback, salvage, auxiliary, token count, and verify connection
    source projections
- Provider-native `count_tokens` failures are projected as low-noise
  capability probes (`scope: capability:count_tokens`). Real
  `auxiliary.tokenCounting` model-chain failures remain visible as auxiliary
  failures.

Tasks:

- improve grouping for trace-less events outside the one-minute fallback window
- add regression fixtures for:
  - stream watchdog -> non-streaming fallback
  - dogfood-backed examples from real provider failures

### D4: User Guidance Copy

Status: route/config-field guidance pass complete.

Landed:

- Next actions now point to concrete user-visible surfaces where possible:
  concrete model/route paths such as `models["deepseek-main"].apiKey`,
  `models["deepseek-main"].model`, `models["deepseek-main"].baseUrl`,
  `models["deepseek-main"].protocol`, `models["deepseek-main"].vendor`,
  `models["deepseek-main"].template`, `models["deepseek-main"].supportsImages`,
  and `model.routes["quality-main"].fallbackChain` when the trace carries the
  relevant ids.
- If the trace lacks a concrete model or route id, the card falls back to
  template paths such as `models.<model>` and `model.routes.<route>`.
- `/model route show` is referenced for active route inspection.
- OpenAI Responses null-output guidance explicitly calls out
  protocol/baseUrl compatibility and chat-only gateway emulation.

Tasks:

- refine next actions after real dogfood
- add provider-specific but still safe hints for:
  - Anthropic thinking signature
  - image payload recovery exhaustion
  - provider policy block
- keep all copy centralized in `apiFailureCards.ts`

### D5: Doctor UI Polish

Status: complete for the first terminal card slice.

Landed:

- API Providers section stays silent when there are no traces.
- Cards are capped at the latest 5 groups.
- Timeline display is capped at the latest 3 attempts with an explicit
  `... N earlier` prefix when older attempts are hidden.
- A footer shows when additional API failure cards are hidden by the card cap.
- Formatting stays inside the existing built-in Ink `Box` / `Text` framework.
- Built-in Ink static-render tests cover ordinary and narrow terminal text.
- Safe advanced metadata renders as dim text for operation, protocol, route,
  auxiliary task, rule ids, and allowlisted headers.

Tasks:

- keep using built-in Ink `Box` / `Text`; do not introduce an external Ink
  renderer or browser-like layout.
- decide if advanced details should be:
  - always dim, current behavior
  - hidden behind debug/verbose mode
  - expanded by a keybinding in `/doctor`
- after dogfood, decide whether a verbose/expanded mode is worth adding

### D6: Provider Onboarding Integration

Status: complete for provider verification trace plumbing.

Landed:

- Provider onboarding verification now calls `verifyApiKey` with
  `appendApiRecoveryTrace`, so setup-time API failures can appear in the same
  `/doctor` card taxonomy.
- Unit coverage verifies the onboarding verification helper passes interactive
  mode, model id, and Doctor trace sink into the API verification path.

Tasks:

- dogfood a real failed provider setup and refine the card copy if needed

### D7: Full UI Test Harness

Status: complete for the current Doctor API card surface.

Landed:

- The repo already has a reliable built-in Ink static-render helper:
  `agent/src/utils/staticRender.tsx`.
- Doctor API UI tests render through that helper instead of inspecting only
  React element JSON.
- Coverage now includes:
  - empty state
  - final failed error card
  - recovered warning card
  - safe advanced metadata line
  - hidden-card footer
  - long timeline truncation
  - narrow viewport smoke rendering

Tasks:

- Add more degraded warning text-render fixtures only if dogfood shows copy
  regressions that element-level projection tests do not catch.

## Milestones

### M1: First Vertical Slice

Status: complete.

Deliverables:

- in-memory trace store
- REPL sink wiring
- failure-card mapper
- `/doctor` API Providers section
- unit tests and typecheck

### M2: Coverage Closure

Goal:

All API trace sources that already emit recovery traces can show up in Doctor
cards in an interactive session.

Exit criteria:

- main stream, non-stream fallback, stream watchdog/salvage, auxiliary, token
  count, and verify connection paths verified
- no retry semantic changes

### M3: Product Copy Pass

Goal:

The card tells a first-time user what happened and what to do next without
reading debug logs.

Exit criteria:

- next actions point to real commands/config fields
- route/model/baseUrl/provider account guidance is specific enough
- sensitive data redaction remains enforced by tests

### M4: Doctor UI Polish

Goal:

API cards are readable in the existing terminal UI under normal and narrow
layouts.

Exit criteria:

- timeline noise controlled
- advanced details policy documented as always-dim for the first shipped slice
- built-in Ink UI tests cover key states

## Acceptance Criteria

- `/doctor` diagnoses recent API failures without requiring debug logs.
- Cards preserve observation, decision, execution, and final outcome.
- Multi-attempt failures are shown as one recovery session.
- Recovered/degraded cases are visually distinct from final failures.
- Every card has one concrete next action.
- No sensitive request data can appear in the store, mapper, or UI.
- The implementation stays aligned with the existing built-in Ink UI framework.

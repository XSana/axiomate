# API Harness Dogfood Risk Note

Status: ready for dogfood, not risk-free.

The LLM API harness core is now in the closeout phase. Main requests,
route fallback, side-query auxiliary calls, full-query auxiliary calls,
stream-consumption recovery, request-shape adaptation, and Doctor API
diagnostics share the same observe -> decide -> execute recovery model.

This document records the risks users may still hit during dogfood so that
future fixes stay semantic and do not reintroduce broad retries or hidden
fallback behavior.

## What Is Ready

- Main conversation requests use the route chain and provider retry harness.
- Model switching is decided by recovery observations and policy gates, not
  by model config executing fallback by itself.
- `queryAuxiliaryTask()`, goal judge, away summary, prompt hooks, skill
  improvement, and `apiQueryHookHelper` now pass auxiliary task, route, chain
  index, policy gate, retry budget, and timeout metadata into the same
  recovery trace session.
- Task-tagged `sideQuery()` and `runAuxiliaryInference()` use the auxiliary
  recovery runner.
- Provider-native `count_tokens` failures are shown as capability probes in
  `/doctor`; real `auxiliary.tokenCounting` failures remain visible as
  auxiliary failures.
- `/doctor` distinguishes main route failures, auxiliary failures,
  background cancellations, request-mode fallback, model fallback, request
  mutation, validation probes, and capability probes.

## Expected Dogfood Risks

1. Provider-specific error envelopes may still be under-classified.

   OpenAI-compatible gateways often emit nonstandard 400/404/52x bodies. If
   `/doctor` shows `unclassified provider error`, the fix should usually be a
   narrow classifier fixture, not a wider retry rule.

2. Auxiliary defaults are usable but not cost-optimal.

   First onboarding creates a main route and normalization fills auxiliary
   tasks from that main model. This keeps new users unblocked, but
   `promptSuggestion`, `sessionTitle`, `tokenCounting`, and `goalJudge` may
   waste money or feel slower until users configure cheap fast auxiliary
   models.

3. Validation probes are intentionally not full route fallback.

   `verifyConnection` checks whether a configured model/provider works. It
   emits recovery traces and uses bounded retry where appropriate, but it is a
   setup-time validation probe rather than a main conversation fallback chain.

4. Explicit single-model paths remain explicit.

   `queryWithModel()`, explicit `hook.model`, and agent generation with an
   explicit model do not walk the configured route fallback chain. They still
   use provider-level API recovery, but model choice is intentionally pinned.

5. Non-LLM external APIs are outside this harness.

   MCP HTTP, web search providers, voice transcription, plugin downloads, and
   other external product APIs need their own diagnostics policy. They should
   not be silently merged into the LLM recovery table without a separate
   observe/decide/execute contract.

6. Doctor should be treated as a truth source, not a warning counter.

   Dogfood feedback should include the `/doctor` card, the query source, the
   route or auxiliary task, the observed reason, and the action/outcome. A
   card with `scope: capability:count_tokens` or a background prompt
   suggestion abort may be informational rather than user-actionable.

## Dogfood Acceptance Bar

- A successful main response should not leave a misleading main-route warning
  for an unrelated background request.
- Empty streams should only trigger retry when the failing stream actually
  produced no assistant output for that request.
- Non-streaming fallback should only happen for explicit streaming mode or
  stream-endpoint failure signals, not generic empty output.
- Model fallback should only happen when the observed reason, action gate, and
  reason gate all allow it.
- Provider-native token-count failures should not be reported as main API
  failures.
- New provider cases should add tests or fixtures before broadening rules.

## Recommended First User Trial

Use a small trusted group before a broad release.

Ask users to:

- run normal main-chat tasks against at least one OpenAI Chat-compatible
  provider, one OpenAI Responses-compatible provider, and one Anthropic
  provider if available;
- configure at least one cheap `auxiliary.promptSuggestion` and
  `auxiliary.goalJudge` model after onboarding;
- report any `/doctor` card that looks unrelated to the visible failure;
- report slowdowns with the card timeline so retries, request mutation, and
  model switches can be separated from provider latency;
- avoid treating every Info card as a bug unless it contradicts what happened
  in the UI.

## How To Fix New Findings

- Add a narrow fixture for the provider envelope or trace sequence.
- Keep observe, decide, and execute changes separate.
- Prefer `auxiliary` task policy changes for auxiliary cost/latency problems.
- Prefer classifier or rule-table changes for stable provider error shapes.
- Avoid widening non-streaming fallback or model fallback just to make one
  gateway pass; broad recovery is the main way this harness becomes slow and
  expensive again.

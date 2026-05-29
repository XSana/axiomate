# Axiomate API Reliability Engineering Plan

This plan tracks API-related gaps from `docs/axiomate-productization-stability-report.html`.
Scope is only the three LLM protocol paths:

- `openai-chat`
- `openai-responses`
- `anthropic`

Computer-use and broader productization work are out of scope for this plan.

## Architecture Rule

API recovery must follow one chain:

`error envelope fixture -> ErrorFailoverReason -> RecoveryIntent -> RecoveryAction -> retry context mutation -> recovery trace -> contract test`

No new provider string pattern or recovery action should be added without a contract case.
Deterministic request compatibility changes that do not depend on a failed
attempt must go through the small preflight registry in
`apiRequestPreflight.ts`; those rules need stable ids, protocol/model gates, and
unit coverage. If the behavior is failure-driven, it belongs in the semantic
observe/decide/execute path instead.

The detailed intake rule for newly observed provider errors lives in
`docs/api-provider-envelope-fixture-policy.md`. In short, every new provider
envelope must land as:

`provider envelope -> error fixture -> ErrorFailoverReason -> RecoveryIntent -> RecoveryAction -> retry context mutation -> recovery trace -> contract test`

The retry architecture is split into six responsibilities:

- Observation: `RecoverySession.observeFailure()` records every failed attempt with
  semantic reason, status, retryability, previous reason, first-failure flags, and
  consecutive-same-reason count. It normalizes protocols to `openai-chat`,
  `openai-responses`, `anthropic`, or `axiomate-generic`.
- History: `RecoverySession.history` exposes observations, decisions,
  previous decision, and helper counters. Decisions can now reason over a
  changing sequence such as first `400 unsupported_parameter`, then `502`.
- Decision: `decideRecovery()` consumes the latest observation plus session context
  and produces a single `RecoveryDecision`.
- Rule registry: `recoveryRules.ts` contains the declarative semantic recovery
  table. Hermes/OpenAI/Anthropic corner cases should land here as rules, not as
  new retry-loop branches. Every rule declares reasons, protocols, intent,
  allowed actions, repeat policy, and no-decision behavior.
- Intent: `RecoveryIntent` records the semantic recovery purpose. Product
  diagnostics should read intent first, then action/mutation details.
- Execution: `withRetry()` applies the decision by mutating `RetryContext`,
  sleeping/backing off, delegating, failing, aborting, or triggering model fallback.
- Orchestration: `withRetry()` owns the outer attempt loop and emits trace after
  every decision, including failed recovery decisions.

## Current Position vs Productization Report

As of 2026-05-29, the API part of
`docs/axiomate-productization-stability-report.html` is no longer a blank gap.
The core reliability architecture is in place:

- semantic observation / history / decision / execution split
- declarative recovery rule table
- recovery intent/action taxonomy
- request mutation flags for the three protocol paths
- deterministic request preflight registry for narrow provider compatibility
  guards
- golden request, stream, error, and trace fixtures
- stream watchdog trace and non-streaming fallback trace
- unified API timeout policy labels and budgets for stream idle,
  non-streaming fallback, and auxiliary API paths
- stream-creation generic 404 fallback trace contract
- direct API error request id and inner-cause trace capture
- SDK retry suppression so provider failures reach Axiomate's classifier
- auxiliary trace plumbing for side-query, inference, token counting, model
  validation, compact, session search, and related product helpers

The remaining API gaps are concentrated in product-facing diagnostics and
optional product policy choices:

1. Product diagnostics: recovery traces exist, but `/doctor` does not yet render
   API failure cards.
2. Optional provider/runtime policies: credential-pool rotation if Axiomate
   adopts pooled credentials, and additional provider-specific request
   sanitizers as new fixtures appear.

The API harness core now covers the previous three gaps: OpenAI Responses
null-output / malformed-response recovery, Hermes-style partial stream
continuation, and bounded semantic retry for selected foreground auxiliary
side queries.

## Hermes Resilience Intake Matrix

This matrix tracks the Hermes "resilience / tenacity" API lessons that were
audited from `C:\public\workspace\hermes-agent`.

| Hermes lesson | Axiomate status | Evidence / next action |
|---|---|---|
| Central error classifier plus structured recovery hints | Absorbed | `errorClassifier.ts`, `recoveryRules.ts`, `recoveryDecision.ts`, `withRetry.ts`. Axiomate now has a stricter observe/decide/execute split than Hermes' original retry loop. |
| 400/502 request-validation bodies should not flood generic 5xx retries | Absorbed | `unsupported_parameter` extracts omittable fields and retries with one mutation. Contract fixtures cover 400 and 502. |
| Unsupported temperature / request fields should be omitted semantically | Absorbed | `omit-unsupported-request-fields` is repeatable only for newly discovered fields. |
| `invalid_encrypted_content` on Responses reasoning replay | Absorbed | Axiomate strips Responses reasoning replay and encrypted-content include once; Responses null-output salvage is now covered separately. |
| Multimodal tool-result content rejected by OpenAI-compatible providers | Absorbed | `multimodal_tool_content_unsupported` downgrades tool result content to text. |
| llama.cpp `json-schema-to-grammar` rejects `pattern` / `format` | Absorbed | `llama_cpp_grammar_pattern` strips schema keywords before retry. |
| Anthropic thinking signature, long-context tier, OAuth long-context beta | Absorbed | `thinking_signature`, `long_context_tier`, and `oauth_long_context_beta_forbidden` have explicit rules and traceable actions. |
| Anthropic / provider image payload too large | Absorbed | `image_too_large` now selects an `ImageRecoveryProfile`, records `rewrite_image_payload_for_retry`, rewrites only the retry-local request payload through profile-specific image budgets, and fails exhausted if the same semantic error repeats. |
| Time-to-first-byte / stalled stream watchdog | Absorbed for API core | Axiomate emits stream watchdog retry traces with request id, headers, bytes, TTFB, phase, inner cause, and `stream_idle_timeout` policy fields. First-byte policy labels exist in the timeout table for future first-byte watchdog wiring if needed. |
| OpenAI Responses stream parser hits `response.output = null` / `NoneType not iterable` | Absorbed | `responses_null_output` and `malformed_response` classify semantically; completed Responses streams can be salvaged without inventing tool calls; malformed non-streaming output throws `LLMAPIError(502)` for retry. |
| Mid-tool-call partial stream should route through length continuation | Absorbed | Axiomate throws `PartialStreamRecoveryError`, creates a `partial-stream-stub` assistant message after retry exhaustion, records dropped tool names, and drives a continuation turn instead of replaying incomplete tool calls. |
| Stale-call / silent-reject patterns should surface actionable hints | Missing product layer | Trace has enough raw fields, but `/doctor` / session diagnostics do not yet turn known silent-reject patterns into user actions. |
| Responses request timeout sizing and stale-call defaults | Absorbed for API core | `apiTimeoutPolicy.ts` centralizes timeout semantics: stream labels, non-streaming fallback budgets, `API_TIMEOUT_MS` override, auxiliary source-aware budgets, parent-abort handling, and trace fields `timeoutKind` / `timeoutMs`. |
| Auxiliary main-model fallback and payment/rate-limit fallback | Partially absorbed | Selected foreground side queries now use `withAuxiliaryRetry()` with observe/decide/execute semantics, one bounded retry, request mutation support, and no duplicate provider trace. Model fallback / credential-pool fallback remain product decisions. |
| Generic 404 without a model-not-found signal should not switch models | Absorbed | Generic 404 now classifies as retryable `unknown`; explicit model-not-found bodies still classify as `model_not_found`. Stream creation routes generic 404 immediately to the outer non-streaming fallback delegate instead of burning retry attempts or switching models. |
| Message-only 413 / payload-too-large wrappers | Absorbed | `payload_too_large` now recognizes message-only `request entity too large`, `payload too large`, and `error code: 413` shapes. |
| SDK `RateLimitError` without HTTP status | Absorbed | Constructor-name detection maps it to semantic `rate_limit` with status 429. |
| Wrapped `metadata.raw` provider bodies | Absorbed | Classifier extracts pattern text and error codes from nested `metadata.raw` JSON, including OpenRouter-style upstream provider envelopes. |
| xAI OAuth `service_tier` strip and slash-enum sanitization | Absorbed for API core | `service_tier` is both omittable through `unsupported_parameter` recovery and stripped deterministically for Grok Responses preflight. Grok slash-enum failures now flow through `slash_enum_unsupported -> sanitize_slash_enum_schema -> strip_slash_enums -> RetryContext.stripSlashEnums -> trace/fixture`, with preflight kept as a narrow deterministic compatibility guard. |
| Credential-pool rotation on exhausted credentials / weekly usage limits | Not implemented / product decision | Axiomate does not currently have Hermes-style pooled credentials in the API core. If added, it must become a recovery action, not an inline retry-loop branch. |
| OAuth 401 actionable guidance | Missing product diagnostics | Core classifier has auth semantics. Product-facing guidance belongs in `/doctor` API failure cards. |

## Productization Report API Gap Matrix

| Report requirement | Current status | Remaining work |
|---|---|---|
| Unified recovery action table across OpenAI Chat, OpenAI Responses, and Anthropic | Mostly complete | Keep all new provider patterns behind `ErrorFailoverReason -> RecoveryIntent -> RecoveryAction -> trace -> fixture`. |
| OpenAI Chat request/error/stream/retry contract matrix | Mostly complete | Add only narrow edge fixtures as new envelopes appear. The original P0 cases are covered: stream unsupported, endpoint 404, model-not-found fallback, max-token drop, unsupported field omission, rate limit, 502 validation, server error, and stream-fallback negatives. |
| OpenAI Responses as its own protocol, not just Chat with different fields | Mostly complete | Event-order fixtures, encrypted replay recovery, semantic null-output / malformed-response recovery, and safe completed-stream salvage exist. Add only narrow edge fixtures as new envelopes appear. |
| Anthropic Hermes-derived failure classes | Mostly complete | Image-too-large retry is implemented. Keep adding fixtures for new subscription or payload envelope shapes. |
| Side query / verify / compact / token counting share taxonomy | Mostly complete | Selected foreground side queries now use bounded semantic retry; token counting remains fallback-to-local-estimation; verify keeps its existing bounded verification loop. |
| Every recovery action emits structured trace | Core complete | `/doctor` or session diagnostics must consume traces so users can see reason, mutation, delay, fallback, and final outcome. |
| Golden fixtures for request body, stream chunks, error envelopes, retry traces | Mostly complete | Enforce as a release gate, not only as local tests. Keep adding fixtures when new provider envelopes appear. |
| Rate-limit / overload policy | Mostly complete | `retry-after`, foreground gating, jitter, and repeated-529 fallback exist. Credential-pool rotation is missing because pooled credentials are not part of current API core. |
| Stream diagnostics | Mostly complete | Stream-idle traces now carry timeout policy labels. A separate first-byte watchdog remains optional if product diagnostics need that distinction operationalized, not only represented in the policy table. |
| API failure cards in `/doctor` | Missing | Build a product-facing consumer for recovery trace events and map intents/actions to user-readable next steps. |

## Status

### M0: Recovery Contract v1

Status: complete.

Delivered:

- `recoveryAction.ts`: unified recovery action names.
- `recoveryIntent.ts`: semantic recovery intent names for trace, `/doctor`, and reports.
- `recoverySession.ts`: structured per-request recovery observation history.
- `recoveryRules.ts`: extensible semantic recovery rule registry.
- `recoveryDecision.ts`: pure outer recovery decision policy over observation history and retry context.
- `recoveryTrace.ts`: structured recovery trace events.
- `withRetry.ts`: outer retry loop plus execution of recovery decisions.
- `llm.ts`: passes provider protocol name into retry options.
- Unit coverage for recovery action mapping and trace emission.
- Rule registry coverage requiring stable ids, one-shot behavior, context patches,
  and mutations for semantic recovery rules.
- Recovery trace includes both semantic intent and concrete action.

Acceptance:

- API unit tests pass.
- Type checking passes.
- Existing retry semantics stay compatible.

### M0.5: Recovery Contract v2

Status: complete.

Delivered:

- `RecoveryProtocol`: explicit protocol type with `axiomate-generic` as legacy
  generic mode. `axiomate` is no longer used as an ambiguous wildcard.
- `RecoveryHistory`: history view with previous observation, previous decision,
  rule/action/intent counters, and last-decision lookup helpers.
- `RecoveryRule` v2 schema:
  - `reasons`
  - `protocols` or `any`
  - `intent`
  - `actions`
  - `repeatPolicy`
  - optional precondition / no-decision behavior / rule-local decision builder
- Rule invariants:
  - unique stable ids
  - every rule declares protocol scope and repeat policy
  - dynamic rule decisions must return the owning rule id, expected intent,
    expected repeat policy, and one of the rule's allowed actions
  - mutation-style rules use one-shot or delegate-once repeat policy
- History-aware decisions:
  - one-shot semantic recoveries become `fail_recovery_exhausted` when repeated,
    rather than falling back to generic retry/backoff
  - repeatable unsupported-field recovery only mutates newly discovered fields
  - context-overflow output-budget recovery avoids repeating the same max-token
    override until the reason changes
- Trace v2 fields:
  - `traceId`
  - `observationId`
  - `decisionId`
  - `ruleId`
  - `repeatPolicy`
  - `previousIntent`
  - `previousAction`
  - `final`
- Contract tests:
  - `recoveryArchitectureContracts.test.ts`
  - updated rule registry tests
  - updated `withRetry` history trace tests
  - updated OpenAI Chat retry-trace golden fixture

Acceptance:

- `pnpm --filter ./agent exec vitest run src/__tests__/unit/services/api`
  passes.
- `pnpm --filter ./agent run build:types` passes.

### M1: Semantic Error Taxonomy and Hermes Corner Cases

Status: complete for foundation; more cases can now be added as fixtures.

Delivered:

- Added first-class semantic reasons:
  - `unsupported_parameter`
  - `invalid_encrypted_content`
  - `multimodal_tool_content_unsupported`
  - `llama_cpp_grammar_pattern`
  - `oauth_long_context_beta_forbidden`
  - `image_too_large`
  - `provider_policy_blocked`
  - `slash_enum_unsupported`
- Added recovery actions:
  - `omit_request_fields`
  - `strip_reasoning_replay`
  - `downgrade_multimodal_tool_content`
  - `strip_json_schema_keywords`
  - `disable_long_context_beta`
  - `rewrite_image_payload`
  - `strip_slash_enums`
- Added retry context mutation flags consumed by OpenAI Chat, OpenAI Responses, and Anthropic request construction.
- Added contract table at `agent/src/__tests__/unit/services/api/contracts/apiRecoveryContracts.test.ts`.
- Added Hermes-derived request-edge cases for generic 404, message-only 413,
  status-less `RateLimitError`, wrapped `metadata.raw` bodies, xAI/Grok
  `service_tier`, and Grok slash-enum schema sanitization.
- Added `apiRequestPreflight.ts` for deterministic request compatibility rules
  that should run before the first failed attempt. The current rule strips
  Grok Responses `service_tier` and slash-containing schema enum values behind
  explicit protocol/model gates.

Acceptance:

- Hermes-derived corner cases classify to semantic reasons, not generic `format_error` or `unknown`.
- Recoverable cases mutate the next request once, then fail fast if the same semantic error repeats.
- Non-recoverable policy/account errors fail fast and do not trigger misleading model fallback.

### M2: OpenAI Chat Contract Matrix

Status: report P0 matrix mostly complete; request/error/trace fixture foundation
and core stream chunk fixtures complete.

Covered now:

- Golden request-body fixtures for normal stream retries and request mutations:
  drop `max_tokens`, omit unsupported fields, strip unsupported JSON schema
  keywords, and downgrade multimodal tool results.
- Golden error-envelope fixtures for Chat fallback routing and semantic recovery.
- Golden retry trace fixtures for core Chat request mutations.
- `400 stream unsupported` remains eligible for non-streaming fallback.
- `404 stream endpoint missing` remains eligible for non-streaming fallback.
- `404 model_not_found` routes to model fallback instead of non-streaming fallback.
- Generic stream-creation `404` produces a delegated recovery decision trace at
  `client_init`, then an outer non-streaming fallback trace with request id and
  cause.
- `400 max_tokens too large` drops `max_tokens` once.
- `400/502 unsupported parameter` omits the named request field once.
- Transport, timeout, rate-limit, overload, server error, context overflow, thinking signature, and long-context tier are negative cases for non-streaming fallback.
- llama.cpp grammar errors strip JSON schema `pattern` / `format` before retry.
- Stream chunk golden fixtures cover started stream, partial text stream flush,
  inline malformed error envelope, and empty stream.
- Partial tool-use stream commits are explicitly protected from non-streaming
  fallback replay.

Remaining:

- Keep adding edge fixtures when new OpenAI-compatible provider envelopes appear.
- Optional: expand `deferModelNotFoundFallback` fixtures to spell out every
  with/without-fallback and model-name/no-model-name variant, even though the
  core routing behavior is already covered.

### M3: OpenAI Responses Protocol Recovery

Status: core stream contract complete; Hermes null-output salvage and semantic
malformed-response expansion implemented.

Covered now:

- `invalid_encrypted_content` strips Responses reasoning replay and omits encrypted-content include before retry.
- Empty/malformed non-streaming response now throws semantic `LLMAPIError(502)`
  and classifies as `responses_null_output` or `malformed_response` where
  applicable.
- Responses request adapter already preserves reasoning round-trip when valid.
- Event-order golden fixtures cover:
  - `response.created`
  - `response.output_item.added`
  - `response.content_part.added` / `.done`
  - text deltas
  - function-call argument deltas
  - reasoning summary deltas with encrypted round-trip metadata
  - completed responses with incomplete status / max-token stop reason
  - `response.incomplete` stream error
  - malformed text delta before message item
- Responses stream-shape failures remain eligible for non-streaming fallback
  before assistant output is committed.
- Responses stream-shape fallback is disabled after assistant output is
  committed, matching the Chat duplicate-tool-execution guard.
- Responses stream creation 404 now defers model fallback like Chat, preserving
  outer non-streaming fallback routing.
- Responses non-streaming fallback now rejects empty content with
  `LLMAPIError(502)`, keeping it in retryable `server_error` semantics instead
  of returning an empty assistant message.
- Added first-class `responses_null_output` and `malformed_response`
  classifier reasons.
- `retry-malformed-responses-output` retries malformed Responses output with
  an `until_reason_changes` repeat policy.
- Completed Responses streams can emit `salvage_stream_output` /
  `salvage_completed_stream_output` trace and finish from already received
  stream content if the parser only fails on terminal `response.output=null`.
- Salvage never fabricates missing tool calls; partial tool-call drops are
  handled by the separate partial-stream continuation path.

Remaining:

- Add narrow fixtures for any newly observed Responses malformed-output
  envelopes.

### M4: Anthropic-Specific Recovery

Status: core recovery loop complete; remaining items are narrower fixtures.

Covered now:

- `thinking_signature` disables thinking and retries.
- `long_context_tier` maps to explicit semantic recovery:
  `lower_long_context_tier -> lower_context_tier`.
- `lower_context_tier` is carried through `RetryContext`,
  `CannotRetryError`, assistant API-error metadata, query reactive compact,
  and `autoCompactIfNeeded()`.
- Reactive compact can now run in forced mode for `lower_context_tier`, so the
  Anthropic long-context tier gate can compact and retry even when the normal
  model-window threshold would decline proactive autocompact.
- Forced reactive compact preserves the existing safety rails: global compact
  disable, compact/session-memory recursion guards, and consecutive-failure
  circuit breaker.
- Compaction diagnostics now record `recoveryAction` and `forced` for API-driven
  reactive compaction.
- `oauth_long_context_beta_forbidden` removes context beta headers and retries once.
- Image-too-large classifies separately and retries once through
  `rewrite_image_payload_for_retry` instead of blind retrying.
- `ImageRecoveryProfile` maps provider wording to deterministic retry-local
  image rewrite policies:
  `fit_provider_image_limit`, `fit_many_image_dimension_limit`,
  `aggressive_size_compression`, and
  `drop_or_textualize_tool_result_images`.
- The rewrite executor mutates only the next request payload. It does not change
  persisted conversation history, and repeat `image_too_large` fails as
  exhausted recovery.
- OpenAI Chat, OpenAI Responses, and Anthropic request builders all consume the
  same `rewriteImagePayload` retry context flag and profile.
- Anthropic contract fixtures now cover thinking-only streams as committed
  responses, preventing them from being treated like empty/malformed streams.
- Anthropic request contract fixtures now cover tool content block ordering:
  `tool_result` blocks are normalized before ordinary user text before crossing
  the provider boundary.

- Add any newly observed Anthropic subscription / payload envelopes as contract
  fixtures before adding patterns.

### M5: Stream Reliability Observability

Status: foundation and watchdog trace fixtures complete.

Covered now:

- `RecoveryTraceEvent` supports stream observability fields:
  - `requestId`
  - `ttfbMs`
  - `elapsedMs`
  - `bytesReceived`
  - `streamPhase`
  - `innerCause`
  - `safeHeaders`
- `withRetry()` can consume a request-scoped `RecoveryTraceContext` and attach
  those fields to every recovery decision trace.
- `withRetry()` also copies request ids and direct `LLMAPIError` summaries from
  the thrown error when no stream context is available, so creation-time failures
  are still attributable.
- Safe header filtering keeps diagnostic headers such as retry-after, request
  id, OpenAI rate-limit headers, and Anthropic rate-limit headers while dropping
  credentials.
- Main stream orchestration writes existing lifecycle signals into the trace
  context:
  - attempt start
  - response headers
  - TTFB
  - streaming
  - stream complete
  - fallback
- Anthropic stream request id and response headers flow through the existing
  provider result path.
- OpenAI Chat and Responses stream paths now attempt to surface SDK request ids
  when the SDK exposes them.
- OpenAI Chat, OpenAI Responses, and Anthropic stream paths emit provider-neutral
  byte-count events from raw stream chunks/events. `llm.ts` accumulates them into
  `RecoveryTraceContext.bytesReceived`.
- The inner stream-consumption retry path in `llm.ts` now emits a recovery trace
  before sleeping and retrying, with the same stream observability context.
- Direct provider tests cover byte-count events for OpenAI Chat, OpenAI
  Responses, and Anthropic streams.
- Stream-shape fallback is disabled once an assistant message has already been
  committed, preventing duplicate tool execution on partial stream failures.
- Non-streaming fallback now emits a semantic `RecoveryTraceEvent` with
  `intent: switch_to_non_streaming` and `action: non_streaming_fallback`.
- Golden fixtures now cover model fallback, delegated recovery, and
  stream-shape non-streaming fallback trace branches, including generic
  stream-creation 404 fallback.
- Stream watchdog timeout now emits a semantic retry trace before sleeping and
  retrying, including request id, TTFB, byte count, safe headers, stream phase,
  inner timeout cause, timeout policy fields, retry intent, and retry action.
- Golden fixtures now cover observability-first stream watchdog retry.
- Mid-stream failures after partial assistant text/tool accumulation now throw
  `PartialStreamRecoveryError` instead of replaying unsafe fallback calls.
- After stream-consumption retries are exhausted, `llm.ts` creates a
  `partial-stream-stub` assistant message with `stop_reason: max_tokens` and
  `partialStreamRecovery` metadata.
- `query.ts` routes the stub through a continuation turn and distinguishes
  network text continuation, dropped mid-tool-call continuation, and ordinary
  max-output continuation.

Remaining:

- Optional: add an active first-byte watchdog if product diagnostics need to
  distinguish "request sent but no first token" from post-first-event idle
  stalls in runtime behavior. The policy labels already exist.
- Add edge fixtures if new partial-stream provider shapes appear.

### M6: Side Query / Inference Parity

Status: product trace plumbing complete; selected foreground auxiliary retry
execution implemented.

Covered now:

- Added an auxiliary API recovery trace layer for non-main-loop API paths.
- `InferenceRequest` and `CountTokensRequest` can carry `onRecoveryTrace` and
  `querySource`.
- `sideQuery()` passes recovery trace sinks through to provider inference.
- OpenAI Chat, OpenAI Responses, and Anthropic `inference()` error paths emit
  semantic recovery traces.
- Anthropic `verifyConnection()` emits semantic recovery traces when final
  verification fails after its bounded retry loop.
- Anthropic `countTokens()` emits semantic recovery traces before returning
  `null` for fallback-to-local-estimation behavior.
- Auxiliary traces explicitly separate actual execution from recommendation:
  `action: fail_fast` records that the auxiliary path did not retry, while
  `recommendedAction` / `recommendedIntent` preserve the semantic recovery that
  the main loop would use.
- `withAuxiliaryRetry()` now gives selected foreground side-query sources
  (`side_question`, `model_validation`, `permission_explainer`,
  `verification_agent`) one bounded semantic retry.
- Auxiliary retry uses the same observe/decide/execute rule table as the main
  retry loop and records observation id, decision id, previous reason/action,
  mutation, safe headers, and final outcome.
- Provider `inference()` paths honor `suppressAuxiliaryRecoveryTrace`, so the
  outer auxiliary harness owns trace emission and provider catch blocks only
  normalize/rethrow.
- Side-query retries can apply semantic request mutations for unsupported
  fields, JSON schema keyword stripping, multimodal tool-result downgrades,
  thinking disable, and max-token omission/override.
- Golden fixtures now cover side-query rate limit, inference malformed response,
  and count-token context overflow traces across the three protocols.
- `ToolUseContext` now has a shared `onRecoveryTrace` sink. The main query
  loop passes it into `queryModelWithStreaming()`, so forked agents and
  side-question/compact forks inherit the same trace channel.
- Compact's direct streaming fallback passes `onRecoveryTrace` into the API
  layer.
- Product auxiliary helpers now accept or inherit trace sinks where they call
  API paths: model validation, permission explainer, session search
  summarization, agentic session search, memdir relevance selection, file-read
  token counting, MCP token counting, and fast-model token-count fallback.
- `apiTimeoutPolicy.ts` now applies source-aware auxiliary budgets
  (`side_question`, `verification_agent`, and `session_search` get foreground
  time; validation helpers get bounded validation time; background helpers get
  short time) and wraps auxiliary attempts so SDKs cannot hang beyond the local
  timeout even if they ignore abort signals.
- OpenAI Chat, OpenAI Responses, and Anthropic non-streaming fallback paths use
  the same timeout policy; timeout failures record `timeoutKind` and
  `timeoutMs` in recovery traces.
- OpenAI Chat, OpenAI Responses, and Anthropic inference/count-token auxiliary
  paths use the unified timeout wrapper and policy labels.
- OpenAI Chat and OpenAI Responses provider clients are constructed with
  SDK-level retries disabled, and per-call SDK options also pass
  `maxRetries: 0`.
- Anthropic stream and non-stream paths already used `withRetry()` with
  SDK retries disabled; `verifyConnection()`, `inference()`, and
  `countTokens()` now also disable SDK-level retries so provider failures are
  visible to semantic classification and recovery tracing.
- Focused plumbing tests cover `query()` to API options, neutral sideQuery and
  token-counter forwarding, bounded foreground auxiliary retry, background
  no-retry behavior, auxiliary request mutation, session-search forwarding,
  agentic session-search forwarding, and SDK retry suppression.

Remaining:

- Wire a product-facing consumer for recovery traces, such as `/doctor` API
  failure cards or a session diagnostics panel. The event channel now exists;
  UX presentation is still M7/productization work.
- Decide whether auxiliary model fallback, credential-pool fallback, or bounded
  retry for additional auxiliary operations should exist as product policies.

### M7: API Release Gate

Status: local API gate available; full release gate still needs product-facing
diagnostics and checklist enforcement.

Current local gate:

- `pnpm run gate:api`

This expands to:

- `pnpm run test:api`
- `pnpm run build:types`
- `git diff --check`

Available now:

- Dedicated contract fixture folder with golden request, stream, error, and trace fixtures.
- Provider envelope fixture policy at
  `docs/api-provider-envelope-fixture-policy.md`.
- Unified timeout policy at `agent/src/services/api/apiTimeoutPolicy.ts`,
  with unit coverage for stream labels, non-streaming budgets, auxiliary
  budgets, parent abort, and trace context projection.
- Architecture contract tests for recovery history, protocol normalization, and
  rule metadata.
- Rule registry invariant tests.
- Retry trace golden fixture includes semantic intent, action, rule id, repeat
  policy, previous decision, mutation, and final outcome.
- Fallback/delegated/stream-fallback trace fixtures cover the non-mutation
  recovery branches.

Remaining:

- Release checklist requiring:
  - no new string pattern without fixture
  - no new recovery action without trace test
  - three-protocol recovery matrix updated
  - product `/doctor` API failure card consumes recovery trace

## Immediate Next Work

1. Add product diagnostics consumption for recovery trace events, starting with
   `/doctor` API failure cards.
2. Decide optional provider/runtime policies:
   pooled credential rotation and any newly observed provider-specific request
   sanitizer not yet covered by fixtures.
3. Add narrow API contract fixtures whenever new provider envelopes are
   observed in production.

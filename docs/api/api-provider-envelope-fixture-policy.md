# API Provider Envelope Fixture Policy

This policy keeps API reliability work from drifting back into scattered
provider string matching. It applies to the three protocol paths:

- `openai-chat`
- `openai-responses`
- `anthropic`

Computer-use and UI diagnostics are out of scope.

## Required Chain

Every new provider failure shape must move through this chain:

`provider envelope -> error fixture -> ErrorFailoverReason -> RecoveryIntent -> RecoveryAction -> retry context mutation -> recovery trace -> contract test`

Do not add a provider error pattern, request sanitizer, or retry branch unless
the chain is represented by tests.

## What Counts as a Provider Envelope

An envelope is the smallest reproducible provider failure sample that explains
the behavior:

- HTTP status code.
- Response body or SDK error object.
- Nested fields such as `error`, `body`, `response`, `metadata.raw`, `code`,
  `type`, `param`, or upstream-provider wrappers.
- Safe headers that affect recovery, such as `retry-after`, request-id, and
  rate-limit headers.
- SDK constructor name when the SDK does not expose a status code.

Never include API keys, authorization headers, prompts, file contents, or user
payload text that is not necessary for classification.

## Classifier Rules

When adding a classifier pattern:

1. Add or update an error-envelope fixture.
2. Assert the exact `ErrorFailoverReason`.
3. Assert recovery hints such as `requestFieldsToOmit`,
   `imageRecoveryProfile`, `retryAfterMs`, `shouldFallback`, or
   `shouldCompress`.
4. Prefer semantic reason names over provider names. For example,
   `unsupported_parameter` is better than `openrouter_bad_request`.
5. If the same provider text could mean two recoveries, add precedence tests.
   Example: image-specific payload failures must classify as
   `image_too_large`, not generic `payload_too_large`.

## Recovery Rules

When adding a recovery action:

1. Add or update `RecoveryAction` and `RecoveryIntent`.
2. Add a declarative rule in `recoveryRules.ts`.
3. Declare protocol scope and repeat policy.
4. Use a retry context mutation instead of modifying provider request bodies
   inline.
5. Add a trace fixture that shows `reason`, `intent`, `action`, `ruleId`,
   `repeatPolicy`, mutation details, and final/exhausted behavior.

One-shot recoveries must fail as `fail_recovery_exhausted` if the same semantic
failure repeats after the mutation.

## Preflight vs Recovery

Use `apiRequestPreflight.ts` only for deterministic request compatibility rules
that should run before any failed attempt. Examples include model/protocol-gated
field stripping for known provider incompatibilities.

Use the observe/decide/execute recovery path when the behavior depends on a
provider failure. Examples include unsupported parameters, invalid encrypted
reasoning replay, malformed Responses output, image payload rewrite, and
provider-specific schema rejection.

Do not implement provider-specific recovery by branching inside the retry loop
or directly inside provider request builders.

## Three-Protocol Impact Check

Every new envelope must answer these questions in the test or plan update:

- Does it apply to OpenAI Chat, OpenAI Responses, Anthropic, or more than one?
- Is the mutation request-body specific, stream specific, or shared?
- Can it run safely after partial assistant output has been committed?
- Does it affect side query, inference, verify, compact, or token counting paths?
- Does it need a golden request fixture, error fixture, stream fixture, retry
  trace fixture, or all of them?

## Fixture Locations

Use the existing API contract fixture tree:

- `agent/src/__tests__/unit/services/api/contracts/fixtures/openai-chat`
- `agent/src/__tests__/unit/services/api/contracts/fixtures/openai-responses`
- `agent/src/__tests__/unit/services/api/contracts/fixtures/anthropic`
- `agent/src/__tests__/unit/services/api/contracts/fixtures/api-recovery`

If a fixture does not fit these buckets, add a narrow subfolder rather than
embedding large provider objects inline in tests.

## Review Checklist

Before merging an API reliability change:

- No new classifier pattern without an envelope fixture.
- No new recovery action without a trace fixture.
- No new request mutation without a request-body or retry-context test.
- No SDK retry behavior hides the first provider failure from Axiomate
  classification.
- No provider-specific sanitizer bypasses `apiRequestPreflight.ts` or
  observe/decide/execute.
- `pnpm run gate:api` passes.

/**
 * Structured error classifier for API errors.
 *
 * This module is a pure classifier — it accepts an error and outputs a
 * structured ClassifiedError with recovery hints. It has NO side effects
 * (no retries, no client refresh, no credential rotation).
 *
 * The retry loop (withRetry.ts) consumes the ClassifiedError hints to
 * decide what to do. It never re-parses the error itself.
 */

import { extractConnectionErrorDetails } from './errorUtils.js'
import { getHeader } from './headerUtils.js'
import { LLMAbortError, LLMAPIError, LLMTimeoutError } from './streamTypes.js'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ErrorFailoverReason =
  | 'abort'              // User cancelled
  | 'connection'         // Network / DNS / TLS error
  | 'timeout'            // Connection or read timeout
  | 'overloaded'         // 503/529 — provider capacity
  | 'rate_limit'         // 429 — throttling
  | 'billing'            // 402 / confirmed credit exhaustion (permanent)
  | 'auth'               // 401/403 — transient auth (refresh may fix)
  | 'auth_permanent'     // Auth failed after refresh — abort
  | 'context_overflow'   // Prompt too long / context window exceeded
  | 'max_tokens_too_large' // Caller-supplied max_tokens alone exceeds model output cap
  | 'payload_too_large'  // 413
  | 'image_too_large'    // Image part exceeds provider per-image limits
  | 'model_not_found'    // 404 / invalid model
  | 'provider_policy_blocked' // Aggregator/account policy excludes available endpoints
  | 'format_error'       // 400 bad request (not context overflow)
  | 'unsupported_parameter' // Provider rejects a recoverable top-level request field
  | 'invalid_encrypted_content' // OpenAI Responses encrypted reasoning replay rejected
  | 'multimodal_tool_content_unsupported' // Tool result list/image content rejected
  | 'server_error'       // 500/502
  | 'thinking_signature' // Anthropic thinking block signature invalid
  | 'long_context_tier'  // Anthropic "extra usage" tier gate (429 + long context)
  | 'oauth_long_context_beta_forbidden' // Anthropic OAuth subscription rejects long-context beta
  | 'llama_cpp_grammar_pattern' // llama.cpp grammar rejects JSON schema pattern/format
  | 'unknown'            // Unclassifiable

export interface ClassifiedError {
  /** Semantic reason for the failure */
  reason: ErrorFailoverReason
  /** HTTP status code, if available */
  statusCode: number | undefined
  /** Human-readable error message (truncated) */
  message: string
  /** Whether the retry loop should retry this error */
  retryable: boolean
  /** Whether context should be compressed before retrying */
  shouldCompress: boolean
  /** Whether the retry loop should switch to a fallback model */
  shouldFallback: boolean
  /** Server-suggested retry delay in milliseconds */
  retryAfterMs: number | undefined
  /** Top-level request fields that can be omitted before retrying. */
  requestFieldsToOmit?: string[]
}

export interface ErrorClassificationContext {
  /** Provider identifier ('anthropic', 'openai', custom name) */
  provider: string
  /** Model identifier */
  model: string
  /** Approximate token count of the current session */
  approxTokens?: number
  /** Model's context window length */
  contextLength?: number
  /** Number of messages in the conversation */
  numMessages?: number
}

// ---------------------------------------------------------------------------
// Pattern constants (ported from hermes error_classifier.py, adapted for
// multi-provider use including Chinese error messages)
// ---------------------------------------------------------------------------

/** Permanent billing exhaustion — rotate credential or fail */
const BILLING_PATTERNS = [
  'insufficient credits',
  'insufficient_quota',
  'credit balance',
  'credits have been exhausted',
  'top up your credits',
  'payment required',
  'billing hard limit',
  'exceeded your current quota',
  'account is deactivated',
  'plan does not include',
]

/**
 * Transient signals that indicate a 402/usage-limit is temporary (resets soon).
 * If present alongside a billing-like message, classify as rate_limit, not billing.
 */
const RATE_LIMIT_TRANSIENT_SIGNALS = [
  'try again',
  'retry',
  'resets at',
  'reset in',
  'wait',
  'requests remaining',
  'periodic',
  'window',
]

/** Rate limiting patterns */
const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate_limit',
  'too many requests',
  'throttled',
  'requests per minute',
  'tokens per minute',
  'requests per day',
  'try again in',
  'please retry after',
  'resource_exhausted',
  'rate increased too quickly',
  'throttlingexception',
  'too many concurrent requests',
  'servicequotaexceededexception',
]

const USAGE_LIMIT_PATTERNS = [
  'usage limit',
  'quota',
  'limit exceeded',
  'key limit exceeded',
]

/**
 * max_tokens alone exceeds model output cap — retry without max_tokens
 * (OpenAI only; Anthropic requires the field). Must be checked BEFORE
 * CONTEXT_OVERFLOW_PATTERNS so we don't fire context compaction for a
 * problem that's just the caller's max_tokens being too ambitious.
 *
 * These patterns are intentionally NOT matched by Anthropic's combined
 * "input length and `max_tokens` exceed context limit: X + Y > Z" message,
 * which is an input-side problem and belongs in context_overflow.
 */
const MAX_TOKENS_TOO_LARGE_PATTERNS = [
  'max_tokens is too large',
  'max_tokens must be',
  'max_tokens cannot exceed',
  'max_tokens out of range',
  'max_completion_tokens is too',
  'max_completion_tokens must be',
  'max_completion_tokens cannot',
  'invalid value for max_tokens',
  'invalid value for max_completion_tokens',
]

/** Context window exceeded — compress, don't failover */
const CONTEXT_OVERFLOW_PATTERNS = [
  'context length',
  'context size',
  'maximum context',
  'token limit',
  'too many tokens',
  'reduce the length',
  'exceeds the limit',
  'context window',
  'prompt is too long',
  'prompt exceeds max length',
  'max_tokens',
  'maximum number of tokens',
  'exceeds the max_model_len',
  'max_model_len',
  'prompt length',
  'input is too long',
  'maximum model length',
  'context length exceeded',
  'truncating input',
  'slot context',
  'n_ctx_slot',
  'max input token',
  'input token',
  'exceeds the maximum number of input tokens',
  // Anthropic-specific
  'input length and `max_tokens` exceed context limit',
  // Chinese providers (e.g., Qwen, DeepSeek, Kimi)
  '超过最大长度',
  '上下文长度',
]

/** Model not available — fallback to different model */
const MODEL_NOT_FOUND_PATTERNS = [
  'is not a valid model',
  'invalid model',
  'model not found',
  'model_not_found',
  'does not exist',
  'no such model',
  'unknown model',
  'unsupported model',
]

const REQUEST_VALIDATION_PATTERNS = [
  'unknown parameter',
  'unsupported parameter',
  'unrecognized request argument',
  'invalid_request_error',
  'unknown_parameter',
  'unsupported_parameter',
]

const OMITTABLE_REQUEST_FIELDS = new Set([
  'frequency_penalty',
  'include',
  'logprobs',
  'max_completion_tokens',
  'max_output_tokens',
  'max_tokens',
  'metadata',
  'parallel_tool_calls',
  'presence_penalty',
  'reasoning',
  'response_format',
  'seed',
  'stop',
  'store',
  'stream_options',
  'temperature',
  'thinking',
  'tool_choice',
  'top_logprobs',
  'top_p',
])

const PROVIDER_POLICY_BLOCKED_PATTERNS = [
  'no endpoints available matching your guardrail',
  'no endpoints available matching your data policy',
  'no endpoints found matching your data policy',
]

const IMAGE_TOO_LARGE_PATTERNS = [
  'image exceeds',
  'image too large',
  'image_too_large',
  'image size exceeds',
]

const MULTIMODAL_TOOL_CONTENT_PATTERNS = [
  'text is not set',
  'tool message content must be a string',
  'tool content must be a string',
  'tool message must be a string',
  'expected string, got list',
  'expected string, got array',
  'tool_call.content must be string',
]

/** Transient authentication failures (refresh/rotate may fix) */
const AUTH_PATTERNS = [
  'invalid api key',
  'invalid_api_key',
  'authentication',
  'unauthorized',
  'invalid token',
  'token expired',
  'token revoked',
  'access denied',
]

/**
 * Permanent auth failures — refresh won't help, must abort.
 * If any of these appear in the error message alongside a 401/403,
 * classify as auth_permanent instead of auth.
 */
const AUTH_PERMANENT_PATTERNS = [
  'account is deactivated',
  'account has been disabled',
  'api key has been revoked',
  'permanently banned',
  'access has been terminated',
]

/** Server disconnect patterns (connection dropped mid-stream) */
const SERVER_DISCONNECT_PATTERNS = [
  'server disconnected',
  'peer closed connection',
  'connection reset by peer',
  'connection was closed',
  'network connection lost',
  'unexpected eof',
  'incomplete chunked read',
]

const TIMEOUT_MESSAGE_PATTERNS = [
  'timed out',
  'turn timed out',
  'request timed out',
  'deadline exceeded',
  'operation timed out',
  'upstream timed out',
]

const SSL_TRANSIENT_PATTERNS = [
  'bad record mac',
  'ssl alert',
  'tls alert',
  'ssl handshake failure',
  'tlsv1 alert',
  'sslv3 alert',
  'bad_record_mac',
  'ssl_alert',
  'tls_alert',
  'tls_alert_internal_error',
  '[ssl:',
]

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

export function classifyError(
  error: unknown,
  context: ErrorClassificationContext,
): ClassifiedError {
  // 1. User abort
  if (error instanceof LLMAbortError) {
    return result('abort', {
      retryable: false,
      message: 'User aborted the request',
    })
  }
  if (error instanceof LLMTimeoutError) {
    return result('timeout', {
      retryable: true,
      message: error.message,
    })
  }

  // 2. Extract HTTP status code and message from the error chain
  const statusCode = extractStatusCode(error)
  const message = extractMessage(error)
  const lowerMessage = buildPatternMessage(error, message)
  const errorCode = extractErrorCode(error)

  // 3. Provider-specific patterns (highest priority — before generic HTTP dispatch)
  if (statusCode === 400 && lowerMessage.includes('signature') && lowerMessage.includes('thinking')) {
    return result('thinking_signature', {
      statusCode,
      retryable: true,
      message,
    })
  }
  if (statusCode === 429 && lowerMessage.includes('extra usage') && lowerMessage.includes('long context')) {
    return result('long_context_tier', {
      statusCode,
      retryable: true,
      shouldCompress: true,
      message,
    })
  }
  if (statusCode === 400 && lowerMessage.includes('long context beta') && lowerMessage.includes('not yet available')) {
    return result('oauth_long_context_beta_forbidden', {
      statusCode,
      retryable: true,
      message,
    })
  }
  if (
    statusCode === 400 &&
    (lowerMessage.includes('error parsing grammar') ||
      lowerMessage.includes('json-schema-to-grammar') ||
      (lowerMessage.includes('unable to generate parser') &&
        lowerMessage.includes('template')))
  ) {
    return result('llama_cpp_grammar_pattern', {
      statusCode,
      retryable: true,
      message,
    })
  }
  if (
    lowerMessage.includes('do not have an active grok subscription') ||
    (lowerMessage.includes('out of available resources') &&
      lowerMessage.includes('grok'))
  ) {
    return result('auth', {
      statusCode,
      retryable: false,
      shouldFallback: true,
      message,
    })
  }

  // 4. HTTP status dispatch
  if (statusCode !== undefined) {
    const retryAfterMs = parseRetryAfterMs(error)

    switch (statusCode) {
      case 401:
      case 403:
        // Distinguish transient auth (can refresh) from permanent
        if (hasAnyPattern(lowerMessage, AUTH_PERMANENT_PATTERNS)) {
          return result('auth_permanent', {
            statusCode,
            retryable: false,
            shouldFallback: true,
            message,
          })
        }
        return result('auth', {
          statusCode,
          retryable: false,
          shouldFallback: true,
          message,
        })

      case 402:
        return classify402(lowerMessage, statusCode, message, retryAfterMs)

      case 404:
        if (hasAnyPattern(lowerMessage, PROVIDER_POLICY_BLOCKED_PATTERNS)) {
          return result('provider_policy_blocked', {
            statusCode,
            retryable: false,
            message,
          })
        }
        return result('model_not_found', {
          statusCode,
          retryable: false,
          shouldFallback: true,
          message,
        })

      case 408:
      case 409:
        return result('timeout', {
          statusCode,
          retryable: true,
          message,
        })

      case 413:
        return result('payload_too_large', {
          statusCode,
          retryable: true,
          shouldCompress: true,
          message,
        })

      case 429:
        return result('rate_limit', {
          statusCode,
          retryable: true,
          shouldFallback: true,
          retryAfterMs,
          message,
        })

      case 400:
        return classify400(
          error,
          lowerMessage,
          errorCode,
          statusCode,
          message,
          context,
        )

      case 500:
      case 502:
        if (
          hasAnyPattern(lowerMessage, REQUEST_VALIDATION_PATTERNS) ||
          hasAnyPattern(errorCode, REQUEST_VALIDATION_PATTERNS)
        ) {
          const requestFieldsToOmit = extractOmittableRequestFields(
            error,
            lowerMessage,
          )
          if (requestFieldsToOmit.length > 0) {
            return result('unsupported_parameter', {
              statusCode,
              retryable: true,
              requestFieldsToOmit,
              message,
            })
          }
          return result('format_error', {
            statusCode,
            retryable: false,
            shouldFallback: true,
            message,
          })
        }
        return result('server_error', {
          statusCode,
          retryable: true,
          message,
        })

      case 503:
      case 529:
        return result('overloaded', {
          statusCode,
          retryable: true,
          message,
        })

      default:
        if (statusCode >= 500) {
          return result('server_error', {
            statusCode,
            retryable: true,
            message,
          })
        }
        if (statusCode >= 400) {
          return result('format_error', {
            statusCode,
            retryable: false,
            shouldFallback: true,
            message,
          })
        }
    }
  }

  // 4. SDK overloaded_error in message (streaming SDK bug — 529 not always
  //    propagated as status code)
  if (lowerMessage.includes('"type":"overloaded_error"')) {
    return result('overloaded', {
      statusCode: 529,
      retryable: true,
      message,
    })
  }

  // 5. Transport / connection errors (provider-neutral: walks cause chain)
  const connectionDetails = extractConnectionErrorDetails(error)
  if (connectionDetails) {
    if (
      connectionDetails.code === 'ETIMEDOUT' ||
      connectionDetails.code === 'UND_ERR_CONNECT_TIMEOUT'
    ) {
      return result('timeout', { retryable: true, message })
    }
    // ECONNRESET/EPIPE + large session → likely context overflow (hermes heuristic)
    if (
      (connectionDetails.code === 'ECONNRESET' || connectionDetails.code === 'EPIPE') &&
      isLargeSession(context)
    ) {
      return result('context_overflow', {
        retryable: true,
        shouldCompress: true,
        message,
      })
    }
    return result('connection', { retryable: true, message })
  }

  // 6. Non-SDK errors — try message pattern matching
  if (hasAnyPattern(lowerMessage, SERVER_DISCONNECT_PATTERNS) && isLargeSession(context)) {
    return result('context_overflow', {
      retryable: true,
      shouldCompress: true,
      message,
    })
  }

  if (hasAnyPattern(lowerMessage, SSL_TRANSIENT_PATTERNS)) {
    return result('timeout', { retryable: true, message })
  }

  if (hasAnyPattern(lowerMessage, TIMEOUT_MESSAGE_PATTERNS)) {
    return result('timeout', { retryable: true, message })
  }

  if (hasAnyPattern(lowerMessage, MULTIMODAL_TOOL_CONTENT_PATTERNS)) {
    return result('multimodal_tool_content_unsupported', {
      retryable: true,
      message,
    })
  }

  if (
    hasAnyPattern(lowerMessage, IMAGE_TOO_LARGE_PATTERNS) ||
    errorCode === 'image_too_large'
  ) {
    return result('image_too_large', { retryable: true, message })
  }

  if (
    errorCode === 'invalid_encrypted_content' ||
    lowerMessage.includes('invalid_encrypted_content') ||
    (lowerMessage.includes('encrypted content for item') &&
      lowerMessage.includes('could not be verified'))
  ) {
    return result('invalid_encrypted_content', {
      retryable: true,
      message,
    })
  }

  if (hasAnyPattern(lowerMessage, CONTEXT_OVERFLOW_PATTERNS)) {
    return result('context_overflow', {
      retryable: true,
      shouldCompress: true,
      message,
    })
  }

  if (
    hasAnyPattern(lowerMessage, RATE_LIMIT_PATTERNS) ||
    ['resource_exhausted', 'throttled', 'rate_limit_exceeded'].includes(
      errorCode,
    )
  ) {
    return result('rate_limit', { retryable: true, shouldFallback: true, message })
  }

  if (hasUsageLimitWithTransientSignal(lowerMessage)) {
    return result('rate_limit', { retryable: true, shouldFallback: true, message })
  }

  if (
    hasAnyPattern(lowerMessage, BILLING_PATTERNS) ||
    ['insufficient_quota', 'billing_not_active', 'payment_required'].includes(
      errorCode,
    ) ||
    hasAnyPattern(lowerMessage, USAGE_LIMIT_PATTERNS)
  ) {
    return result('billing', { retryable: false, shouldFallback: true, message })
  }

  if (hasAnyPattern(lowerMessage, PROVIDER_POLICY_BLOCKED_PATTERNS)) {
    return result('provider_policy_blocked', {
      retryable: false,
      message,
    })
  }

  if (
    hasAnyPattern(lowerMessage, MODEL_NOT_FOUND_PATTERNS) ||
    ['model_not_found', 'model_not_available', 'invalid_model'].includes(
      errorCode,
    )
  ) {
    return result('model_not_found', { retryable: false, shouldFallback: true, message })
  }

  if (hasAnyPattern(lowerMessage, AUTH_PATTERNS)) {
    return result('auth', { retryable: false, shouldFallback: true, message })
  }

  // 7. Generic timeout / connection from non-SDK errors
  if (isTimeoutLikeError(error)) {
    return result('timeout', { retryable: true, message })
  }

  if (isConnectionLikeError(error)) {
    return result('connection', { retryable: true, message })
  }

  // 8. Fallback: unknown, retryable
  return result('unknown', { retryable: true, message })
}

// ---------------------------------------------------------------------------
// Disambiguation helpers
// ---------------------------------------------------------------------------

/**
 * 402 disambiguation: billing exhaustion (permanent) vs transient rate limit.
 *
 * Key insight from hermes: "usage limit, try again in 5 minutes" is NOT billing
 * — it's a periodic quota reset. Look for transient signals.
 */
function classify402(
  lowerMessage: string,
  statusCode: number,
  message: string,
  retryAfterMs: number | undefined,
): ClassifiedError {
  if (hasAnyPattern(lowerMessage, RATE_LIMIT_TRANSIENT_SIGNALS)) {
    return result('rate_limit', {
      statusCode,
      retryable: true,
      shouldFallback: true,
      retryAfterMs,
      message,
    })
  }
  return result('billing', {
    statusCode,
    retryable: false,
    shouldFallback: true,
    message,
  })
}

/**
 * 400 disambiguation: context_overflow vs format_error vs model_not_found.
 *
 * Some providers return 400 instead of 413/404, so we check message patterns.
 * When the message is generic and the session is large, we apply the hermes
 * heuristic: generic 400 + large session → likely context overflow.
 */
function classify400(
  error: unknown,
  lowerMessage: string,
  errorCode: string,
  statusCode: number,
  message: string,
  context: ErrorClassificationContext,
): ClassifiedError {
  // Check max_tokens-too-large BEFORE context_overflow — "max_tokens" is a
  // keyword in both categories but the fix differs (retry-without-max_tokens
  // vs compact input), so precedence matters.
  if (hasAnyPattern(lowerMessage, MAX_TOKENS_TOO_LARGE_PATTERNS)) {
    return result('max_tokens_too_large', {
      statusCode,
      retryable: true,
      shouldCompress: false,
      message,
    })
  }
  if (
    hasAnyPattern(lowerMessage, REQUEST_VALIDATION_PATTERNS) ||
    hasAnyPattern(errorCode, REQUEST_VALIDATION_PATTERNS)
  ) {
    const requestFieldsToOmit = extractOmittableRequestFields(
      error,
      lowerMessage,
    )
    if (requestFieldsToOmit.length > 0) {
      return result('unsupported_parameter', {
        statusCode,
        retryable: true,
        requestFieldsToOmit,
        message,
      })
    }
    return result('format_error', {
      statusCode,
      retryable: false,
      shouldFallback: true,
      message,
    })
  }
  if (hasAnyPattern(lowerMessage, MULTIMODAL_TOOL_CONTENT_PATTERNS)) {
    return result('multimodal_tool_content_unsupported', {
      statusCode,
      retryable: true,
      message,
    })
  }
  if (
    hasAnyPattern(lowerMessage, IMAGE_TOO_LARGE_PATTERNS) ||
    errorCode === 'image_too_large'
  ) {
    return result('image_too_large', {
      statusCode,
      retryable: true,
      message,
    })
  }
  if (
    errorCode === 'invalid_encrypted_content' ||
    lowerMessage.includes('invalid_encrypted_content') ||
    (lowerMessage.includes('encrypted content for item') &&
      lowerMessage.includes('could not be verified'))
  ) {
    return result('invalid_encrypted_content', {
      statusCode,
      retryable: true,
      message,
    })
  }
  if (hasAnyPattern(lowerMessage, CONTEXT_OVERFLOW_PATTERNS)) {
    return result('context_overflow', {
      statusCode,
      retryable: true,
      shouldCompress: true,
      message,
    })
  }
  if (hasAnyPattern(lowerMessage, MODEL_NOT_FOUND_PATTERNS)) {
    return result('model_not_found', {
      statusCode,
      retryable: false,
      shouldFallback: true,
      message,
    })
  }
  if (hasAnyPattern(lowerMessage, PROVIDER_POLICY_BLOCKED_PATTERNS)) {
    return result('provider_policy_blocked', {
      statusCode,
      retryable: false,
      message,
    })
  }
  if (hasAnyPattern(lowerMessage, RATE_LIMIT_PATTERNS)) {
    return result('rate_limit', {
      statusCode,
      retryable: true,
      shouldFallback: true,
      message,
    })
  }
  if (hasAnyPattern(lowerMessage, BILLING_PATTERNS)) {
    return result('billing', {
      statusCode,
      retryable: false,
      shouldFallback: true,
      message,
    })
  }
  // Hermes heuristic: generic 400 + large session → likely context overflow
  // Threshold: >40% of context window OR >80K tokens OR >80 messages
  if (isLargeSession(context)) {
    return result('context_overflow', {
      statusCode,
      retryable: true,
      shouldCompress: true,
      message,
    })
  }
  return result('format_error', {
    statusCode,
    retryable: false,
    message,
  })
}

// ---------------------------------------------------------------------------
// Error introspection helpers
// ---------------------------------------------------------------------------

function extractStatusCode(error: unknown): number | undefined {
  if (error instanceof LLMAPIError) {
    return error.status
  }
  // Walk cause chain for wrapped errors (max depth 5)
  let current: unknown = error
  for (let i = 0; i < 5 && current != null; i++) {
    if (typeof current === 'object') {
      const obj = current as Record<string, unknown>
      if (typeof obj.status === 'number') return obj.status
      if (typeof obj.statusCode === 'number') return obj.statusCode
      current = obj.cause ?? obj.error
    } else {
      break
    }
  }
  return undefined
}

function extractMessage(error: unknown): string {
  if (error instanceof LLMAPIError) {
    return (error.message ?? String(error)).slice(0, 500)
  }
  if (error instanceof Error) {
    return (error.message ?? String(error)).slice(0, 500)
  }
  return String(error).slice(0, 500)
}

function buildPatternMessage(error: unknown, message: string): string {
  const parts = [message.toLowerCase()]
  for (const candidate of collectErrorPayloadStrings(error)) {
    const lower = candidate.toLowerCase()
    if (lower && !parts.includes(lower)) {
      parts.push(lower)
    }
  }
  return parts.join(' ')
}

function collectErrorPayloadStrings(error: unknown): string[] {
  const values: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (typeof current !== 'object') {
      break
    }

    const obj = current as Record<string, unknown>
    collectStringsFromPayload(obj.error, values)
    collectStringsFromPayload(obj.body, values)
    collectStringsFromPayload(obj.response, values)
    current = obj.cause
  }
  return values
}

function collectStringsFromPayload(
  value: unknown,
  values: string[],
): void {
  if (!value || typeof value !== 'object') {
    return
  }

  const obj = value as Record<string, unknown>
  for (const key of ['message', 'code', 'type', 'param', 'error_code']) {
    const candidate = obj[key]
    if (typeof candidate === 'string') {
      values.push(candidate)
      if (key === 'message' && candidate.trim().startsWith('{')) {
        collectStringsFromJson(candidate, values)
      }
    }
  }

  collectStringsFromPayload(obj.error, values)
  collectStringsFromPayload(obj.metadata, values)

  const raw = obj.raw
  if (typeof raw === 'string') {
    collectStringsFromJson(raw, values)
  }
}

function collectStringsFromJson(raw: string, values: string[]): void {
  try {
    collectStringsFromPayload(JSON.parse(raw), values)
  } catch {
    // Ignore malformed provider metadata.
  }
}

function extractErrorCode(error: unknown): string {
  const codes: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (typeof current !== 'object') {
      break
    }
    const obj = current as Record<string, unknown>
    collectErrorCodesFromPayload(obj.error, codes)
    collectErrorCodesFromPayload(obj.body, codes)
    current = obj.cause
  }
  return codes[0]?.toLowerCase() ?? ''
}

function collectErrorCodesFromPayload(
  value: unknown,
  codes: string[],
): void {
  if (!value || typeof value !== 'object') {
    return
  }

  const obj = value as Record<string, unknown>
  for (const key of ['code', 'type', 'error_code']) {
    const candidate = obj[key]
    if (
      (typeof candidate === 'string' || typeof candidate === 'number') &&
      String(candidate).trim() !== '400'
    ) {
      codes.push(String(candidate).trim())
    }
  }
  const message = obj.message
  if (typeof message === 'string' && message.trim().startsWith('{')) {
    try {
      collectErrorCodesFromPayload(JSON.parse(message), codes)
    } catch {
      // Ignore malformed provider metadata.
    }
  }
  collectErrorCodesFromPayload(obj.error, codes)
}

function parseRetryAfterMs(error: unknown): number | undefined {
  if (!(error instanceof LLMAPIError)) return undefined
  const header = getHeader(error.headers, 'retry-after')
  if (!header) return undefined
  const seconds = parseInt(header, 10)
  if (isNaN(seconds)) return undefined
  return seconds * 1000
}

// ---------------------------------------------------------------------------
// Session heuristics
// ---------------------------------------------------------------------------

function isLargeSession(context: ErrorClassificationContext): boolean {
  if (context.approxTokens && context.contextLength) {
    if (context.approxTokens > context.contextLength * 0.4) return true
  }
  if (context.approxTokens && context.approxTokens > 80_000) return true
  if (context.numMessages && context.numMessages > 80) return true
  return false
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

function hasAnyPattern(lowerMessage: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => lowerMessage.includes(pattern))
}

function hasUsageLimitWithTransientSignal(lowerMessage: string): boolean {
  return (
    hasAnyPattern(lowerMessage, USAGE_LIMIT_PATTERNS) &&
    hasAnyPattern(lowerMessage, RATE_LIMIT_TRANSIENT_SIGNALS)
  )
}

function extractOmittableRequestFields(
  error: unknown,
  lowerMessage: string,
): string[] {
  const fields = new Set<string>()
  collectParamFields(error, fields)

  const patterns = [
    /(?:unknown|unsupported|unrecognized)\s+(?:parameter|request argument|field)[:\s]+[`'"]?([a-zA-Z0-9_.-]+)[`'"]?/g,
    /parameter\s+[`'"]?([a-zA-Z0-9_.-]+)[`'"]?\s+(?:is|was)\s+not\s+(?:supported|recognized|allowed)/g,
    /[`'"]([a-zA-Z0-9_.-]+)[`'"]\s+(?:is|was)\s+not\s+(?:supported|recognized|allowed)/g,
  ]

  for (const pattern of patterns) {
    for (const match of lowerMessage.matchAll(pattern)) {
      const field = normalizeOmittableField(match[1])
      if (field) {
        fields.add(field)
      }
    }
  }

  return [...fields]
}

function collectParamFields(
  value: unknown,
  fields: Set<string>,
): void {
  if (!value || typeof value !== 'object') {
    return
  }

  const obj = value as Record<string, unknown>
  const param = obj.param
  if (typeof param === 'string') {
    const field = normalizeOmittableField(param)
    if (field) {
      fields.add(field)
    }
  }
  collectParamFields(obj.error, fields)
  collectParamFields(obj.body, fields)
  collectParamFields(obj.cause, fields)
}

function normalizeOmittableField(field: string | undefined): string | null {
  if (!field) {
    return null
  }
  const normalized = field
    .trim()
    .replace(/^body\./, '')
    .split('.')[0]
    ?.replace(/[^a-zA-Z0-9_]/g, '')
    .toLowerCase()

  if (!normalized || !OMITTABLE_REQUEST_FIELDS.has(normalized)) {
    return null
  }
  return normalized
}

// ---------------------------------------------------------------------------
// Non-SDK error detection
// ---------------------------------------------------------------------------

function isTimeoutLikeError(error: unknown): boolean {
  if (error instanceof Error) {
    const name = error.constructor.name
    return (
      name === 'TimeoutError' ||
      name === 'ReadTimeout' ||
      name === 'ConnectTimeout' ||
      name === 'PoolTimeout' ||
      name === 'AbortError'
    )
  }
  return false
}

function isConnectionLikeError(error: unknown): boolean {
  if (error instanceof Error) {
    const name = error.constructor.name
    return (
      name === 'ConnectionError' ||
      name === 'ConnectionResetError' ||
      name === 'BrokenPipeError' ||
      name === 'ServerDisconnectedError' ||
      name.includes('Connect')
    )
  }
  return false
}

// ---------------------------------------------------------------------------
// Result builder (fills defaults for omitted hints)
// ---------------------------------------------------------------------------

function result(
  reason: ErrorFailoverReason,
  overrides: Partial<ClassifiedError> & { message?: string },
): ClassifiedError {
  return {
    reason,
    statusCode: undefined,
    message: overrides.message ?? '',
    retryable: false,
    shouldCompress: false,
    shouldFallback: false,
    retryAfterMs: undefined,
    ...overrides,
  }
}

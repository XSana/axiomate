import type { ClassifiedError } from './errorClassifier.js'

export type RecoveryAction =
  | 'abort'
  | 'fail_fast'
  | 'retry_backoff'
  | 'retry_after'
  | 'refresh_client'
  | 'omit_request_fields'
  | 'strip_reasoning_replay'
  | 'downgrade_multimodal_tool_content'
  | 'strip_json_schema_keywords'
  | 'drop_max_tokens'
  | 'reduce_max_tokens'
  | 'disable_thinking'
  | 'disable_long_context_beta'
  | 'lower_context_tier'
  | 'shrink_image_payload'
  | 'request_compaction'
  | 'non_streaming_fallback'
  | 'fallback_model'

export interface RecoveryActionContext {
  canFallback?: boolean
  retriesExhausted?: boolean
  willRefreshClient?: boolean
}

export function resolveRecoveryAction(
  classified: ClassifiedError,
  context: RecoveryActionContext = {},
): RecoveryAction {
  if (classified.reason === 'abort') {
    return 'abort'
  }

  if (
    context.canFallback &&
    classified.shouldFallback &&
    (!classified.retryable || context.retriesExhausted)
  ) {
    return 'fallback_model'
  }

  if (classified.reason === 'thinking_signature') {
    return 'disable_thinking'
  }

  if (classified.reason === 'max_tokens_too_large') {
    return 'drop_max_tokens'
  }

  if (classified.reason === 'unsupported_parameter') {
    return classified.requestFieldsToOmit?.length
      ? 'omit_request_fields'
      : 'fail_fast'
  }

  if (classified.reason === 'invalid_encrypted_content') {
    return 'strip_reasoning_replay'
  }

  if (classified.reason === 'multimodal_tool_content_unsupported') {
    return 'downgrade_multimodal_tool_content'
  }

  if (classified.reason === 'llama_cpp_grammar_pattern') {
    return 'strip_json_schema_keywords'
  }

  if (classified.reason === 'oauth_long_context_beta_forbidden') {
    return 'disable_long_context_beta'
  }

  if (classified.reason === 'image_too_large') {
    return 'shrink_image_payload'
  }

  if (classified.reason === 'long_context_tier') {
    return 'lower_context_tier'
  }

  if (
    classified.shouldCompress ||
    classified.reason === 'context_overflow' ||
    classified.reason === 'payload_too_large'
  ) {
    return 'request_compaction'
  }

  if (!classified.retryable) {
    return 'fail_fast'
  }

  if (classified.reason === 'connection' && context.willRefreshClient) {
    return 'refresh_client'
  }

  if (
    classified.reason === 'rate_limit' &&
    classified.retryAfterMs !== undefined
  ) {
    return 'retry_after'
  }

  return 'retry_backoff'
}

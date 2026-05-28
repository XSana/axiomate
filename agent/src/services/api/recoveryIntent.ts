import type { ClassifiedError } from './errorClassifier.js'
import type { RecoveryAction } from './recoveryAction.js'

export type RecoveryIntent =
  | 'abort_requested'
  | 'retry_transient_failure'
  | 'respect_provider_retry_after'
  | 'refresh_stale_client'
  | 'omit_unsupported_request_fields'
  | 'omit_oversized_token_budget'
  | 'fit_output_budget_to_context'
  | 'disable_thinking_blocks'
  | 'remove_unverifiable_reasoning_replay'
  | 'downgrade_multimodal_tool_result'
  | 'sanitize_json_schema_for_grammar'
  | 'disable_unavailable_long_context_beta'
  | 'lower_long_context_tier'
  | 'delegate_image_payload_rewrite'
  | 'delegate_conversation_compaction'
  | 'switch_to_non_streaming'
  | 'switch_to_fallback_model'
  | 'fail_recovery_exhausted'
  | 'fail_unrecoverable'

export function intentForAction(
  action: RecoveryAction,
  classified?: Pick<ClassifiedError, 'retryAfterMs'>,
): RecoveryIntent {
  switch (action) {
    case 'abort':
      return 'abort_requested'
    case 'fail_fast':
      return 'fail_unrecoverable'
    case 'retry_backoff':
      return 'retry_transient_failure'
    case 'retry_after':
      return classified?.retryAfterMs !== undefined
        ? 'respect_provider_retry_after'
        : 'retry_transient_failure'
    case 'refresh_client':
      return 'refresh_stale_client'
    case 'omit_request_fields':
      return 'omit_unsupported_request_fields'
    case 'strip_reasoning_replay':
      return 'remove_unverifiable_reasoning_replay'
    case 'downgrade_multimodal_tool_content':
      return 'downgrade_multimodal_tool_result'
    case 'strip_json_schema_keywords':
      return 'sanitize_json_schema_for_grammar'
    case 'drop_max_tokens':
      return 'omit_oversized_token_budget'
    case 'reduce_max_tokens':
      return 'fit_output_budget_to_context'
    case 'disable_thinking':
      return 'disable_thinking_blocks'
    case 'disable_long_context_beta':
      return 'disable_unavailable_long_context_beta'
    case 'lower_context_tier':
      return 'lower_long_context_tier'
    case 'shrink_image_payload':
      return 'delegate_image_payload_rewrite'
    case 'request_compaction':
      return 'delegate_conversation_compaction'
    case 'non_streaming_fallback':
      return 'switch_to_non_streaming'
    case 'fallback_model':
      return 'switch_to_fallback_model'
  }
}

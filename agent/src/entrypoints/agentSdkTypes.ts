/**
 * Internal type aliases re-exported from the sdk/ subdir.
 *
 * NOT a public API surface. axiomate ships only as a CLI binary
 * (see package.json `main` / `bin`), with no `exports` map. External
 * consumers cannot `import` from this file. It exists solely so that
 * internal modules (~45 callers) share one type-import root.
 *
 * For type definitions, see:
 * - sdk/coreTypes.ts — HOOK_EVENTS, ExitReason, and Zod-derived SDK types
 * - sdk/controlTypes.ts — SDK control protocol (used by `-p --output-format=stream-json`)
 */

// Control protocol types for SDK builders (bridge subpath consumers)
/** @alpha */
export type {
  SDKControlRequest,
  SDKControlResponse,
} from './sdk/controlTypes.js'

// Re-export core types (common serializable types)
export * from './sdk/coreTypes.js'

import type { SDKSessionInfo } from './sdk/coreTypes.js'
export type { SDKSessionInfo }

// ============================================================================
// Internal type aliases (mostly `any`; tightening to real Zod-derived types
// from sdk/coreSchemas.ts is a separate cleanup — would touch ~45 files).
// ============================================================================

export type ModelUsage = any
export type SDKStatus = any
export type ModelInfo = any
export type SDKUserMessageReplay = any
export type PermissionResult = any
export type McpServerConfigForProcessTransport = any
export type McpServerStatus = any
export type RewindFilesResult = any
export type HookInput = any
export type AsyncHookJSONOutput = { async: true; asyncTimeout?: number }
export type SyncHookJSONOutput = {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  reason?: string
  systemMessage?: string
  hookSpecificOutput?: Record<string, any>
}
export type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput
export type PermissionUpdate = any
export type PermissionMode = any
export type SDKCompactBoundaryMessage = any
export type SDKPermissionDenial = any
export type SDKAssistantMessage = any
export type SDKPartialAssistantMessage = any
export type SDKStatusMessage = any
export type SDKSystemMessage = any
export type SDKToolProgressMessage = any
export type SDKAssistantMessageError = any
export type NotificationHookInput = any
export type PostToolUseHookInput = any
export type PostToolUseFailureHookInput = any
export type PermissionDeniedHookInput = any
export type PreCompactHookInput = any
export type PostCompactHookInput = any
export type PreToolUseHookInput = any
export type SessionStartHookInput = any
export type SessionEndHookInput = any
export type SetupHookInput = any
export type StopHookInput = any
export type StopFailureHookInput = any
export type SubagentStartHookInput = any
export type SubagentStopHookInput = any
export type TeammateIdleHookInput = any
export type TaskCreatedHookInput = any
export type TaskCompletedHookInput = any
export type ConfigChangeHookInput = any
export type CwdChangedHookInput = any
export type FileChangedHookInput = any
export type InstructionsLoadedHookInput = any
export type UserPromptSubmitHookInput = any
export type PermissionRequestHookInput = any
export type ElicitationHookInput = any
export type ElicitationResultHookInput = any
export type SDKRateLimitInfo = any
export type ApiKeySource = any

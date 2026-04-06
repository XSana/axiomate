/**
 * Action classifier — decides whether to allow/block agent actions in auto mode.
 *
 * Routes to provider-specific classifier implementation.
 * Anthropic: XML/tool-use two-stage classifier (yoloClassifier)
 * OpenAI: TBD (function calling based classifier)
 */
import type { LLMProvider } from '../provider.js'

// Re-export the classifier function with provider parameter
// Currently delegates to the existing yoloClassifier module,
// which will be migrated to capabilities/anthropic/classifier.ts
// when the full migration is complete.

/**
 * Classify an action through the appropriate provider's classifier.
 *
 * For now, the actual classification logic remains in utils/permissions/yoloClassifier.ts
 * and is called by the permissions flow. This module serves as the future routing point
 * when OpenAI classifier is implemented.
 *
 * Migration path:
 * 1. Current: permissions.ts → yoloClassifier.ts → sideQuery() → SDK
 * 2. Phase 3: permissions.ts → yoloClassifier.ts → sideQuery(provider, opts) → provider.inference()
 * 3. Future: permissions.ts → classifyAction(provider, ...) → anthropic/classifier.ts → sideQuery(provider, opts)
 */
export { classifyYoloAction as classifyAction } from '../../../utils/permissions/yoloClassifier.js'

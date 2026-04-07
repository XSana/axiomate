/**
 * Action classifier — decides whether to allow/block agent actions in auto mode.
 *
 * Currently delegates to yoloClassifier (Anthropic-optimized XML/tool-use
 * two-stage classifier) which internally uses sideQuery → provider.inference().
 *
 * When an OpenAI-specific classifier is needed (e.g. function-calling based),
 * add a provider.name switch here and route to a separate implementation.
 */
export { classifyYoloAction as classifyAction } from '../../../utils/permissions/yoloClassifier.js'

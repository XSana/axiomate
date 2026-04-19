import { isEnvTruthy } from '../envUtils.js'

/**
 * Whether to use the tree-sitter-style AST parser for bash command
 * permission checks. Opt-in because AST parsing is stricter (fail-closed
 * on unknown node types) than the legacy shell-quote path — some users
 * would experience this as false positives on exotic shell syntax.
 */
export function isBashAstEnabled(): boolean {
  return isEnvTruthy(process.env.AXIOMATE_CODE_ENABLE_BASH_AST)
}

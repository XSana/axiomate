/**
 * One-shot startup migration: heal references in ~/.axiomate.json and
 * ~/.axiomate/settings.json that point at models removed from
 * config.models.
 *
 * Background: there is no `/model remove` command — users delete model
 * entries by hand-editing ~/.axiomate.json. Stale references that survive
 * the deletion fall into a few buckets:
 *
 *   1. config.currentModel pointing at a deleted model
 *      → axiomate fails to start with "currentModel X is not defined"
 *        BEFORE the user can run /model to pick a new one. We re-assign
 *        currentModel to any remaining model so launch succeeds.
 *
 *   2. config.fastModel / config.midModel pointing at deleted models
 *      → not fatal (these have graceful fallbacks), but stale state we
 *        clear on the way through.
 *
 *   3. settings.model pointing at a deleted model
 *      → also has a fallback (config.currentModel), but cleared for
 *        cleanliness.
 *
 *   4. settings.effortByModel keys that no longer exist
 *      → harmless but accumulates; if a user re-adds a model with the
 *        same name later it'd silently inherit the old effort, which
 *        is rarely intentional.
 *
 * All four buckets are pruned in a single pass so a user who hand-edits
 * ~/.axiomate.json doesn't get stuck with a non-bootable axiomate.
 */

import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { logForDebugging } from '../debug.js'
import {
  normalizeModelRoutingConfig,
} from '../model/modelRouting.js'
import { jsonStringify } from '../slowOperations.js'
import { getSettingsForSource, updateSettingsForSource } from './settings.js'

export function migrateOrphanModelReferences(): void {
  const config = getGlobalConfig()
  const validIds = new Set(Object.keys(config.models ?? {}))

  // ── Heal model routes + legacy references ────────────────────────────
  // Must run BEFORE getInitialMainLoopModel() — otherwise route/model
  // resolution can throw and the program exits before /model is reachable.
  let configChanged = false
  let healedCurrentModel: string | undefined
  let nextConfig = normalizeModelRoutingConfig(config)
  let nextCurrent = nextConfig.currentModel
  let nextFast = nextConfig.fastModel
  let nextMid = nextConfig.midModel

  if (
    nextConfig.currentModel &&
    !validIds.has(nextConfig.currentModel) &&
    validIds.size > 0
  ) {
    const fallback = [...validIds][0]!
    healedCurrentModel = fallback
    nextCurrent = fallback
    configChanged = true
  }
  if (nextConfig.fastModel && !validIds.has(nextConfig.fastModel)) {
    nextFast = undefined
    configChanged = true
  }
  if (nextConfig.midModel && !validIds.has(nextConfig.midModel)) {
    nextMid = undefined
    configChanged = true
  }

  if (
    jsonStringify(nextConfig.model) !== jsonStringify(config.model) ||
    jsonStringify(nextConfig.auxiliary) !== jsonStringify(config.auxiliary)
  ) {
    nextConfig = normalizeModelRoutingConfig({
      ...nextConfig,
      currentModel: nextCurrent,
      fastModel: nextFast,
      midModel: nextMid,
    })
    configChanged = true
  }

  if (configChanged) {
    saveGlobalConfig(c =>
      normalizeModelRoutingConfig({
        ...c,
        model: nextConfig.model,
        auxiliary: nextConfig.auxiliary,
        currentModel: nextCurrent,
        fastModel: nextFast,
        midModel: nextMid,
      }),
    )
    if (healedCurrentModel !== undefined) {
      logForDebugging(
        `[migrate] currentModel '${config.currentModel}' no longer exists in config.models; auto-reassigned to '${healedCurrentModel}'. Use /model to pick a different one.`,
      )
    }
  }

  // ── Heal settings.model + settings.effortByModel ─────────────────────
  const settings = getSettingsForSource('userSettings')
  if (!settings) return
  let settingsChanged = false
  const next: Record<string, unknown> = { ...settings }

  if (
    typeof settings.model === 'string' &&
    settings.model.length > 0 &&
    !validIds.has(settings.model)
  ) {
    delete next.model
    settingsChanged = true
  }

  if (settings.effortByModel) {
    const cleaned: Record<string, unknown> = {}
    let prunedAny = false
    for (const [id, value] of Object.entries(settings.effortByModel)) {
      if (validIds.has(id)) {
        cleaned[id] = value
      } else {
        prunedAny = true
      }
    }
    if (prunedAny) {
      next.effortByModel = cleaned
      settingsChanged = true
    }
  }

  if (settingsChanged) {
    updateSettingsForSource('userSettings', next as never)
  }
}

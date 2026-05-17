/**
 * One-shot startup migration: detect the legacy global `effortLevel` field
 * in ~/.axiomate/settings.json and remove it.
 *
 * Background: effort used to be a single global setting that applied to
 * every model. Different vendors have different supported effort domains,
 * so a global value caused wire-level rejections (e.g. anthropic + 'max').
 * The replacement is `effortByModel: Record<string, EffortLevel>`. We
 * intentionally do NOT migrate the old value — it's ambiguous (which model
 * was it last set for?) and any user with a value pinned needs to set it
 * explicitly per-model anyway.
 *
 * The schema is `.passthrough()`, so an old `effortLevel` field would
 * survive a round-trip parse-and-write as an unknown key. This migration
 * runs once on startup; subsequent runs are no-ops.
 *
 * `models[*].thinking.effort` in ~/.axiomate.json is left untouched —
 * those are model-default values written by the onboarding wizard, not
 * user-recent choices, and remain valid.
 */

import {
  getSettingsForSource,
  updateSettingsForSource,
} from './settings.js'

export function migrateLegacyEffortLevelField(): void {
  const settings = getSettingsForSource('userSettings')
  if (!settings) return
  if (!('effortLevel' in (settings as Record<string, unknown>))) return

  const next = { ...(settings as Record<string, unknown>) }
  delete next.effortLevel
  updateSettingsForSource('userSettings', next as never)
}

import { useAppState } from '../state/AppState.js'
import { getGlobalConfig } from '../utils/config.js'
import {
  getDefaultMainLoopModelSetting,
  type ModelName,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import { resolveMainModelOverride } from '../utils/model/modelRouting.js'

// The value of the selector is a full model name that can be used directly in
// API calls. Use this over getMainLoopModel() when the component needs to
// update upon a model config change.
export function useMainLoopModel(): ModelName {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelOverrideForSession = useAppState(
    s => s.mainLoopModelOverrideForSession,
  )

  if (mainLoopModelOverrideForSession) {
    return resolveMainModelOverride(
      getGlobalConfig(),
      mainLoopModelOverrideForSession,
    ).primary
  }
  const model = parseUserSpecifiedModel(
    mainLoopModel ?? getDefaultMainLoopModelSetting(),
  )
  return model
}

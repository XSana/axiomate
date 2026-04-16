import { getDefaultMainLoopModel } from '../model/model.js'

// Fallback model for new teammates when user has not set teammateDefaultModel.
// Uses the user's configured main model.
export function getHardcodedTeammateModelFallback(): string {
  return getDefaultMainLoopModel()
}

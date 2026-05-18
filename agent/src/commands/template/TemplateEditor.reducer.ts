/**
 * Pure state machine for `/template vendor new` and `/template model new`.
 *
 * The reducer is shared between the two; the `kind` field carries which
 * editor flow we're in so the UI / save handler can branch:
 *   - 'vendor' has an `extends` step (pick a base built-in)
 *   - 'model' skips the extends step (model templates don't inherit)
 *
 * Phases:
 *   - name:     collecting template name (TextInput)
 *   - extends:  picking the base template (Select; vendor only)
 *   - opening:  about to spawn $EDITOR with prefilled JSON
 *   - invalid:  editor closed but JSON parse / Zod validation failed
 *   - done:     terminal — onComplete or onCancel has fired
 */

export type TemplateKind = 'vendor' | 'model'

export type TemplateEditorState =
  | { phase: 'name'; kind: TemplateKind }
  | { phase: 'extends'; kind: TemplateKind; name: string }
  | {
      phase: 'opening'
      kind: TemplateKind
      name: string
      /**
       * For vendor: '__none__' (scratch) or a builtin name.
       * For model:  always '__none__' (no extends step).
       */
      baseName: string
      /** When set, reuse existing temp file (Re-edit path). */
      reusePath?: string
    }
  | {
      phase: 'invalid'
      kind: TemplateKind
      name: string
      baseName: string
      error: string
      tempPath: string
    }
  | { phase: 'done'; kind: TemplateKind }

export type TemplateEditorAction =
  | { type: 'submitName'; name: string }
  | { type: 'submitExtends'; baseName: string }
  | { type: 'editorSucceeded' }
  | { type: 'editorCancelled' }
  | { type: 'editorInvalid'; error: string; tempPath: string }
  | { type: 'retry' }
  | { type: 'cancel' }
  | { type: 'backToName' }

export function makeInitialState(kind: TemplateKind): TemplateEditorState {
  return { phase: 'name', kind }
}

/**
 * Backwards-compat alias for the original vendor-only initial state.
 * Used by existing tests; new callers should prefer makeInitialState.
 */
export const initialTemplateEditorState: TemplateEditorState =
  makeInitialState('vendor')

export function templateEditorReducer(
  state: TemplateEditorState,
  action: TemplateEditorAction,
): TemplateEditorState {
  switch (action.type) {
    case 'submitName':
      // Model templates skip the extends step (no inheritance for models).
      if (state.phase === 'name' && state.kind === 'model') {
        return {
          phase: 'opening',
          kind: 'model',
          name: action.name,
          baseName: '__none__',
        }
      }
      return { phase: 'extends', kind: state.kind, name: action.name }
    case 'submitExtends':
      if (state.phase !== 'extends') return state
      return {
        phase: 'opening',
        kind: state.kind,
        name: state.name,
        baseName: action.baseName,
      }
    case 'editorSucceeded':
      return { phase: 'done', kind: state.kind }
    case 'editorCancelled':
      return { phase: 'done', kind: state.kind }
    case 'editorInvalid':
      if (state.phase !== 'opening') return state
      return {
        phase: 'invalid',
        kind: state.kind,
        name: state.name,
        baseName: state.baseName,
        error: action.error,
        tempPath: action.tempPath,
      }
    case 'retry':
      if (state.phase !== 'invalid') return state
      return {
        phase: 'opening',
        kind: state.kind,
        name: state.name,
        baseName: state.baseName,
        reusePath: state.tempPath,
      }
    case 'cancel':
      return { phase: 'done', kind: state.kind }
    case 'backToName':
      return { phase: 'name', kind: state.kind }
  }
}

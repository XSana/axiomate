/**
 * Pure state machine for `/template new`.
 *
 * Phases:
 *   - name:     collecting template name (TextInput)
 *   - extends:  picking the base template (Select)
 *   - opening:  about to spawn $EDITOR with prefilled JSON
 *   - invalid:  editor closed but JSON parse / Zod validation failed
 *   - done:     terminal — onComplete or onCancel has fired
 */

export type TemplateEditorState =
  | { phase: 'name' }
  | { phase: 'extends'; name: string }
  | {
      phase: 'opening'
      name: string
      /** baseName is __none__ for "write from scratch", or a builtin name. */
      baseName: string
      /** When set, reuse existing temp file (Re-edit path). */
      reusePath?: string
    }
  | {
      phase: 'invalid'
      name: string
      baseName: string
      error: string
      tempPath: string
    }
  | { phase: 'done' }

export type TemplateEditorAction =
  | { type: 'submitName'; name: string }
  | { type: 'submitExtends'; baseName: string }
  | { type: 'editorSucceeded' }
  | { type: 'editorCancelled' }
  | { type: 'editorInvalid'; error: string; tempPath: string }
  | { type: 'retry' }
  | { type: 'cancel' }
  | { type: 'backToName' }

export const initialTemplateEditorState: TemplateEditorState = { phase: 'name' }

export function templateEditorReducer(
  state: TemplateEditorState,
  action: TemplateEditorAction,
): TemplateEditorState {
  switch (action.type) {
    case 'submitName':
      return { phase: 'extends', name: action.name }
    case 'submitExtends':
      if (state.phase !== 'extends') return state
      return { phase: 'opening', name: state.name, baseName: action.baseName }
    case 'editorSucceeded':
      return { phase: 'done' }
    case 'editorCancelled':
      return { phase: 'done' }
    case 'editorInvalid':
      if (state.phase !== 'opening') return state
      return {
        phase: 'invalid',
        name: state.name,
        baseName: state.baseName,
        error: action.error,
        tempPath: action.tempPath,
      }
    case 'retry':
      if (state.phase !== 'invalid') return state
      return {
        phase: 'opening',
        name: state.name,
        baseName: state.baseName,
        reusePath: state.tempPath,
      }
    case 'cancel':
      return { phase: 'done' }
    case 'backToName':
      return { phase: 'name' }
  }
}

/**
 * Pure state machine for `/model edit <id>`.
 *
 * Two phases:
 *   - opening: about to spawn $EDITOR (or just spawned and waiting for result)
 *   - invalid: editor closed but JSON parse / Zod validation failed; user sees
 *     [Re-edit] / [Cancel]
 *   - done: terminal — onDone has fired, component about to unmount
 *
 * The "opening" phase is entered both initially and on Re-edit (from invalid).
 * The component owns the side effect (spawn editor) but the reducer owns the
 * decision tree.
 */

export type ModelEditorState =
  | { phase: 'opening'; reusePath?: string }
  | { phase: 'invalid'; error: string; tempPath: string }
  | { phase: 'done' }

export type ModelEditorAction =
  | { type: 'editorSucceeded' }
  | { type: 'editorCancelled' }
  | { type: 'editorInvalid'; error: string; tempPath: string }
  | { type: 'editorMissingModel' }
  | { type: 'retry' }
  | { type: 'cancel' }

export const initialModelEditorState: ModelEditorState = { phase: 'opening' }

export function modelEditorReducer(
  state: ModelEditorState,
  action: ModelEditorAction,
): ModelEditorState {
  switch (action.type) {
    case 'editorSucceeded':
      return { phase: 'done' }
    case 'editorCancelled':
      return { phase: 'done' }
    case 'editorMissingModel':
      return { phase: 'done' }
    case 'editorInvalid':
      return { phase: 'invalid', error: action.error, tempPath: action.tempPath }
    case 'retry':
      if (state.phase !== 'invalid') return state
      return { phase: 'opening', reusePath: state.tempPath }
    case 'cancel':
      return { phase: 'done' }
  }
}

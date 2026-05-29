import * as React from 'react'
import { Box, Text } from '../../ink.js'
import chalk from 'chalk'
import type { CommandResultDisplay } from '../../commands.js'
import { Select } from '../../components/CustomSelect/select.js'
import {
  getGlobalConfig,
  saveModelToConfig,
  type ModelProviderConfig,
} from '../../utils/config.js'
import { ModelProviderConfigSchema } from '../../utils/modelConfigSchema.js'
import { editJsonInEditor } from '../../utils/promptEditor.js'
import {
  initialModelEditorState,
  modelEditorReducer,
  type ModelEditorAction,
  type ModelEditorState,
} from './ModelEditor.reducer.js'
import { validateModelEditConfig } from './modelEditorValidation.js'

/**
 * `/model edit <id>` — spawn $EDITOR with the existing model entry as JSON,
 * validate the result against ModelProviderConfigSchema, persist on success.
 *
 * Reducer-driven (matches OnboardingProviderStep idiom): the side effect
 * (editJsonInEditor) runs in a useEffect keyed on phase === 'opening', and
 * dispatches the appropriate action with the result.
 */
export function ModelEditor({
  modelId,
  onDone,
}: {
  modelId: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const [state, dispatch] = React.useReducer(
    modelEditorReducer,
    initialModelEditorState,
  )

  // Run the spawn-editor side effect on every entry into 'opening' phase.
  // Two reasons we may enter 'opening':
  //   1. component first mounts (reusePath undefined → fresh editor)
  //   2. user picked Re-edit from the invalid screen (reusePath set)
  React.useEffect(() => {
    if (state.phase !== 'opening') return

    if (!state.reusePath) {
      const config = getGlobalConfig()
      const entry = config.models?.[modelId]
      if (!entry) {
        onDone(
          chalk.yellow(
            `Model '${modelId}' is not configured. Run /model add to add it.`,
          ),
          { display: 'system' },
        )
        dispatch({ type: 'editorMissingModel' })
        return
      }

      const result = editJsonInEditor<ModelProviderConfig>({
        initialContent: JSON.stringify(entry, null, 2) + '\n',
        schema: buildModelEditSchema(modelId),
        filenameHint: `axiomate-model-${modelId.replace(/[^A-Za-z0-9]/g, '_')}`,
      })
      handleResult(result, modelId, onDone, dispatch)
      return
    }

    const result = editJsonInEditor<ModelProviderConfig>({
      mode: 'reuse',
      reusePath: state.reusePath,
      schema: buildModelEditSchema(modelId),
    })
    handleResult(result, modelId, onDone, dispatch)
  }, [state.phase, state.phase === 'opening' ? state.reusePath : undefined, modelId, onDone])

  if (state.phase === 'invalid') {
    return (
      <RetryPrompt
        error={state.error}
        onRetry={() => dispatch({ type: 'retry' })}
        onCancel={() => {
          onDone(`Edit cancelled — ${modelId} unchanged`, {
            display: 'system',
          })
          dispatch({ type: 'cancel' })
        }}
      />
    )
  }

  return null
}

function handleResult(
  result: ReturnType<typeof editJsonInEditor<ModelProviderConfig>>,
  modelId: string,
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void,
  dispatch: React.Dispatch<ModelEditorAction>,
): void {
  if (result.ok) {
    saveModelToConfig(modelId, result.value)
    onDone(`Saved changes to ${chalk.bold(modelId)}`)
    dispatch({ type: 'editorSucceeded' })
    return
  }
  if ('cancelled' in result && result.cancelled) {
    onDone(`No changes to ${chalk.bold(modelId)}`, { display: 'system' })
    dispatch({ type: 'editorCancelled' })
    return
  }
  if ('error' in result) {
    dispatch({
      type: 'editorInvalid',
      error: result.error,
      tempPath: result.tempPath,
    })
  }
}

function buildModelEditSchema(
  modelId: string,
): import('zod').ZodSchema<ModelProviderConfig> {
  return (
    ModelProviderConfigSchema as unknown as import('zod').ZodSchema<ModelProviderConfig>
  ).superRefine((value, ctx) => {
    const error = validateModelEditConfig(getGlobalConfig(), modelId, value)
    if (!error) return
    ctx.addIssue({
      code: 'custom',
      message: error,
    })
  })
}

function RetryPrompt({
  error,
  onRetry,
  onCancel,
}: {
  error: string
  onRetry: () => void
  onCancel: () => void
}): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text color="error">Edit failed validation:</Text>
        <Text color="error">{error}</Text>
      </Box>
      <Select
        options={[
          { label: 'Re-edit (preserves your typed JSON)', value: 'retry' },
          { label: 'Cancel — discard changes', value: 'cancel' },
        ]}
        onChange={v => {
          if (v === 'retry') onRetry()
          else onCancel()
        }}
        onCancel={onCancel}
      />
    </Box>
  )
}

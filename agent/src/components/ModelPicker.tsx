import capitalize from 'lodash-es/capitalize.js'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import {
  logEvent,
} from '../services/analytics/index.js'
import { Box, Text } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  type EffortValue,
  getDefaultEffortForModel,
  getConfiguredModelEffort,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  getCyclableEffortLevels,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  getDefaultMainLoopModel,
  type ModelSetting,
  modelDisplayString,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'
import { getModelOptions } from '../utils/model/modelOptions.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { effortLevelToSymbol } from './EffortIndicator.js'

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  /** Overrides the dim header line below "Select model". */
  headerText?: string
  /**
   * When true, skip writing effortLevel to userSettings on selection.
   * Used by the assistant installer wizard where the model choice is
   * project-scoped (written to the assistant's .axiomate/settings.json via
   * install.ts) and should not leak to the user's global ~/.axiomate/settings.
   */
  skipSettingsWrite?: boolean
}

const NO_PREFERENCE = '__NO_PREFERENCE__'

export function ModelPicker({
  initial,
  sessionModel,
  onSelect,
  onCancel,
  isStandaloneCommand,
  headerText,
  skipSettingsWrite,
}: Props): React.ReactNode {
  const setAppState = useSetAppState()
  const exitState = useExitOnCtrlCDWithKeybindings()
  const maxVisible = 10

  const initialValue = initial === null ? NO_PREFERENCE : initial
  const [focusedValue, setFocusedValue] = useState<string | undefined>(
    initialValue,
  )

  const [hasToggledEffort, setHasToggledEffort] = useState(false)
  const effortValueByModel = useAppState(s => s.effortValueByModel)
  // Initialize effort from the currently-focused model's session entry.
  // The focused model on mount is `initialFocusValue` (typically the
  // active model), so seed effort from that model's dict slot.
  const [effort, setEffort] = useState<EffortLevel | undefined>(() => {
    const m = resolveOptionModel(initialValue)
    const v = m ? effortValueByModel?.[m] : undefined
    return v !== undefined ? convertEffortValueToLevel(v) : undefined
  })

  // Memoize all derived values to prevent re-renders
  const modelOptions = useMemo(() => getModelOptions(), [])

  // Ensure the initial value is in the options list
  // This handles edge cases where the user's current provider-specific model
  // is not in the base options but should still be selectable and shown as selected
  const optionsWithInitial = useMemo(() => {
    if (initial !== null && !modelOptions.some(opt => opt.value === initial)) {
      return [
        ...modelOptions,
        {
          value: initial,
          label: modelDisplayString(initial),
          description: 'Current model',
        },
      ]
    }
    return modelOptions
  }, [modelOptions, initial])

  const selectOptions = useMemo(
    () =>
      optionsWithInitial.map(opt => ({
        ...opt,
        value: opt.value === null ? NO_PREFERENCE : opt.value,
      })),
    [optionsWithInitial],
  )
  const initialFocusValue = useMemo(
    () =>
      selectOptions.some(_ => _.value === initialValue)
        ? initialValue
        : (selectOptions[0]?.value ?? undefined),
    [selectOptions, initialValue],
  )
  const visibleCount = Math.min(maxVisible, selectOptions.length)
  const hiddenCount = Math.max(0, selectOptions.length - visibleCount)

  const focusedModelName = selectOptions.find(
    opt => opt.value === focusedValue,
  )?.label
  const focusedModel = resolveOptionModel(focusedValue)
  const focusedSupportsEffort = focusedModel
    ? modelSupportsEffort(focusedModel)
    : false
  const focusedConfiguredEffort = focusedModel
    ? getConfiguredModelEffort(focusedModel)
    : undefined
  const focusedSupportsMax = focusedModel
    ? modelSupportsMaxEffort(focusedModel)
    : false
  const focusedAllowedLevels = focusedModel
    ? getCyclableEffortLevels(focusedModel)
    : []
  const focusedDefaultEffort = getDefaultEffortLevelForOption(focusedValue)
  // Clamp display when 'max' is selected but the focused model doesn't support it.
  // resolveAppliedEffort() does the same downgrade at API-send time.
  const displayEffort =
    effort === 'max' && !focusedSupportsMax ? 'high' : effort

  const handleFocus = useCallback(
    (value: string) => {
      setFocusedValue(value)
      // Pull the focused model's effort from AppState (per-model dict).
      // Reset hasToggledEffort: each model has its own toggle state.
      // If the model has no session entry, fall back to its configured default.
      const m = resolveOptionModel(value)
      const sessionEffort = m ? effortValueByModel?.[m] : undefined
      if (sessionEffort !== undefined) {
        setEffort(convertEffortValueToLevel(sessionEffort))
      } else {
        setEffort(getDefaultEffortLevelForOption(value))
      }
      setHasToggledEffort(false)
    },
    [effortValueByModel],
  )

  // Effort level cycling keybindings
  const handleCycleEffort = useCallback(
    (direction: 'left' | 'right') => {
      if (!focusedSupportsEffort) return
      setEffort(prev =>
        cycleEffortLevel(
          prev ?? focusedDefaultEffort,
          direction,
          focusedAllowedLevels,
        ),
      )
      setHasToggledEffort(true)
    },
    [focusedSupportsEffort, focusedAllowedLevels, focusedDefaultEffort],
  )

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => handleCycleEffort('left'),
      'modelPicker:increaseEffort': () => handleCycleEffort('right'),
    },
    { context: 'ModelPicker' },
  )

  function handleSelect(value: string): void {
    const selectedModel = resolveOptionModel(value)
    if (!skipSettingsWrite && selectedModel) {
      // Prior comes from userSettings on disk for THIS model — NOT merged
      // settings (which includes project/policy layers that must not leak
      // into the user's global ~/.axiomate/settings.json), and NOT
      // AppState.effortValueByModel (which includes session-ephemeral
      // sources like --effort CLI flag and skill overrides).
      const priorByModel =
        getSettingsForSource('userSettings')?.effortByModel ?? {}
      const effortLevel = resolvePickerEffortPersistence(
        effort,
        getDefaultEffortLevelForOption(value),
        priorByModel[selectedModel],
        hasToggledEffort,
      )
      const persistable = toPersistableEffort(effortLevel)
      // Only persist effort when the user explicitly toggled it in this picker
      // session — otherwise we'd perpetuate whatever value happens to be in
      // userSettings on every model switch.
      if (persistable !== undefined && hasToggledEffort) {
        updateSettingsForSource('userSettings', {
          effortByModel: { ...priorByModel, [selectedModel]: persistable },
        })
      }
      setAppState(prev => {
        const prior = prev.effortValueByModel ?? {}
        const next: Record<string, EffortValue> = { ...prior }
        if (effortLevel === undefined) {
          delete next[selectedModel]
        } else {
          next[selectedModel] = effortLevel
        }
        return { ...prev, effortValueByModel: next }
      })
    }

    const selectedEffort =
      hasToggledEffort && selectedModel && modelSupportsEffort(selectedModel)
        ? effort
        : undefined
    if (value === NO_PREFERENCE) {
      onSelect(null, selectedEffort)
      return
    }
    onSelect(value, selectedEffort)
  }

  const content = (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>
            Select model
          </Text>
          <Text dimColor>
            {headerText ??
              'Switch between models. Applies to this session and future Axiomate sessions. For other/previous model names, specify with --model.'}
          </Text>
          {sessionModel && (
            <Text dimColor>
              Currently using {modelDisplayString(sessionModel)} for this
              session (set by plan mode). Selecting a model will undo this.
            </Text>
          )}
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="column">
            <Select
              defaultValue={initialValue}
              defaultFocusValue={initialFocusValue}
              options={selectOptions}
              onChange={handleSelect}
              onFocus={handleFocus}
              onCancel={onCancel ?? (() => {})}
              visibleOptionCount={visibleCount}
            />
          </Box>
          {hiddenCount > 0 && (
            <Box paddingLeft={3}>
              <Text dimColor>and {hiddenCount} more…</Text>
            </Box>
          )}
        </Box>

        <Box marginBottom={1} flexDirection="column">
          {focusedSupportsEffort ? (
            <Text dimColor>
              <EffortLevelIndicator effort={displayEffort} />{' '}
              {capitalize(displayEffort)} effort
              {displayEffort === focusedDefaultEffort ? ` (default)` : ``}{' '}
              <Text color="subtle">← → to adjust</Text>
            </Text>
          ) : focusedConfiguredEffort ? (
            <Text dimColor>
              <EffortLevelIndicator effort={focusedConfiguredEffort} />{' '}
              {capitalize(focusedConfiguredEffort)} effort
            </Text>
          ) : (
            <Text color="subtle">
              <EffortLevelIndicator effort={undefined} /> Effort not supported
              {focusedModelName ? ` for ${focusedModelName}` : ''}
            </Text>
          )}
        </Box>

      </Box>

      {isStandaloneCommand && (
        <Text dimColor italic>
          {exitState.pending ? (
            <>Press {exitState.keyName} again to exit</>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Enter" action="confirm" />
              <ConfigurableShortcutHint
                action="select:cancel"
                context="Select"
                fallback="Esc"
                description="exit"
              />
            </Byline>
          )}
        </Text>
      )}
    </Box>
  )

  if (!isStandaloneCommand) {
    return content
  }

  return <Pane color="permission">{content}</Pane>
}

function resolveOptionModel(value?: string): string | undefined {
  if (!value) return undefined
  return value === NO_PREFERENCE
    ? getDefaultMainLoopModel()
    : parseUserSpecifiedModel(value)
}

function EffortLevelIndicator({
  effort,
}: {
  effort?: EffortLevel
}): React.ReactNode {
  return (
    <Text color={effort ? 'axiomate' : 'subtle'}>
      {effortLevelToSymbol(effort ?? 'low')}
    </Text>
  )
}

function cycleEffortLevel(
  current: EffortLevel,
  direction: 'left' | 'right',
  allowedLevels: EffortLevel[],
): EffortLevel {
  if (allowedLevels.length === 0) return current
  // If the current level isn't in the cycle (e.g. 'max' after switching
  // to a model whose vendor doesn't expose max), fall back to 'high' if
  // present, otherwise the first allowed level.
  const idx = allowedLevels.indexOf(current)
  const fallbackIdx = allowedLevels.indexOf('high')
  const currentIndex = idx !== -1 ? idx : fallbackIdx !== -1 ? fallbackIdx : 0
  const len = allowedLevels.length
  if (direction === 'right') {
    return allowedLevels[(currentIndex + 1) % len]!
  } else {
    return allowedLevels[(currentIndex - 1 + len) % len]!
  }
}

function getDefaultEffortLevelForOption(value?: string): EffortLevel {
  const resolved = resolveOptionModel(value) ?? getDefaultMainLoopModel()
  const defaultValue = getDefaultEffortForModel(resolved)
  return defaultValue !== undefined
    ? convertEffortValueToLevel(defaultValue)
    : 'high'
}

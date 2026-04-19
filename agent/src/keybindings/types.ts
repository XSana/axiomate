// Shared keybinding types consumed across keybinding/permission modules.

export type KeybindingAction = string

export type KeybindingContextName = string

export interface ParsedKeystroke {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  super?: boolean
}

export type Chord = ParsedKeystroke[]

export interface KeybindingBlock {
  context: KeybindingContextName
  bindings: Record<string, KeybindingAction>
}

export interface ParsedBinding {
  chord: Chord
  action: KeybindingAction
  context: KeybindingContextName
}

export type KeybindingWarning = {
  message: string
  severity: 'warning' | 'error'
}

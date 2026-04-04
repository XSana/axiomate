export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

/** Get all currently pressed modifier keys. Empty array on non-macOS. */
export function getModifiers(): string[]

/** Check if a specific modifier key is currently pressed. False on non-macOS. */
export function isModifierPressed(modifier: string): boolean

/** Pre-warm the native module (triggers .node loading). */
export function prewarm(): void

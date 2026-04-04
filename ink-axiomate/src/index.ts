// Root
export { default as render, createRoot, renderSync } from './root.js'
export type { RenderOptions, Instance, Root } from './root.js'

// Components
export { default as App } from './components/App.js'
export { handleMouseEvent } from './components/App.js'
export { default as Box } from './components/Box.js'
export type { Props as BoxProps } from './components/Box.js'
export { default as Text } from './components/Text.js'
export type { Props as TextProps } from './components/Text.js'
export { default as Button } from './components/Button.js'
export type { Props as ButtonProps, ButtonState } from './components/Button.js'
export { default as ScrollBox } from './components/ScrollBox.js'
export type {
	ScrollBoxHandle,
	ScrollBoxProps,
} from './components/ScrollBox.js'
export { default as Link } from './components/Link.js'
export { default as Newline } from './components/Newline.js'
export { default as Spacer } from './components/Spacer.js'
export { NoSelect } from './components/NoSelect.js'
export { RawAnsi } from './components/RawAnsi.js'
export { AlternateScreen } from './components/AlternateScreen.js'

// Contexts
export { default as AppContext } from './components/AppContext.js'
export { default as StdinContext } from './components/StdinContext.js'
export {
	TerminalSizeContext,
	type TerminalSize,
} from './components/TerminalSizeContext.js'
export {
	default as TerminalFocusContext,
	TerminalFocusProvider,
} from './components/TerminalFocusContext.js'
export type {
	TerminalFocusState,
	TerminalFocusContextProps,
} from './components/TerminalFocusContext.js'
export {
	ClockContext,
	ClockProvider,
	createClock,
} from './components/ClockContext.js'
export type { Clock } from './components/ClockContext.js'
export { default as CursorDeclarationContext } from './components/CursorDeclarationContext.js'
export type {
	CursorDeclaration,
	CursorDeclarationSetter,
} from './components/CursorDeclarationContext.js'

// Ansi
export { Ansi } from './Ansi.js'

// Hooks
export { default as useInput } from './hooks/use-input.js'
export { default as useApp } from './hooks/use-app.js'
export { default as useStdin } from './hooks/use-stdin.js'
export { useSelection, useHasSelection } from './hooks/use-selection.js'
export { useSearchHighlight } from './hooks/use-search-highlight.js'
export { useTerminalFocus } from './hooks/use-terminal-focus.js'
export { useTerminalViewport } from './hooks/use-terminal-viewport.js'
export { useDeclaredCursor } from './hooks/use-declared-cursor.js'
export { useAnimationFrame } from './hooks/use-animation-frame.js'
export {
	useAnimationTimer,
	useInterval,
} from './hooks/use-interval.js'
export { useTabStatus } from './hooks/use-tab-status.js'
export type { TabStatusKind } from './hooks/use-tab-status.js'
export { useTerminalTitle } from './hooks/use-terminal-title.js'

// Configuration
export { configure, adapters } from './adapters.js'
export type { InkAdapters } from './adapters.js'

// Types
export type { DOMElement } from './dom.js'
export type { Styles } from './styles.js'
export { InputEvent } from './events/input-event.js'
export type { Key } from './events/input-event.js'
export { ClickEvent } from './events/click-event.js'
export { FocusEvent } from './events/focus-event.js'
export { KeyboardEvent } from './events/keyboard-event.js'
export { Event } from './events/event.js'
export { EventEmitter } from './events/emitter.js'

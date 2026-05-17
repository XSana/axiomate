import { env } from '../utils/env.js'

// The former is better vertically aligned, but isn't usually supported on Windows/Linux
export const BLACK_CIRCLE = env.platform === 'darwin' ? '⏺' : '●'
export const BULLET_OPERATOR = '∙'
export const TEARDROP_ASTERISK = '✻'
export const UP_ARROW = '↑' // ↑ - used for upgrade notices
export const DOWN_ARROW = '↓' // ↓ - used for scroll hint
export const EFFORT_NONE = '∅' // ∅ - effort level: none (thinking off)
export const EFFORT_LOW = '○' // ○ - effort level: low
export const EFFORT_MEDIUM = '◐' // ◐ - effort level: medium
export const EFFORT_HIGH = '●' // ● - effort level: high
export const EFFORT_MAX = '◉' // ◉ - effort level: max

// Media/trigger status indicators
export const PLAY_ICON = '▶' // ▶
export const PAUSE_ICON = '⏸' // ⏸

// MCP subscription indicators
export const REFRESH_ARROW = '↻' // ↻ - used for resource update indicator
export const INJECTED_ARROW = '→' // → - cross-session injected message indicator
export const FORK_GLYPH = '⑂' // ⑂ - fork directive indicator

// Background-task status indicators
export const DIAMOND_OPEN = '◇' // ◇ - running
export const DIAMOND_FILLED = '◆' // ◆ - completed/failed
export const REFERENCE_MARK = '※' // ※ - komejirushi, away-summary recap marker

// Issue flag indicator
export const FLAG_ICON = '⚑' // ⚑ - used for issue flag banner

// Blockquote indicator
export const BLOCKQUOTE_BAR = '▎' // ▎ - left one-quarter block, used as blockquote line prefix
export const HEAVY_HORIZONTAL = '━' // ━ - heavy box-drawing horizontal

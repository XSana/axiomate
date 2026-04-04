
import { adapters } from './adapters.js'
export function ifNotInteger(value: number | undefined, name: string): void {
  if (value === undefined) return
  if (Number.isInteger(value)) return
  adapters.logForDebugging(`${name} should be an integer, got ${value}`, {
    level: 'warn',
  })
}

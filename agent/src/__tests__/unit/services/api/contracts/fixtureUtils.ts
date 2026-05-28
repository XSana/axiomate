import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
)

export function readFixture<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(join(fixtureRoot, relativePath), 'utf8'),
  ) as T
}

export function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJson)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableJson(child)]),
    )
  }
  return value
}

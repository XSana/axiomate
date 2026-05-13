import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

export type NdjsonReader = AsyncGenerator<unknown, void, undefined>

export async function* createNdjsonReader(stream: Readable): NdjsonReader {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      yield JSON.parse(trimmed)
    } catch {
      // Skip malformed lines (e.g., stderr leaking into stdout)
    }
  }
}

export function writeNdjsonMessage(stream: Writable, message: unknown): void {
  const serialized = JSON.stringify(message)
  stream.write(serialized + '\n')
}

export function writeKeepAlive(stream: Writable): void {
  writeNdjsonMessage(stream, { type: 'keep_alive' })
}

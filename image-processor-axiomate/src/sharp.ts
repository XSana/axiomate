/**
 * Sharp wrapper — thin proxy to npm sharp with API compatible with
 * claude-code's image-processor-napi interface.
 */

import type { SharpFunction, SharpCreator, SharpCreatorOptions, SharpInstance } from './types.js'

type MaybeDefault<T> = T | { default: T }

function unwrapDefault<T extends (...args: never[]) => unknown>(mod: MaybeDefault<T>): T {
  return typeof mod === 'function' ? mod : mod.default
}

let cachedSharp: SharpFunction | null = null
let cachedCreator: SharpCreator | null = null

/**
 * Get the sharp image processor function.
 * Lazily loads the sharp npm package on first call.
 */
export async function getImageProcessor(): Promise<SharpFunction> {
  if (cachedSharp) return cachedSharp

  const imported = (await import('sharp')) as unknown as MaybeDefault<SharpFunction>
  cachedSharp = unwrapDefault(imported)
  return cachedSharp
}

/**
 * Get the sharp image creator for generating new images from scratch.
 */
export async function getImageCreator(): Promise<SharpCreator> {
  if (cachedCreator) return cachedCreator

  const imported = (await import('sharp')) as unknown as MaybeDefault<SharpCreator>
  cachedCreator = unwrapDefault(imported)
  return cachedCreator
}

/**
 * Synchronous-style sharp factory.
 * Creates a SharpInstance from a Buffer.
 * Note: sharp is loaded lazily, so first call triggers the import.
 * Subsequent calls are synchronous (cached).
 */
export function sharp(input: Buffer): SharpInstance {
  if (!cachedSharp) {
    throw new Error(
      'sharp not loaded yet. Call getImageProcessor() first, or use sharpAsync().',
    )
  }
  return cachedSharp(input)
}

/**
 * Async sharp factory — loads sharp if needed, then creates a SharpInstance.
 */
export async function sharpAsync(input: Buffer): Promise<SharpInstance> {
  const fn = await getImageProcessor()
  return fn(input)
}

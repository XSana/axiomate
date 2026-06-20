/**
 * One-shot generator for the Windows app icon.
 *
 * Reads resources/icon/axiomate.png and writes resources/icon/axiomate.ico,
 * an ICO container embedding multiple PNG-compressed images at the sizes
 * Windows uses across the shell (taskbar, explorer, alt-tab, etc.). Modern
 * Windows (Vista+) reads PNG-compressed entries directly, so we skip the
 * legacy BMP/DIB encoding entirely.
 *
 * Run manually whenever the source PNG changes:
 *   bun run agent/generateWinIcon.ts
 *
 * The committed axiomate.ico is what package-win.ts embeds via
 * `bun build --compile --windows-icon=...` — packaging does NOT regenerate it.
 */

import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import sharp from 'sharp'

// Sizes Windows expects in a well-formed application icon.
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256] as const

/**
 * Build an ICO buffer from a source PNG path. Each entry stores a
 * PNG-compressed image; the directory header points at them by offset.
 */
export async function generateIco(sourcePng: string): Promise<Buffer> {
  const pngs = await Promise.all(
    ICON_SIZES.map(size =>
      sharp(sourcePng)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    ),
  )

  const count = pngs.length
  const headerSize = 6
  const dirEntrySize = 16
  const dirSize = dirEntrySize * count

  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(count, 4) // image count

  const dir = Buffer.alloc(dirSize)
  let offset = headerSize + dirSize
  for (let i = 0; i < count; i++) {
    const size = ICON_SIZES[i]
    const png = pngs[i]
    const entry = dir.subarray(i * dirEntrySize, (i + 1) * dirEntrySize)
    // 0/0 width/height encodes 256 px per the ICO spec.
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
    entry.writeUInt8(0, 2) // palette colors (0 = none)
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8) // image data size
    entry.writeUInt32LE(offset, 12) // image data offset
    offset += png.length
  }

  return Buffer.concat([header, dir, ...pngs])
}

// Run directly: bun run agent/generateWinIcon.ts
if (import.meta.main) {
  const iconDir = join(dirname(import.meta.path), 'resources', 'icon')
  const src = join(iconDir, 'axiomate.png')
  const dest = join(iconDir, 'axiomate.ico')
  const buf = await generateIco(src)
  writeFileSync(dest, buf)
  console.log(`Wrote ${dest} (${(buf.length / 1024).toFixed(1)} KB)`)
}


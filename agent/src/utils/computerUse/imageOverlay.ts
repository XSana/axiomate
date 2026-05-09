import { getImageProcessor } from 'image-processor-axiomate'
import { computeRulerIntervals } from 'computer-use-mcp-axiomate'

type GridMode = 'none' | 'edge' | 'full'

export type OverlayMark = {
  id: number
  x: number
  y: number
}

export type OverlayRange = {
  originX: number
  originY: number
  rangeW: number
  rangeH: number
}

type OverlayOptions = {
  base64: string
  imageWidth: number
  imageHeight: number
  gridMode?: GridMode
  range?: OverlayRange
  marks?: OverlayMark[]
  jpegQuality?: number
}

const RULER_BAND = 28
const GRID_COLOR = 'rgba(255,255,255,0.22)'
const TICK_COLOR = 'rgba(255,255,255,0.9)'
const TEXT_COLOR = '#ffffff'
const TEXT_FONT = '12px Menlo, Monaco, Consolas, monospace'
const MARK_FILL = 'rgba(220, 38, 38, 0.82)'
const MARK_STROKE = '#ffffff'
const MARK_RADIUS = 12

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function buildGridSvg(opts: {
  width: number
  height: number
  range: OverlayRange
  mode: Exclude<GridMode, 'none'>
}): string {
  const { width, height, range, mode } = opts
  const { tick: tickX, label: labelX } = computeRulerIntervals(range.rangeW, width)
  const { tick: tickY, label: labelY } = computeRulerIntervals(range.rangeH, height)

  const parts: string[] = []

  // Backing bands so white labels stay legible on busy screenshots.
  parts.push(`<rect x="0" y="0" width="${width}" height="${RULER_BAND}" fill="rgba(0,0,0,0.42)"/>`)
  parts.push(`<rect x="0" y="${height - RULER_BAND}" width="${width}" height="${RULER_BAND}" fill="rgba(0,0,0,0.42)"/>`)
  parts.push(`<rect x="0" y="0" width="${RULER_BAND}" height="${height}" fill="rgba(0,0,0,0.42)"/>`)
  parts.push(`<rect x="${width - RULER_BAND}" y="0" width="${RULER_BAND}" height="${height}" fill="rgba(0,0,0,0.42)"/>`)

  const pushVertical = (coord: number, labelStep: boolean) => {
    const px = clamp(Math.round(((coord - range.originX) / range.rangeW) * width), 0, width)
    if (mode === 'full') {
      parts.push(`<line x1="${px}" y1="0" x2="${px}" y2="${height}" stroke="${GRID_COLOR}" stroke-width="1"/>`)
    }
    parts.push(`<line x1="${px}" y1="0" x2="${px}" y2="${RULER_BAND}" stroke="${TICK_COLOR}" stroke-width="1"/>`)
    parts.push(`<line x1="${px}" y1="${height - RULER_BAND}" x2="${px}" y2="${height}" stroke="${TICK_COLOR}" stroke-width="1"/>`)
    if (labelStep) {
      const label = escapeXml(String(Math.round(coord)))
      parts.push(`<text x="${px + 2}" y="12" fill="${TEXT_COLOR}" font-family="Menlo, Monaco, Consolas, monospace" font-size="12">${label}</text>`)
      parts.push(`<text x="${px + 2}" y="${height - 6}" fill="${TEXT_COLOR}" font-family="Menlo, Monaco, Consolas, monospace" font-size="12">${label}</text>`)
    }
  }

  const pushHorizontal = (coord: number, labelStep: boolean) => {
    const py = clamp(Math.round(((coord - range.originY) / range.rangeH) * height), 0, height)
    if (mode === 'full') {
      parts.push(`<line x1="0" y1="${py}" x2="${width}" y2="${py}" stroke="${GRID_COLOR}" stroke-width="1"/>`)
    }
    parts.push(`<line x1="0" y1="${py}" x2="${RULER_BAND}" y2="${py}" stroke="${TICK_COLOR}" stroke-width="1"/>`)
    parts.push(`<line x1="${width - RULER_BAND}" y1="${py}" x2="${width}" y2="${py}" stroke="${TICK_COLOR}" stroke-width="1"/>`)
    if (labelStep) {
      const label = escapeXml(String(Math.round(coord)))
      parts.push(`<text x="3" y="${py - 3}" fill="${TEXT_COLOR}" font-family="Menlo, Monaco, Consolas, monospace" font-size="12">${label}</text>`)
      parts.push(`<text x="${width - RULER_BAND + 3}" y="${py - 3}" fill="${TEXT_COLOR}" font-family="Menlo, Monaco, Consolas, monospace" font-size="12">${label}</text>`)
    }
  }

  const xStart = Math.ceil(range.originX / tickX) * tickX
  for (let x = xStart; x <= range.originX + range.rangeW; x += tickX) {
    const isLabel = Math.abs((x / labelX) - Math.round(x / labelX)) < 1e-6
    pushVertical(x, isLabel)
  }

  const yStart = Math.ceil(range.originY / tickY) * tickY
  for (let y = yStart; y <= range.originY + range.rangeH; y += tickY) {
    const isLabel = Math.abs((y / labelY) - Math.round(y / labelY)) < 1e-6
    pushHorizontal(y, isLabel)
  }

  return parts.join('')
}

function buildMarksSvg(width: number, height: number, marks: OverlayMark[]): string {
  const parts: string[] = []
  for (const mark of marks) {
    const x = clamp(Math.round(mark.x), 0, width)
    const y = clamp(Math.round(mark.y), 0, height)
    const label = escapeXml(String(mark.id))
    parts.push(`<circle cx="${x}" cy="${y}" r="${MARK_RADIUS}" fill="${MARK_FILL}" stroke="${MARK_STROKE}" stroke-width="2"/>`)
    parts.push(
      `<text x="${x}" y="${y + 4}" text-anchor="middle" fill="${TEXT_COLOR}" font-family="Menlo, Monaco, Consolas, monospace" font-size="12" font-weight="700">${label}</text>`,
    )
  }
  return parts.join('')
}

export async function overlayScreenshotArtifacts(
  opts: OverlayOptions,
): Promise<string> {
  const { base64, imageWidth, imageHeight, gridMode = 'none', range, marks = [], jpegQuality = 92 } = opts
  if (gridMode === 'none' && marks.length === 0) return base64

  const svgParts: string[] = []
  if (gridMode !== 'none' && range && range.rangeW > 0 && range.rangeH > 0) {
    svgParts.push(buildGridSvg({ width: imageWidth, height: imageHeight, range, mode: gridMode }))
  }
  if (marks.length > 0) {
    svgParts.push(buildMarksSvg(imageWidth, imageHeight, marks))
  }
  if (svgParts.length === 0) return base64

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" viewBox="0 0 ${imageWidth} ${imageHeight}">`,
    svgParts.join(''),
    `</svg>`,
  ].join('')

  const sharp = await getImageProcessor()
  const input = Buffer.from(base64, 'base64')
  const out = await sharp(input)
    .composite([{ input: Buffer.from(svg) } as never])
    .jpeg({ quality: jpegQuality })
    .toBuffer()
  return out.toString('base64')
}

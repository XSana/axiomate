/**
 * Phase 1.5 UIA/AX enumeration pipeline — end-to-end Win test.
 *
 * Drives the real TS pipeline (buildWindowBaseline → selectCandidates →
 * bulkEnumerate → filterAndScoreToMarks) via the live winExecutor, then
 * dumps annotated debug images covering:
 *
 *   1. full-screen `screenshot` SoM pass
 *   2. centered `zoom` SoM pass
 *   3. per-app `screenshot_window` SoM pass (foreground app)
 *
 * No model / agent / MCP server involved — purely the executor + pipeline
 * stack. Output files in C:/tmp/test_pipeline_*.jpg with red-circle marks
 * + numbered IDs overlaid. Console summary lists element names per call.
 *
 * Post-virtual-coord-removal: bboxes, candidates, cursor, region, marks
 * are all in display-coord-pt end-to-end. The JPEG is still downscaled to
 * ≤1920 long-edge for VL budget; the native ruler/marks renderer projects
 * coords via the gridOrigin/gridRange params.
 *
 * Prereq: build the workspace first so dist artifacts exist.
 *   pnpm --filter computer-use-mcp-axiomate run build
 *
 * Usage: bun run agent/src/__tests__/test-pipeline.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import * as winNapi from 'computer-use-win-napi-axiomate'

import {
  buildWindowBaseline,
  bulkEnumerate,
  DEFAULT_PIPELINE_CONFIG,
  filterAndScoreToMarks,
  refreshVisibleRectsAfterRestore,
  selectCandidates,
} from 'computer-use-mcp-axiomate'
import type { CandidateWindow, ComputerExecutor } from 'computer-use-mcp-axiomate'

import { createWinExecutor } from '../utils/computerUse/winExecutor.js'

const LONG_EDGE_CAP = 1920
function computeImageDim(w: number, h: number): [number, number] {
  const longEdge = Math.max(w, h)
  if (longEdge <= LONG_EDGE_CAP) return [w, h]
  const ratio = LONG_EDGE_CAP / longEdge
  return [Math.round(w * ratio), Math.round(h * ratio)]
}

function pickBestRectOverlap<T extends { rect: { x: number; y: number; w: number; h: number } }>(
  entries: T[],
  target: { x: number; y: number; w: number; h: number },
): T | null {
  if (entries.length === 0) return null
  let best: T | null = null
  let bestArea = -1
  for (const e of entries) {
    const ix = Math.max(0, Math.min(e.rect.x + e.rect.w, target.x + target.w) - Math.max(e.rect.x, target.x))
    const iy = Math.max(0, Math.min(e.rect.y + e.rect.h, target.y + target.h) - Math.max(e.rect.y, target.y))
    const area = ix * iy
    if (area > bestArea) {
      bestArea = area
      best = e
    }
  }
  return bestArea > 0 ? best : entries[0]!
}

const consoleLogger = {
  debug: (msg: string) => console.log(`  [debug] ${msg}`),
  warn: (msg: string) => console.warn(`  [warn] ${msg}`),
  error: (msg: string) => console.error(`  [error] ${msg}`),
}

const outDir = 'C:/tmp'
fs.mkdirSync(outDir, { recursive: true })

if (!winNapi.isAvailable()) {
  console.error('Win NAPI not available:', winNapi.getLoadError?.())
  process.exit(1)
}

// ── Build executor + display geometry ─────────────────────────────────────
const executor: ComputerExecutor = createWinExecutor()
const displays = await executor.listDisplays()
const display =
  displays.find((d) => d.isPrimary || d.isMain) ?? displays[0]
if (!display) throw new Error('No displays found')
console.log(`Display: ${display.width}×${display.height} at (${display.originX ?? 0}, ${display.originY ?? 0}), id=${display.displayId}`)

const originX = display.originX ?? 0
const originY = display.originY ?? 0
const [jpegW, jpegH] = computeImageDim(display.width, display.height)

console.log(`JPEG canvas: ${jpegW}×${jpegH} (display dims preserved for coords)`)

// ── Test 1: Full-screen pipeline ─────────────────────────────────────────
console.log('\n--- Test 1: full-screen pipeline ---')
{
  const t0 = Date.now()
  const targetPhysicalRect = { x: originX, y: originY, w: display.width, h: display.height }
  const baseline = await buildWindowBaseline(executor)
  console.log(`  baseline windows: ${baseline.win.length}`)

  const cursor = await executor.getCursorPosition()
  const candidates = selectCandidates(baseline, targetPhysicalRect, DEFAULT_PIPELINE_CONFIG, cursor)
  console.log(`  candidates: ${candidates.length}`)
  for (const c of candidates) {
    console.log(`    - ${c.displayName}${c.isForeground ? ' [fg]' : ''}${c.isSystemChrome ? ' [chrome]' : ''} z=${c.zRank} rect=${c.rect.w}x${c.rect.h}@(${c.rect.x},${c.rect.y})`)
  }

  const touched = new Set<string>()
  const bulk = await bulkEnumerate(executor, candidates, DEFAULT_PIPELINE_CONFIG, touched, consoleLogger)
  console.log(`  bulk elements: ${bulk.elements.length}, viewports: ${bulk.browserViewports.length}, touched apps: ${touched.size}`)
  for (const t of bulk.candidateTimings) {
    console.log(`    - ${t.displayName}: ${t.count} elems, ${t.elapsedMs}ms${t.truncated ? ' [TRUNC]' : ''}`)
  }

  // bboxes / candidates / cursor / viewports all stay in display-coord-pt.
  const refreshedCandidates = await refreshVisibleRectsAfterRestore(executor, candidates)
  const result = filterAndScoreToMarks(
    bulk.elements,
    refreshedCandidates,
    targetPhysicalRect,
    cursor,
    bulk.browserViewports,
  )
  console.log(`  marks after filter+score: ${result.marks.length}`)
  console.log(`  viewports: ${result.browserViewports.length}`)
  for (const m of result.marks.slice(0, 10)) {
    console.log(`    #${m.id} ${m.role}@(${m.x},${m.y}) name="${m.name.slice(0, 60)}"`)
  }

  // Marks already in display-coord-pt — pass straight through; native
  // draw_marks_on_rgb projects via (gridOrigin, gridRange) = display rect.
  const overlayMarks = result.marks.slice(0, 50).map((m) => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y) }))
  const shot = await (winNapi as any).captureDisplayScaled(
    { origin: { x: originX, y: originY }, size: { w: display.width, h: display.height } },
    jpegW, jpegH, 90, 2,
    originX, originY, display.width, display.height,
    overlayMarks,
  )
  if (shot) {
    const p = path.join(outDir, 'test_pipeline_screenshot.jpg')
    fs.writeFileSync(p, Buffer.from(shot.base64, 'base64'))
    console.log(`  saved: ${p} (${fs.statSync(p).size} bytes, ${Date.now() - t0}ms total)`)
  }
}

// ── Test 2: Zoom pipeline ────────────────────────────────────────────────
console.log('\n--- Test 2: zoom pipeline ---')
{
  const t0 = Date.now()
  const zw = Math.min(600, display.width)
  const zh = Math.min(600, display.height)
  const zx = Math.round(originX + display.width / 2 - zw / 2)
  const zy = Math.round(originY + display.height / 2 - zh / 2)
  const regionDisplay = { x: zx, y: zy, w: zw, h: zh }
  console.log(`  zoom region (display-coord-pt): ${zw}x${zh}@(${zx},${zy})`)

  const baseline = await buildWindowBaseline(executor)
  const cursor = await executor.getCursorPosition()
  const candidates = selectCandidates(baseline, regionDisplay, DEFAULT_PIPELINE_CONFIG, cursor)
  console.log(`  candidates: ${candidates.length}`)

  const touched = new Set<string>()
  const bulk = await bulkEnumerate(executor, candidates, DEFAULT_PIPELINE_CONFIG, touched, consoleLogger)
  console.log(`  bulk elements: ${bulk.elements.length}`)

  const result = filterAndScoreToMarks(
    bulk.elements,
    candidates,
    regionDisplay,
    cursor,
    bulk.browserViewports,
  )
  const inRegion = result.marks
    .filter((m) => m.x >= zx && m.x < zx + zw && m.y >= zy && m.y < zy + zh)
    .map((m, i) => ({ ...m, id: i + 1 }))
  console.log(`  marks in zoom region: ${inRegion.length}`)
  for (const m of inRegion.slice(0, 10)) {
    console.log(`    #${m.id} ${m.role}@(${m.x},${m.y}) name="${m.name.slice(0, 60)}"`)
  }

  const overlayMarks = inRegion.slice(0, 30).map((m) => ({
    id: m.id,
    x: Math.round(m.x),
    y: Math.round(m.y),
  }))
  const shot = await (winNapi as any).captureDisplayScaled(
    { origin: { x: regionDisplay.x, y: regionDisplay.y }, size: { w: regionDisplay.w, h: regionDisplay.h } },
    regionDisplay.w, regionDisplay.h, 90, 2,
    zx, zy, zw, zh,
    overlayMarks,
  )
  if (shot) {
    const p = path.join(outDir, 'test_pipeline_zoom.jpg')
    fs.writeFileSync(p, Buffer.from(shot.base64, 'base64'))
    console.log(`  saved: ${p} (${fs.statSync(p).size} bytes, ${Date.now() - t0}ms total)`)
  }
}

// ── Test 3: screenshot_window pipeline ───────────────────────────────────
console.log('\n--- Test 3: screenshot_window pipeline ---')
{
  const t0 = Date.now()
  const frontmost = await executor.getFrontmostApp()
  if (!frontmost) {
    console.log('  no frontmost app, skipping')
  } else {
    console.log(`  target: ${frontmost.displayName} (${frontmost.appIdentifier})`)
    const prelim = await executor.screenshotWindow(frontmost.appIdentifier, 2)
    if (!prelim) {
      console.log('  screenshotWindow returned null, skipping')
    } else {
      console.log(`  prelim: ${prelim.width}x${prelim.height} display=${prelim.displayWidth}x${prelim.displayHeight} origin=(${prelim.originX},${prelim.originY})`)
      const oX = prelim.originX ?? 0
      const oY = prelim.originY ?? 0
      const targetPhysicalRect = {
        x: oX,
        y: oY,
        w: prelim.displayWidth ?? prelim.width,
        h: prelim.displayHeight ?? prelim.height,
      }
      const baseline = await executor.listVisibleWindows?.() ?? []
      const matches = baseline.filter((w) => w.appIdentifier === frontmost.appIdentifier)
      const best = pickBestRectOverlap(matches, targetPhysicalRect)
      if (!best) {
        console.log('  no matching window in baseline, skipping')
      } else {
        const candidate: CandidateWindow = {
          windowHandle: best.hwnd ?? 0,
          appIdentifier: best.appIdentifier,
          displayName: best.displayName,
          zRank: best.zRank,
          isForeground: best.isForeground,
          isSystemChrome: false,
          rect: best.rect,
          visibleRects: [best.rect],
        }
        const touched = new Set<string>()
        const bulk = await bulkEnumerate(executor, [candidate], DEFAULT_PIPELINE_CONFIG, touched, consoleLogger)
        console.log(`  bulk elements: ${bulk.elements.length}`)

        const finalCandidates: CandidateWindow[] = [{
          ...candidate,
          isForeground: true,
        }]
        const result = filterAndScoreToMarks(bulk.elements, finalCandidates, targetPhysicalRect, null, bulk.browserViewports)
        console.log(`  marks: ${result.marks.length}`)
        for (const m of result.marks.slice(0, 10)) {
          console.log(`    #${m.id} ${m.role}@(${m.x},${m.y}) name="${m.name.slice(0, 60)}"`)
        }
        const overlayMarks = result.marks.slice(0, 30).map((m) => ({
          id: m.id,
          x: Math.round(m.x),
          y: Math.round(m.y),
        }))
        const shot2 = await executor.screenshotWindow(frontmost.appIdentifier, 2, overlayMarks)
        if (shot2) {
          const p = path.join(outDir, 'test_pipeline_window.jpg')
          fs.writeFileSync(p, Buffer.from(shot2.base64, 'base64'))
          console.log(`  saved: ${p} (${fs.statSync(p).size} bytes, ${Date.now() - t0}ms total)`)
        }
      }
    }
  }
}

console.log('\nDone. Check C:/tmp/test_pipeline_*.jpg for outputs.')
process.exit(0)

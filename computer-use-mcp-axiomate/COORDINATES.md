# Computer-use coordinate spaces

There are now **two** coordinate spaces. The AI works in one of them
end-to-end; the other only exists inside the JPEG bytes.

## Spaces

```
                  display-coord-pt                       image-px
┌─────────────┐    ┌──────────────────┐               ┌──────────────┐
│ AI's eyes:  │ ── │ display.width    │               │ JPEG bytes   │
│ rulers,     │ ── │ × display.height │               │ ≤ 1920 long  │
│ marks,      │ ── │ + display.origin │               │ edge only    │
│ clicks,     │    └──────────────────┘               └──────────────┘
│ cursor,     │           ↑                                 ↑
│ zoom region │           │ same space as the cursor /     │ exists only
└─────────────┘           │ SendInput / SetCursorPos       │ inside the
                          │ (Win: physical virtual-screen  │ JPEG; AI
                          │  px under Per-Monitor V2 DPI;  │ never reads
                          │  Mac: logical pt)              │ from it
```

| Space | What it is | Example values (4K @ 200% on Win) |
|-------|-----------|-----------------------------------|
| **display-coord-pt** | Platform's native cursor coord space. **Win**: physical virtual-screen px (Per-Monitor V2 DPI-aware — `GetCursorPos`/`SendInput` operate in physical px). **Mac**: logical pt (what apps draw in). The AI sees this on rulers, emits it on clicks. | win: (0,0)–(3840,2160) (or (1920,0)–(3840,2160) on the secondary display); mac: (0,0)–(1920,1080) |
| **image-px** | Pixel coords inside the JPEG sent to the model. Internal only — never exposed in tool args/returns. | (0, 0) – (≤1920, ≤1920) |

The JPEG is downscaled to ≤1920 long-edge for the VL API's token budget,
but ruler labels, SoM marks, cursor_position, and click args all speak
display-coord-pt. The native renderer (`draw_grid_on_rgb` /
`draw_marks_on_rgb` on Win, `buildGridSvg` / `buildMarksSvg` on Mac) is
fed the display's `(originX, originY, displayW, displayH)` as
`coord_origin / coord_range` so labels show real screen coords on the
downscaled image.

**`scaleCoord` collapses to identity in `pixels` mode**: the AI emits
display-coord-pt directly, and `SetCursorPos` / `moveMouse` take
display-coord-pt directly. No `× scaleFactor`, no `× ratioX/Y`, no
`+ originX` anywhere on the input boundary — coords pass through unchanged.

## Conversion ownership

| Conversion | Owner | When |
|------------|-------|------|
| screen physical-px → image-px (inside JPEG) | win NAPI `capture_display_scaled` (BitBlt + Lanczos resize) | every win screenshot, internal |
| screen physical-px → image-px (inside JPEG) | mac swift NAPI `captureExcluding` (CGImage + targetImageSize) | every mac screenshot, internal |
| display-coord-pt → image-px (for ruler tick labels) | native `draw_grid_on_rgb` / `buildGridSvg` via `(coord_origin, coord_range) = (display.originX/Y, display.W/H)` | every screenshot with rulers |
| display-coord-pt → image-px (for SoM mark circles) | same as rulers — same `coord_origin/range` | every screenshot with marks |
| display-coord-pt → cursor | win NAPI `move_cursor` (SendInput, takes physical px) | every win click |
| display-coord-pt → cursor | mac swift NAPI `moveMouse` / `mouseButton` (takes logical pt) | every mac click |

**The AI-facing path is identity end-to-end.** The only conversions
happen (a) inside JPEG encode, (b) when projecting label/mark coords
onto the downscaled image for rendering, and (c) for `normalized_0_100`
mode (`x = (raw/100) * display.width + display.originX`).

## Coordinate modes

`CoordinateMode` (in `types.ts`) tells `scaleCoord` how the AI is
emitting coords:

- **`pixels`** (default, both platforms) — display-coord-pt. Identity.
- **`normalized_0_100`** — percentage. `scaleCoord` multiplies by
  `display.width / 100` and adds `display.originX`.

## Win DPI history

Before Phase 1 the Bun process was DPI-unaware, so
`SetCursorPos`/`GetCursorPos` returned logical pt. The old
COORDINATES.md documented "logical pt end-to-end" based on empirical
evidence from that era. Phase 1 flipped the process to Per-Monitor V2
DPI-aware via `SetProcessDpiAwarenessContext` in `ensure_dpi_aware()`
(`lib.rs`), which shifts all Win32 coord APIs to physical px.

## Why this matters

Past bugs we fixed by being precise about which conversion happens where:

- `screenshotToLogical` divided by `scaleFactor` a SECOND time after
  `scaleCoord` already converted (commit 24b3112). Killed by deletion.
- nut.js silently no-op'd in Bun-compiled exes despite reporting
  "successful" cursor positions; mac path used its own swift NAPI, win
  was the only platform hitting nut.js (commit 5860ce7). Killed by
  replacing with direct Win32 `SendInput`/`SetCursorPos`.
- Image dim was forced to equal display logical dim as a hack to make
  `scaleCoord` identity, which broke for non-16:9 / non-200%-scaling
  screens (commit 850dc5a era). Killed by proper `pixels` mode with
  `display_W / image_W` scaling.
- Initial Win32 input wrapper assumed `SetCursorPos` takes physical px
  when the process was DPI-unaware, and `× scaleFactor`-multiplied the
  logical coords. This doubled all coords — killed by removing
  `logicalToPhysical` helper. Phase 1 then flipped to Per-Monitor V2
  DPI-aware and made `DisplayGeometry` carry physical px, so the
  identity path works in physical space.

If you're tempted to add a `* scaleFactor` or `/ scaleFactor` somewhere
on the AI-facing path, ask: do I really need to leave display-coord-pt?
The AI never speaks image-px; only the JPEG bytes do. Projection from
display-coord-pt to image-px lives inside the renderer (ruler labels,
mark circles, cursor ring), nowhere else.

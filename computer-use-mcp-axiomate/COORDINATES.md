# Computer-use coordinate spaces

Three coordinate spaces matter for click correctness. Every conversion
between them has a single, named owner. Touching the math? Check this
file first; the comments in the code reference these names.

## Spaces

```
                    image-px space         display logical pt        physical px
┌─────────────┐    ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│ AI's eyes   │ →  │ image dim    │    │ display.width    │    │ raw screen   │
│             │    │ ≤ 1920 long  │    │ × display.height │    │ pixels       │
└─────────────┘    └──────────────┘    └──────────────────┘    └──────────────┘
```

| Space | What it is | Example values (4K @ 200%) |
|-------|-----------|----------------------------|
| **image-px** | Pixel coords inside the JPEG sent to the model | (0, 0) – (1920, 1080) |
| **display logical pt** | OS coord space — what the user's apps draw in, what mac swift NAPI input takes, AND what Win32 SetCursorPos / GetCursorPos accept in DPI-aware processes | (0, 0) – (1920, 1080) |
| **physical px** | Raw GPU framebuffer pixels — what BitBlt copies | (0, 0) – (3840, 2160) |

For the user's specific case (4K monitor at 200% Windows scaling), image-px and display-logical-pt happen to coincide. For 4K @ 100% they're different: image-px is 1920×1080 (capped), display-logical-pt is 3840×2160. The math must work in both cases.

**Important Win32 finding** (counter to a common assumption): `SetCursorPos` and `GetCursorPos` in a Per-Monitor V2 DPI-aware Bun-compiled process accept and return **logical pt**, NOT physical pixels. Empirical evidence: sending `(980, 2110)` results in cursor at `(980, 1080)` — y is clamped to 1080 (logical y-max), not 2160 (physical y-max). If the API took physical, 2110 < 2160 would not have been clamped. We previously assumed physical and were `× scaleFactor`-multiplying, which doubled all coords and made every non-taskbar click land in the wrong screen quadrant.

## Conversion ownership

| Conversion | Owner | When |
|------------|-------|------|
| screen physical-px → image-px | win NAPI `capture_display_scaled` (BitBlt + Lanczos resize) | every win screenshot |
| screen physical-px → image-px | mac swift NAPI `captureExcluding` (CGImage + targetImageSize) | every mac screenshot |
| image-px → display-pt | **scaleCoord** (mode = `pixels`) — `rawX * (display_W / image_W) + originX` | every click in `pixels` mode |
| (no conversion) | **scaleCoord** (mode = `display_pt`) — `rawX + originX`, AI gives display-pt directly | every click in `display_pt` mode |
| display-pt → cursor | win NAPI `move_cursor` (SetCursorPos, takes logical pt) | every win click |
| display-pt → cursor | mac swift NAPI `moveMouse` / `mouseButton` | every mac click |

**Win path is identity end-to-end after scaleCoord**: no `× scaleFactor` / `÷ scaleFactor` anywhere. Coords stay in display-pt space from scaleCoord output through Win32 SetCursorPos.

## Coordinate modes

`CoordinateMode` (in `types.ts`) tells `scaleCoord` what convention the AI is using:

- **`pixels`** (mac default) — AI emits in image-px space. scaleCoord multiplies by `display_W / image_W` to reach display-pt. This is the Anthropic computer-use beta convention.
- **`display_pt`** (win default) — AI emits in display logical-pt space directly. scaleCoord is identity (modulo origin offset). This matches Qwen-VL and other non-Anthropic VLMs that ignore "image-pixel" tool descriptions and emit screen-coordinates regardless of image size.
- **`normalized_0_100`** — AI emits a percentage. scaleCoord multiplies by `display_W / 100`.

In `display_pt` mode the screenshot tool emits a text caption with the screen's actual pixel resolution alongside the image, so the model knows what space to give coords in even when the image is downscaled.

## Why this matters

Past bugs we fixed by being precise about which conversion happens where:

- `screenshotToLogical` divided by scaleFactor a SECOND time after `scaleCoord` already converted (commit 24b3112). Killed by deletion.
- nut.js silently no-op'd in Bun-compiled exes despite reporting "successful" cursor positions; mac path used its own swift NAPI, win was the only platform hitting nut.js (commit 5860ce7). Killed by replacing with direct Win32 SendInput / SetCursorPos.
- Image dim was forced to equal display logical dim as a hack to make scaleCoord identity, which broke for non-16:9 / non-200%-scaling screens (commit 850dc5a era). Killed by introducing `display_pt` mode.
- Initial Win32 input wrapper assumed `SetCursorPos` takes physical px in DPI-aware processes and `× scaleFactor`-multiplied the logical coords. Y clamping at 1080 (logical y-max) on out-of-bounds coords proved otherwise. Bug masquerade: taskbar clicks "happened to work" because doubled-y was clamped back to taskbar y, but every non-taskbar click landed in the wrong screen quadrant. Killed in winExecutor by removing `logicalToPhysical` helper entirely.

If you're tempted to add a `* scaleFactor` or `/ scaleFactor` somewhere, ask: which space are the inputs in, which space should the outputs be in, and is the conversion already done by one of the owners above? Prefer extending an existing owner over inserting a new one. **Win path should be identity end-to-end** — there's no DPI math anywhere on the input boundary in winExecutor.

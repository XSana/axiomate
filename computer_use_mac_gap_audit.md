# Computer Use macOS Gap Audit

Date: 2026-05-10

Goal:

- Use current Windows computer-use behavior as the target capability surface.
- Repair macOS computer-use incrementally.
- Keep the shared `computer-use-mcp-axiomate` contract truthful.
- Allow macOS to remain a secondary platform where necessary, but avoid silent over-promising.

## Scope

This audit compares the current macOS path against the current Windows path for:

- screenshots
- zoom
- screenshot_window
- screen_locate
- SoM / structured element feedback
- input
- app management
- tool descriptions vs. actual platform behavior

This document is not a browser-specific design yet. It is the platform-baseline audit that should happen before browser-specific work.

## High-Level Summary

Windows currently has:

- full screenshot + zoom pipeline
- window capture with rulers / grid / SoM overlays
- UIAutomation-backed element enumeration
- `mark_id` flow from zoom results
- richer structure for screen_locate feedback
- stronger foreground / hide-self coordination

macOS currently has:

- working input primitives
- working open-application path
- working screenshot / window capture basics
- working screen_locate loop as a visual workflow
- but no Windows-equivalent structured element enumeration layer
- and likely no Windows-equivalent rulers / SoM overlays for `zoom` and `screenshot_window`

In short:

- macOS computer-use is not absent
- macOS computer-use is materially behind Windows on structure and feedback
- the biggest gap is not clicking or opening apps; it is the missing AX/UIA-like layer

## Capability Matrix

Legend:

- `Yes`: implemented and roughly aligned with current tool contract
- `Partial`: implemented, but weaker than Windows or missing major subfeatures
- `No`: missing

| Capability | Windows | macOS | Notes |
|---|---|---|---|
| `screenshot` | Yes | Partial | macOS has screenshot capture, but not clearly Win-equivalent rulers/grid behavior today. |
| `zoom` | Yes | Partial | macOS has region capture, but current executor path ignores `coordinateGrid` and doesn't take `marks`. |
| `screenshot_window` | Yes | Partial | macOS can capture a frontmost window by bundle id, but current path does not match Win's grid + SoM overlay surface. |
| `screen_locate` loop | Yes | Yes | Shared MCP state machine exists on both platforms. |
| `accept` snapshot semantics | Yes | Yes | Shared MCP semantics. |
| `enumerateVisibleElements` | Yes | No | Major missing mac capability. |
| `elementFromPoint` | Yes | No | Major missing mac capability. |
| SoM red circles in `zoom` | Yes | No/Partial | Shared logic exists, but mac currently lacks the enumeration source and likely the overlay path. |
| SoM red circles in `screenshot_window` | Yes | No/Partial | Same as above. |
| `mark_id` after zoom | Yes | No/Partial | Shared wire contract exists, but mac lacks the backing source. |
| text listing of detected interactive elements | Yes | No/Partial | Same dependency on structured element enumeration. |
| mouse input | Yes | Yes | Different backend, but present. |
| keyboard input | Yes | Yes | Different backend, but present. |
| drag / scroll | Yes | Yes | Present. |
| `open_application` | Yes | Yes | Different identifier model: exe/AUMID on Win, bundle id / name on macOS. |
| `list_running_apps` | Yes | Yes | Present on both. |
| `findWindowDisplays` | Yes | Yes | Present on both. |
| app hit-test under point | Yes | Yes | Present on both, though mac fallback can degrade when native binding is unavailable. |
| hide-self before screenshot/zoom | Yes | Partial | Windows has explicit host-window move-off-screen path. macOS has app hide/unhide / allowlist flow, but semantics differ. |

## Current macOS Strengths

These are not the immediate problem:

### Input

macOS already has:

- `moveMouse`
- `click`
- `mouseDown`
- `mouseUp`
- `drag`
- `scroll`
- `key`
- `holdKey`
- `type`

This means "can the model physically interact with the screen?" is not the main mac gap.

### App management

macOS already has:

- `open_application`
- `list_running_apps`
- `list_installed_apps`
- frontmost app lookup
- window-display mapping

This means "can the model bring an app up and act on it?" is also not the core mac gap.

### Shared loop semantics

The `screen_locate` loop itself is shared in the MCP layer, so:

- enter-loop
- feedback injection
- accept-outside-loop failure
- `accept` as cursor snapshot

already exist on macOS too.

## Current macOS Weaknesses

### 1. No AX-backed structured element enumeration

This is the largest platform gap.

Windows has an executor capability:

- `enumerateVisibleElements(rect, windowOnly?)`
- `elementFromPoint(x, y)`

These power:

- SoM red circles
- text element listings
- `mark_id`
- stronger structured guidance during `zoom`
- stronger structured guidance during `screenshot_window`

macOS currently has no equivalent executor implementation.

Impact:

- `screen_locate` on macOS is mostly visual-only
- `zoom` on macOS cannot match Windows' structured feedback
- `screenshot_window` on macOS cannot match Windows' structured feedback

### 2. Likely missing rulers/grid parity

The mac executor `zoom(...)` signature takes `_coordinateGrid`, but the value is not used in the current path.

Impact:

- even before SoM, mac may not match Win's ruler/grid affordances
- this weakens the visual loop for precise coordinate refinement

### 3. Likely missing marks overlay parity

The mac executor `zoom(...)` path does not currently accept `marks`, while Win does.

Impact:

- even if mac gained AX enumeration, it still needs a rendering path for red circles and label numbers

### 4. `screenshot_window` feature surface is behind Windows

Windows supports:

- window-only capture
- optional coordinate grid
- optional SoM overlays

macOS currently appears to have only:

- basic per-window capture
- no equivalent `gridMode` / `marks` path surfaced through the executor

### 5. Shared tool descriptions likely over-promise on macOS

Some shared tool descriptions currently read like the richer Windows path is present on all platforms.

Highest-risk descriptions:

- `zoom`
- `screenshot_window`
- any wording that implies red SoM circles and interactive-element listings always exist
- `mouse_move(mark_id: N)` semantics if macOS cannot actually generate marks

## Shared-Layer Cleanup Needed

### Remove fake / dead detection sources

Current detection source list includes:

- `uia`
- `yolo`
- `grounder`
- `ocr`

But today only `uia` is actually wired.

At minimum:

- remove `yolo` now

Reason:

- fake sources make the architecture look more complete than it is
- they increase confusion during platform repair
- they blur what is actually available on macOS

Potentially later:

- reconsider whether `grounder` and `ocr` should remain in the public type surface before they are real

## Truthfulness Problems To Fix Early

Before deep platform work, fix the contract so macOS is not silently over-promised.

### Priority truthfulness issues

1. Shared tool descriptions should not imply SoM always exists on macOS if it does not.
2. Shared descriptions should not imply `mark_id` is equally available on both platforms if mac cannot produce marks.
3. Shared descriptions should not imply window screenshot overlays are symmetric if they are not.

This does not mean hiding future intent. It means being precise about current platform behavior.

## Phase Plan

## Phase 0: Audit and contract cleanup

Deliverables:

- this audit document
- remove `yolo` from detection source type surface
- identify and fix shared over-promising descriptions

Success criteria:

- shared code only advertises real current capabilities
- no fake source remains in the immediate design surface

## Phase 1: macOS baseline parity for visual precision

Target:

- match Windows' practical precision loop as closely as possible before AX

Tasks:

- verify whether mac screenshot path already supports rulers/grid
- if not, add ruler/grid support to mac screenshot and zoom outputs
- verify whether mac window capture supports ruler overlay
- if not, add it

Why this phase exists:

- even without AX, mac visual loop becomes much more usable
- makes screen_locate less painful before structured feedback lands

Success criteria:

- mac `screenshot`
- mac `zoom`
- mac `screenshot_window`

all expose comparable coordinate affordances to Windows

## Phase 2: macOS AX foundation

Target:

- add the missing structured element layer on macOS

Tasks:

- add mac native export for `enumerateVisibleElements`
- add mac native export for `elementFromPoint`
- implement AX tree walk / filtering / bbox extraction
- map AX roles into the shared short role vocabulary

Non-goals for first pass:

- perfect browser-page coverage
- exact role parity with Windows
- advanced overlay/state semantics

Success criteria:

- mac can return visible interactive elements in a screen or window region
- mac can hit-test an element under a point

### Phase 2 implementation notes

Recommended technical path:

- implement this in `computer-use-mac-napi-axiomate`
- use macOS Accessibility APIs (`AXUIElement*`) rather than trying to fake
  structure from screenshots
- keep the shared MCP contract unchanged; only fill the missing executor hooks

Practical first-pass approach:

1. Start with top-level app AX roots for the frontmost app or target window app.
2. Recursively walk children with a depth cap.
3. Read a minimal attribute set:
   - role
   - title / description / value (best-effort name)
   - position
   - size
4. Convert those to the shared executor element shape:
   - `bbox`
   - `name`
   - `role`
5. Filter out obvious non-interactive/container-only nodes in the first pass.

Important:

- do not try to match every Windows UIA heuristic in v1
- do not block on browser-perfect behavior
- do make the data shape good enough that existing `detectElementsInRect`
  and `mark_id` logic can run unchanged

## Phase 3: SoM integration on macOS

Target:

- connect mac AX results to the existing shared SoM pipeline

Tasks:

- wire mac executor into `detectElementsInRect`
- enable marks for mac `zoom`
- enable text element listings for mac `zoom`
- enable marks for mac `screenshot_window`
- restore `mark_id` usefulness on mac

Success criteria:

- `zoom` on mac can generate red numbered circles and textual listings
- `mouse_move(mark_id: N)` works after a successful mac zoom

## Phase 4: screen_locate parity pass

Target:

- make mac `screen_locate` feel operationally close to Win

Tasks:

- review loop feedback on mac after AX/SoM lands
- verify the default "zoom first" strategy remains correct on mac
- verify `accept` flow plus mark-based cursor positioning on mac

Success criteria:

- mac `screen_locate` is no longer "visual only"
- model can use `zoom -> mark_id -> screenshot -> accept` on mac

## Phase 5: browser-specific follow-up

This is intentionally out of scope for the first repair wave.

After mac AX exists, re-evaluate:

- Safari
- Chrome
- Electron
- WebView-backed apps

Questions for that phase:

- Is AX coverage good enough?
- Do browser pages need a dedicated browser-specific source later?

Do not block Phase 2/3 on perfect browser answers.

## Recommended First Code Changes

If starting implementation gradually, the first concrete steps should be:

1. Remove `yolo` from `computer-use-mcp-axiomate/src/detection.ts`
2. Audit shared tool descriptions for mac over-promising
3. Verify current mac screenshot/zoom/window-capture ruler capabilities
4. Define the exact shared data shape mac AX should return
5. Add mac native stubs for `enumerateVisibleElements` and `elementFromPoint`

## Practical Position

The project does not need macOS to become a perfect Windows clone.

It does need:

- truthful shared contracts
- strong enough visual precision tools
- a real structured element source on macOS

That is the minimum bar for saying mac computer-use is repaired rather than merely present.

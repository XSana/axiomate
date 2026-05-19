# Open Issue: Linux Packaged Binary Hangs in --print Mode

**Status:** Open
**Filed:** 2026-05-19
**Priority:** High (blocks Linux release artifact)

## Symptom

`pnpm run package:linux` succeeds and produces a 108 MB ELF Linux x86_64 binary at `agent/dist/axiomate` plus the expected 4 native sidecars (sharp-linux-x64.node + libvips-cpp.so.42 + rg + audio-capture-axiomate.node).

`./axiomate --version` works: prints `0.6.2 (Axiomate)` and exits 0.

`./axiomate --print "..." --model <m> < /dev/null` **hangs forever**, then exits 0 with **zero stdout output**. Multiple background instances accumulate in RAM (~130 MB each) doing futex-only syscalls.

## What works

- Same source, same machine, same `~/.axiomate.json` config: `pnpm run start --print "..." --model deepseek-v4-pro` returns the correct LLM response (`391` for `17 * 23`). This is `bun run dist/cli.js` — the *interpreted* path.
- Windows: `pnpm run package:win` then the produced `axiomate.exe --print` works end-to-end.
- The Linux binary itself launches cleanly — `--version` exits 0 with output, sharp/libvips are NOT loaded yet at that stage, so they're not the blocker.

## Diagnostic signal

`bun build --compile` Step 2 emits `bundle 3 modules` on Linux. The equivalent Windows packaging emits `bundle 386 modules`. So Bun's `--compile` step on Linux is seeing **3** modules where Windows sees the full agent module graph.

This points at a Bun `--compile` bug on Linux, not at our packager script. The bundled `dist/cli.js` itself is 18.7 MB and contains the full agent source — interpreting it via `bun dist/cli.js` works perfectly. Something about how Linux Bun 1.3.14's `--compile` re-bundles that JS into the binary is dropping most of it.

## Strace breadcrumb

An earlier (stale) binary on this machine wrote `C:\Users\kiro\r\n` to stdout then exited. CRLF line endings + Windows path — that binary was produced by Windows Bun running on WSL via PATH passthrough, before the fix in `a7078c52` landed. After rebuilding with the native Linux Bun (`/root/.bun/bin/bun`, version 1.3.14), the binary stops outputting that string but still hangs silently in `--print` mode.

## What's been ruled out

- Not a `process.platform` poisoning issue. `file dist/axiomate` confirms ELF Linux x86_64. The build target was correct.
- Not the `external: [...]` list — Windows packager uses the same list and works.
- Not the `makeComputerUseStubPlugin(true)` — the stub replaces unused entry points; `build.ts` uses the same stub path (gated by `process.platform !== 'darwin' && !== 'win32'`) for the *interpreted* Linux dev build, which works.
- Not sharp/libvips — strace shows neither library is loaded before the hang.
- Not the cwd — running from `/tmp` (empty dir) vs. `/root/axiomate` (full repo tree) doesn't change the outcome.

## Possible Bun bug

Bun 1.3.14 (Linux x64) may have a regression in `--compile` where dynamic-import call sites in the bundled JS aren't traced into the produced executable, leaving an agent main loop that imports its print pipeline lazily and finds nothing.

## Next steps to try

1. **Downgrade Linux Bun to 1.3.13** (same version as Windows packager). If `--compile` works there, we've localized to a Bun-version regression and can pin Bun in `scripts/bootstrap.mjs` for Linux until it's fixed upstream.
2. **Compile with `--bytecode` flag** — Bun's docs hint that `--bytecode` forces a different code path for static analysis. May sidestep the dynamic-import drop.
3. **Mark every dynamic import statically by replacing `await import(x)` with a `static-imports.ts` module** that is itself pulled in unconditionally. Painful but unambiguous.
4. **File an upstream Bun issue** with a minimal reproducer once we've confirmed (1) or (2).

## What's shipped

- `agent/package-linux.ts` lands as a known-incomplete packager. The script itself is correct (matches the mac/win pattern, copies the right natives, sets sharp RPATH via patchelf). The output binary is rejected for distribution until the hang is resolved.
- WSL users can still run axiomate end-to-end via `pnpm run start` (interpreted mode). That's the supported Linux dev path until packaging is fixed.
- `pnpm run package:linux` is wired up in root `package.json` so the work resumes from a clean entry point.

## Why this is in docs/ instead of GitHub Issues

Same reason as `docs/issue-ci-workflow.md` — repo is private, lightweight committed-doc tracking. Move when the repo opens up.

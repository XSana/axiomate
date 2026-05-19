# Open Issue: No CI Workflow

**Status:** Open
**Filed:** 2026-05-19
**Priority:** Medium

## Problem

The repo has no `.github/workflows/` directory. Every regression risk currently relies on the maintainer running `pnpm run test`, `pnpm run test:integration`, and `pnpm run package:win` (or `:mac`) locally before pushing. There is no automated gate against:

- Phantom-dep regressions when a new package.json entry is added (pnpm 11's strict hoist is unforgiving — we already burned a day finding 6 of them during the pnpm 9→11 migration).
- Lockfile drift between `package.json` and `pnpm-lock.yaml`.
- Cross-platform build breakage (a Windows-only edit silently breaking the macOS packager, or vice versa).
- Test-suite rot — the 1105 unit tests and 39 integration tests pass today but nothing prevents a future commit from breaking them.
- pnpm version drift — `packageManager: pnpm@11.1.3` is enforced for corepack users, but a contributor with pnpm 10 still gets through `pnpm install`.

## Why this wasn't done before

The fork-from-claude-code lineage shipped with Anthropic-specific CI infra wired to private services. During the cleanup pass that produced axiomate, that infra was deleted along with the rest of the proprietary plumbing. Rebuilding a clean, provider-neutral CI was deferred.

## What it should cover

Minimum viable:

1. **Lint / typecheck job** — `pnpm run build:types` (the agent's `tsc --noEmit`). Fast, catches the kinds of phantom-dep failures we just fixed.
2. **Unit test job** — `pnpm run test`. ~10s, deterministic.
3. **Build job per platform matrix** — `pnpm -w run bootstrap` on Windows + macOS + Linux. Each pinned to a specific OS image so we know exactly which glibc / Xcode version we support.
4. **Package job** — `pnpm run package:win` on Windows, `pnpm run package:mac` on macOS. Smoke-test the resulting binary with `axiomate --print '...'` against a stub model (no real API).

Future:

- **Integration test job** behind `[run-integration]` PR label, since it costs real LLM tokens.
- **Release workflow** — tag → build all platforms → upload artifacts to GitHub Releases. Already needed for the Linux distribution work we discussed (deb / rpm / tarball + `install.sh`).
- **Linux packager** — first, the script needs to exist (currently only `package-win.ts` and `package-mac.ts`).

## Open questions

- Single workflow vs split (test.yml + build.yml + release.yml)? — split is more standard for monorepos this size.
- Where do API keys for integration tests live? — `secrets.AXIOMATE_TEST_SILICONFLOW_KEY` is the simplest path; matches how the gitignored `local.json` works locally.
- Self-hosted runner for Windows? — GitHub-hosted `windows-latest` runners are fine for our build but slow for Bun compile + Rust NAPI. Worth measuring before deciding.
- pnpm install via Corepack or via `pnpm/action-setup@v4`? — Corepack matches what bootstrap does locally; action-setup is the standard PR-template path. Either works.

## Why this is in docs/ instead of GitHub Issues

The repo is currently private to a small team; lightweight tracking via committed docs is faster to iterate on than the Issues UI. Move this to GitHub Issues when the repo opens up or when CI work actually starts.

## Related

- `scripts/bootstrap.mjs` enforces `pnpm >= 11` and auto-installs via `npm install -g pnpm@11`. CI can call the same script with `--check` mode for a fast environment probe.
- `package.json` has `packageManager: pnpm@11.1.3` — CI should set this up via `corepack enable && corepack prepare pnpm@11.1.3 --activate` for parity.

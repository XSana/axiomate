/**
 * Detects if the current runtime is Bun.
 * Returns true when:
 * - Running a JS file via the `bun` command
 * - Running a Bun-compiled standalone executable
 */
export function isRunningWithBun(): boolean {
  // https://bun.com/guides/util/detect-bun
  return process.versions.bun !== undefined
}

/**
 * Detects if running as a Bun-compiled standalone executable.
 *
 * We probe two signals because Bun 1.3.x on Linux ships `--compile`
 * binaries with an empty `Bun.embeddedFiles` array, while the same
 * macro returns the embedded asset list on Windows/macOS. Falling
 * back to `process.execPath` basename catches the Linux case: the
 * interpreter (`bun` / `node`) would never have its execPath end
 * in `axiomate` / `axiomate.exe`.
 */
export function isInBundledMode(): boolean {
  if (
    typeof Bun !== 'undefined' &&
    Array.isArray(Bun.embeddedFiles) &&
    Bun.embeddedFiles.length > 0
  ) {
    return true
  }
  // Bun 1.3.x Linux: embeddedFiles is empty in compiled binaries. The
  // execPath basename is still the compiled outfile name, so use that.
  if (process.versions.bun !== undefined) {
    const execName = process.execPath.split(/[\\/]/).pop() ?? ''
    if (execName === 'axiomate' || execName === 'axiomate.exe') return true
  }
  return false
}

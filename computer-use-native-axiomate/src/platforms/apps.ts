/**
 * Application management — platform-specific implementations.
 *
 * macOS: osascript / mdfind
 * Windows: PowerShell / WMI
 * Linux: wmctrl / xdotool / desktop files
 */

import { execSync } from 'node:child_process'

export interface AppInfo {
  bundleId: string
  displayName: string
  path?: string
}

/** Encode a PowerShell script as base64 UTF-16LE for -EncodedCommand. */
function encodePsCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** Run a PowerShell script via -EncodedCommand (avoids all quoting issues). */
function runPs(script: string): string {
  const encoded = encodePsCommand(script)
  return execSync(`powershell.exe -NoProfile -EncodedCommand ${encoded}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'], // suppress stderr from appearing in console
  }).trim()
}

// ── Frontmost app ─────────────────────────────────────────────────────────

export async function getFrontmostApp(): Promise<AppInfo | null> {
  try {
    if (process.platform === 'darwin') {
      const script =
        'tell application "System Events" to get {bundle identifier, name} of first application process whose frontmost is true'
      const out = execSync(`osascript -e '${script}'`, { encoding: 'utf-8' }).trim()
      const [bundleId, name] = out.split(', ')
      if (bundleId && name) return { bundleId, displayName: name }
    } else if (process.platform === 'win32') {
      // Pure PowerShell — no C# compilation (Add-Type) needed.
      // Get-Process with MainWindowHandle > 0 finds the foreground process.
      // This avoids csc.exe temp files, startup cost, and concurrency issues.
      const out = runPs(`
$fw = Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Sort-Object -Property @{Expression={$_.Responding}; Descending=$true} | Select-Object -First 1
if ($fw) { $fw.ProcessName }
`)
      if (out) return { bundleId: out, displayName: out }
    } else {
      // Linux: xdotool
      const pid = execSync('xdotool getactivewindow getwindowpid', { encoding: 'utf-8' }).trim()
      if (pid) {
        const name = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8' }).trim()
        return { bundleId: name, displayName: name }
      }
    }
  } catch {
    // Tool not available or no window
  }
  return null
}

// ── List running apps ─────────────────────────────────────────────────────

export async function listRunningApps(): Promise<AppInfo[]> {
  try {
    if (process.platform === 'darwin') {
      const script =
        'tell application "System Events" to get {bundle identifier, name} of every application process whose background only is false'
      const out = execSync(`osascript -e '${script}'`, { encoding: 'utf-8' }).trim()
      // AppleScript returns two lists concatenated: "id1, id2, ..., name1, name2, ..."
      const parts = out.split(', ')
      const half = Math.floor(parts.length / 2)
      const ids = parts.slice(0, half)
      const names = parts.slice(half)
      return ids.map((id, i) => ({ bundleId: id!, displayName: names[i] ?? id! }))
    } else if (process.platform === 'win32') {
      const out = runPs(`
$procs = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object ProcessName
$procs | ConvertTo-Json -Compress
`)
      if (!out) return []
      let parsed: any
      try {
        parsed = JSON.parse(out)
      } catch {
        return []
      }
      const list = Array.isArray(parsed) ? parsed : [parsed]
      return list
        .filter((p: any) => p && p.ProcessName)
        .map((p: any) => ({ bundleId: p.ProcessName, displayName: p.ProcessName }))
    } else {
      const out = execSync('wmctrl -l -p 2>/dev/null || xdotool search --onlyvisible --name "" 2>/dev/null', {
        encoding: 'utf-8',
      }).trim()
      return out
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const name = line.split(/\s+/).slice(4).join(' ') || 'unknown'
          return { bundleId: name, displayName: name }
        })
    }
  } catch {
    return []
  }
}

// ── Open app ──────────────────────────────────────────────────────────────

export async function openApp(bundleIdOrName: string): Promise<void> {
  if (process.platform === 'darwin') {
    execSync(`open -b "${bundleIdOrName}" 2>/dev/null || open -a "${bundleIdOrName}"`)
  } else if (process.platform === 'win32') {
    runPs(`Start-Process "${bundleIdOrName}"`)
  } else {
    execSync(`xdg-open "${bundleIdOrName}" 2>/dev/null || "${bundleIdOrName}" &`)
  }
}

// ── List installed apps (stub — expensive operation) ──────────────────────

export async function listInstalledApps(): Promise<Array<AppInfo & { path: string }>> {
  // TODO: implement per platform
  // macOS: mdfind "kMDItemContentType == 'com.apple.application-bundle'"
  // Windows: Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*
  // Linux: parse .desktop files in /usr/share/applications/
  return []
}

// ── App under point (stub) ────────────────────────────────────────────────

export async function appUnderPoint(
  _x: number,
  _y: number,
): Promise<AppInfo | null> {
  // TODO: platform-specific window-at-point detection
  return null
}

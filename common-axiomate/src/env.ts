/**
 * Environment detection utilities.
 */

type Platform = 'win32' | 'darwin' | 'linux'

function isSSHSession(): boolean {
  return !!(
    process.env.SSH_CONNECTION ||
    process.env.SSH_CLIENT ||
    process.env.SSH_TTY
  )
}

function isWslEnvironment(): boolean {
  return !!process.env.WSL_DISTRO_NAME
}

function detectTerminal(): string | null {
  if (process.env.CURSOR_TRACE_ID) return 'cursor'
  if (process.env.VSCODE_GIT_ASKPASS_MAIN?.includes('cursor')) return 'cursor'
  if (process.env.VSCODE_GIT_ASKPASS_MAIN?.includes('windsurf')) return 'windsurf'

  if (process.env.TERM === 'xterm-ghostty') return 'ghostty'
  if (process.env.TERM?.includes('kitty')) return 'kitty'

  if (process.env.TERM_PROGRAM) return process.env.TERM_PROGRAM

  if (process.env.TMUX) return 'tmux'
  if (process.env.STY) return 'screen'

  if (process.env.KONSOLE_VERSION) return 'konsole'
  if (process.env.GNOME_TERMINAL_SERVICE) return 'gnome-terminal'
  if (process.env.XTERM_VERSION) return 'xterm'
  if (process.env.VTE_VERSION) return 'vte-based'
  if (process.env.KITTY_WINDOW_ID) return 'kitty'
  if (process.env.ALACRITTY_LOG) return 'alacritty'

  if (process.env.WT_SESSION) return 'windows-terminal'
  if (process.env.MSYSTEM) return process.env.MSYSTEM.toLowerCase()
  if (process.env.ConEmuANSI || process.env.ConEmuPID || process.env.ConEmuTask) return 'conemu'

  if (process.env.WSL_DISTRO_NAME) return `wsl-${process.env.WSL_DISTRO_NAME}`
  if (isSSHSession()) return 'ssh-session'

  if (process.env.TERM) {
    const term = process.env.TERM
    if (term.includes('alacritty')) return 'alacritty'
    if (term.includes('rxvt')) return 'rxvt'
    return process.env.TERM
  }

  if (!process.stdout.isTTY) return 'non-interactive'

  return null
}

async function hasInternetAccess(): Promise<boolean> {
  try {
    const { request } = await import('http')
    return new Promise(resolve => {
      const req = request('http://1.1.1.1', { method: 'HEAD', timeout: 1000 }, () => resolve(true))
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
      req.end()
    })
  } catch {
    return false
  }
}

async function isCommandAvailable(command: string): Promise<boolean> {
  const { execFile } = await import('child_process')
  return new Promise(resolve => {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    execFile(cmd, [command], error => resolve(!error))
  })
}

async function detectPackageManagers(): Promise<string[]> {
  const managers: string[] = []
  if (await isCommandAvailable('npm')) managers.push('npm')
  if (await isCommandAvailable('yarn')) managers.push('yarn')
  if (await isCommandAvailable('pnpm')) managers.push('pnpm')
  return managers
}

async function detectRuntimes(): Promise<string[]> {
  const runtimes: string[] = []
  if (await isCommandAvailable('node')) runtimes.push('node')
  if (await isCommandAvailable('bun')) runtimes.push('bun')
  if (await isCommandAvailable('deno')) runtimes.push('deno')
  return runtimes
}

function isRunningWithBun(): boolean {
  return typeof Bun !== 'undefined'
}

export const env = {
  platform: (['win32', 'darwin'].includes(process.platform)
    ? process.platform
    : 'linux') as Platform,
  arch: process.arch,
  nodeVersion: process.version,
  terminal: detectTerminal(),
  isCI: !!(process.env.CI && process.env.CI !== '0' && process.env.CI !== 'false'),
  isSSH: isSSHSession,
  isWslEnvironment,
  hasInternetAccess,
  getPackageManagers: detectPackageManagers,
  getRuntimes: detectRuntimes,
  isRunningWithBun,
}

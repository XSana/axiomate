import open from 'open'
import { execFileNoThrow } from './execFileNoThrow.js'

function validateUrl(url: string): void {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(url)
  } catch (_error) {
    throw new Error(`Invalid URL format: ${url}`)
  }

  // Validate URL protocol for security
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      `Invalid URL protocol: must use http:// or https://, got ${parsedUrl.protocol}`,
    )
  }
}

/**
 * Open a file or folder path using the system's default handler.
 * Uses the `open` package so Windows/WSL/macOS/Linux shell handoff details
 * stay centralized.
 */
export async function openPath(path: string): Promise<boolean> {
  try {
    await open(path, { wait: false })
    return true
  } catch (_) {
    return false
  }
}

export async function openBrowser(url: string): Promise<boolean> {
  try {
    // Parse and validate the URL
    validateUrl(url)

    const browserEnv = process.env.BROWSER
    const platform = process.platform

    if (platform === 'win32') {
      if (browserEnv) {
        // browsers require shell, else they will treat this as a file:/// handle
        const { code } = await execFileNoThrow(browserEnv, [`"${url}"`])
        return code === 0
      }
      const { code } = await execFileNoThrow(
        'rundll32',
        ['url,OpenURL', url],
        {},
      )
      return code === 0
    } else {
      const command =
        browserEnv || (platform === 'darwin' ? 'open' : 'xdg-open')
      const { code } = await execFileNoThrow(command, [url])
      return code === 0
    }
  } catch (_) {
    return false
  }
}

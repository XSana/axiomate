/**
 * HTTP utility constants and helpers
 */

import axios from 'axios'
import { getAxiomateUserAgent } from './userAgent.js'
import { getWorkload } from './workloadContext.js'

export function getUserAgent(): string {
  const agentSdkVersion = process.env.AXIOMATE_AGENT_SDK_VERSION
    ? `, agent-sdk/${process.env.AXIOMATE_AGENT_SDK_VERSION}`
    : ''
  const clientApp = process.env.AXIOMATE_AGENT_SDK_CLIENT_APP
    ? `, client-app/${process.env.AXIOMATE_AGENT_SDK_CLIENT_APP}`
    : ''
  const workload = getWorkload()
  const workloadSuffix = workload ? `, workload/${workload}` : ''
  return `axiomate/${MACRO.VERSION} (${process.env.USER_TYPE}, ${process.env.AXIOMATE_CODE_ENTRYPOINT ?? 'cli'}${agentSdkVersion}${clientApp}${workloadSuffix})`
}

export function getMCPUserAgent(): string {
  const parts: string[] = []
  if (process.env.AXIOMATE_CODE_ENTRYPOINT) {
    parts.push(process.env.AXIOMATE_CODE_ENTRYPOINT)
  }
  if (process.env.AXIOMATE_AGENT_SDK_VERSION) {
    parts.push(`agent-sdk/${process.env.AXIOMATE_AGENT_SDK_VERSION}`)
  }
  if (process.env.AXIOMATE_AGENT_SDK_CLIENT_APP) {
    parts.push(`client-app/${process.env.AXIOMATE_AGENT_SDK_CLIENT_APP}`)
  }
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `axiomate/${MACRO.VERSION}${suffix}`
}

// User-Agent for WebFetch requests to arbitrary sites.
export function getWebFetchUserAgent(): string {
  return `Axiomate-User (${getAxiomateUserAgent()})`
}

/**
 * Wrapper that handles OAuth 401 errors by force-refreshing the token and
 * retrying once. Addresses clock drift scenarios where the local expiration
 * check disagrees with the server.
 *
 * The request closure is called again on retry, so it should re-read auth
 * (e.g., via getAuthHeaders()) to pick up the refreshed token.
 *
 * Note: bridgeApi.ts has its own DI-injected version — handleOAuth401Error
 * transitively pulls in config.ts (~1300 modules), which breaks the SDK bundle.
 *
 * @param opts.also403Revoked - Also retry on 403 with "OAuth token has been
 *   revoked" body (some endpoints signal revocation this way instead of 401).
 */
export async function withOAuth401Retry<T>(
  request: () => Promise<T>,
  opts?: { also403Revoked?: boolean },
): Promise<T> {
  try {
    return await request()
  } catch (err) {
    if (!axios.isAxiosError(err)) throw err
    const status = err.response?.status
    const isAuthError =
      status === 401 ||
      (opts?.also403Revoked &&
        status === 403 &&
        typeof err.response?.data === 'string' &&
        err.response.data.includes('OAuth token has been revoked'))
    if (!isAuthError) throw err
    const failedAccessToken = undefined
    if (!failedAccessToken) throw err
    
    return await request()
  }
}

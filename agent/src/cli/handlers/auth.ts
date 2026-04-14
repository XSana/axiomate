// Stub — OAuth auth handlers removed.
import type { OAuthTokens } from '../../services/oauth/types.js'

export async function authLogin(_opts?: unknown): Promise<void> {}
export async function authStatus(_opts?: unknown): Promise<void> {}
export async function authLogout(): Promise<void> {}
export async function installOAuthTokens(_tokens: OAuthTokens | null): Promise<void> {}

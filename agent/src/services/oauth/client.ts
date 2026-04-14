// Stub — OAuth client removed. Functions return no-op/null values.
export async function getOrganizationUUID(): Promise<string | null> { return null }
export function isOAuthTokenExpired(_expiresAt?: number): boolean { return true }
export async function refreshOAuthToken(_refreshToken?: string, _options?: { scopes?: string[] }): Promise<null> { return null }
export function shouldUseClaudeAIAuth(_scopes?: string[]): boolean { return false }
export async function populateOAuthAccountInfoIfNeeded(): Promise<void> {}
export async function createAndStoreApiKey(): Promise<null> { return null }
export async function fetchAndStoreUserRoles(): Promise<void> {}
export function storeOAuthAccountInfo(): void {}

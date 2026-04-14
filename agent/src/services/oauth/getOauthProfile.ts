// Stub — OAuth profile fetching removed.
export type OAuthProfile = {
  organization: { uuid: string; name?: string }
  [key: string]: unknown
}
export async function getOauthProfileFromOauthToken(_token?: string): Promise<OAuthProfile | null> { return null }
export async function getOauthProfileFromApiKey(_key?: string): Promise<OAuthProfile | null> { return null }

// Stub — OAuthService removed.
export class OAuthService {
  static async startFlow(): Promise<null> { return null }
  cleanup(): void {}
  async startOAuthFlow(_urlHandler?: (url: string, automaticUrl?: string) => void, _options?: unknown): Promise<{ accessToken: string } | null> { return null }
  handleManualAuthCodeInput(_input: unknown): void {}
}

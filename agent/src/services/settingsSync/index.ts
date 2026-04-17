// Settings sync — all stubs (no remote settings backend).
export async function uploadUserSettingsInBackground(): Promise<void> {}
export function _resetDownloadPromiseForTesting(): void {}
export async function downloadUserSettings(): Promise<boolean> { return false }
export async function redownloadUserSettings(): Promise<boolean> { return false }

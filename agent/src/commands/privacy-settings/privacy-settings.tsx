import * as React from 'react';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
const FALLBACK_MESSAGE = 'Privacy settings management is not available in this build.';
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode | null> {
  // Grove/privacy modules removed — show fallback message
  onDone(FALLBACK_MESSAGE);
  return null;
}

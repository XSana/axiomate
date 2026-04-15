import * as React from 'react';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
const FALLBACK_MESSAGE = 'Review and manage your privacy settings at https://claude.ai/settings/data-privacy-controls';
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode | null> {
  // Grove/privacy modules removed — show fallback message
  onDone(FALLBACK_MESSAGE);
  return null;
}

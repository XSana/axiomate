import * as React from 'react';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  // RemoteEnvironmentDialog module removed
  onDone('Remote environment configuration is no longer available.', { display: 'system' as const });
  return null as unknown as React.ReactNode;
}

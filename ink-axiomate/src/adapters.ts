export interface InkAdapters {
  logForDebugging: (message: string, options?: { level?: string }) => void
  flushInteractionTime: () => void
  updateLastInteractionTime: (immediate?: boolean) => void
  markScrollActivity: () => void
  stopCapturingEarlyInput: () => void
}

export const adapters: InkAdapters = {
  logForDebugging: () => {},
  flushInteractionTime: () => {},
  updateLastInteractionTime: () => {},
  markScrollActivity: () => {},
  stopCapturingEarlyInput: () => {},
}

export function configure(overrides: Partial<InkAdapters>): void {
  Object.assign(adapters, overrides)
}

export interface TipContext {
  theme?: any
  bashTools?: Set<string>
  readFileState?: unknown
}

export interface TipContentContext {
  theme?: any
}

export interface Tip {
  id: string
  content: (ctx?: TipContentContext) => Promise<string>
  cooldownSessions: number
  isRelevant: (context?: TipContext) => Promise<boolean>
}

import { query } from './query.js'
import type {
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  ListSessionsOptions,
  Options,
  SDKMessage,
  SDKResultMessage,
  SDKSession,
  SDKSessionInfo,
  SDKSessionOptions,
  SDKUserMessage,
  SessionMessage,
  SessionMutationOptions,
  Query,
} from './types/index.js'

export function unstable_v2_createSession(options: SDKSessionOptions): SDKSession {
  const sessionId = options.sessionId ?? crypto.randomUUID()

  return {
    get sessionId() {
      return sessionId
    },

    send(message: string | SDKUserMessage): Query {
      const prompt = typeof message === 'string' ? message : undefined
      const streamInput = typeof message !== 'string'
        ? (async function* () { yield message })()
        : undefined

      return query({
        prompt: prompt ?? streamInput!,
        options: {
          ...options,
          sessionId,
          resume: sessionId,
        },
      })
    },

    async close() {
      // Session cleanup is handled by the CLI process
    },
  }
}

export function unstable_v2_resumeSession(
  sessionId: string,
  options: SDKSessionOptions,
): SDKSession {
  return unstable_v2_createSession({ ...options, sessionId, resume: sessionId })
}

export async function unstable_v2_prompt(
  message: string,
  options: SDKSessionOptions,
): Promise<SDKResultMessage> {
  const q = query({ prompt: message, options })

  let result: SDKResultMessage | undefined

  for await (const msg of q) {
    if (msg.type === 'result') {
      result = msg as SDKResultMessage
    }
  }

  if (!result) {
    throw new Error('No result message received from agent')
  }

  return result
}

export async function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions,
): Promise<SessionMessage[]> {
  const q = query({
    prompt: `__sdk_internal_get_session_messages ${sessionId}`,
    options: {
      cwd: options?.dir,
      maxTurns: 0,
    },
  })

  // For session read operations, we use the CLI's session reading capability
  // This is a placeholder — actual implementation depends on CLI support for session queries
  const messages: SessionMessage[] = []
  for await (const _msg of q) {
    // Collect messages from the stream
  }
  return messages
}

export async function listSessions(
  options?: ListSessionsOptions,
): Promise<SDKSessionInfo[]> {
  // Session listing reads from the filesystem directly
  // This requires access to ~/.claude/projects/ or the specified dir
  // For now, delegate to CLI via a special command
  return []
}

export async function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions,
): Promise<SDKSessionInfo | undefined> {
  return undefined
}

export async function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions,
): Promise<void> {
  // Append custom-title entry to session JSONL
}

export async function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions,
): Promise<void> {
  // Append tag entry to session JSONL
}

export async function forkSession(
  sessionId: string,
  options?: ForkSessionOptions,
): Promise<ForkSessionResult> {
  const newSessionId = crypto.randomUUID()
  // Fork implementation: copy transcript with remapped UUIDs
  return { sessionId: newSessionId }
}

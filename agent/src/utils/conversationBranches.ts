/**
 * Conversation chain helpers for the /rewind picker's Conversation tab.
 *
 * Two responsibilities:
 *
 *  1. `transcriptToUserMessage` — build a real `UserMessage` from a stored
 *     `TranscriptMessage`. The picker's row-render path expects
 *     `UserMessage`-shaped objects (it reads `.message.content` etc), but the
 *     loader gives us `TranscriptMessage`. A bare `as UserMessage` cast would
 *     pass typecheck and crash at render time on shape mismatches; we go
 *     through `createUserMessage` to construct an honest object whose shape
 *     the picker already knows how to consume (it uses the same factory for
 *     synthetic ↶ rows).
 *
 *  2. `findChainUserMessages` — given a loaded transcript and the head leaf,
 *     walk parentUuid back from the leaf and collect every user-typed
 *     message on the path (filter synthetic interrupt placeholders). The
 *     result is the picker's row source — every entry the user can rewind
 *     to. Returned in chronological order (oldest → newest) so the picker
 *     can render in time order without re-sorting.
 *
 * Same-session multi-branch isn't axiomate's semantic — `/branch` creates
 * a new session file for that. Within a session, conversation rewind moves
 * the head pointer along a single chain; this helper is just "give me that
 * chain as picker rows".
 */
import type { UUID } from 'crypto'

import type { TranscriptMessage } from '../types/logs.js'
import type { Message, UserMessage } from '../types/message.js'

import { createUserMessage, isSyntheticMessage } from './messages.js'

/**
 * Adapt a stored `TranscriptMessage` (user-typed) to a `UserMessage` the
 * picker can render. We copy only the fields the picker reads — uuid,
 * timestamp, message.content — and let `createUserMessage` fill in the
 * canonical shape (role, isMeta defaults, etc).
 *
 * Caller is responsible for passing a user-typed transcript message; the
 * adapter doesn't try to reshape assistant or tool-result frames.
 */
export function transcriptToUserMessage(tm: TranscriptMessage): UserMessage {
  const content = (tm as { message?: { content?: unknown } }).message?.content
  return {
    ...createUserMessage({
      content:
        typeof content === 'string' || Array.isArray(content)
          ? (content as string | Parameters<typeof createUserMessage>[0]['content'])
          : '',
    }),
    uuid: tm.uuid,
    timestamp: tm.timestamp,
  } as UserMessage
}

/**
 * Walk parentUuid back from the head leaf and collect every user-typed
 * message on the chain. Synthetic interrupt placeholders (cancel sentinels,
 * `[Request interrupted by user]`) are skipped — those aren't real prompts
 * the user can rewind to.
 *
 * Returns chronologically ordered (oldest → newest) so the picker can
 * render top-down without re-sorting.
 *
 * `headLeafUuid` should be the result of `pickConversationHead` —
 * authoritative current-head pointer, head record wins over latest leaf.
 */
export function findChainUserMessages(args: {
  messages: Map<UUID, TranscriptMessage>
  headLeafUuid: UUID | undefined
}): UserMessage[] {
  const { messages, headLeafUuid } = args
  if (!headLeafUuid) return []

  const out: UserMessage[] = []
  const seen = new Set<UUID>()
  let cur = messages.get(headLeafUuid)
  while (cur && !seen.has(cur.uuid)) {
    seen.add(cur.uuid)
    if (cur.type === 'user' && !isSyntheticMessage(cur as unknown as Message)) {
      // unshift to keep oldest-first order (we walk newest → oldest).
      out.unshift(transcriptToUserMessage(cur))
    }
    if (!cur.parentUuid) break
    cur = messages.get(cur.parentUuid)
  }
  return out
}

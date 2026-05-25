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

import { createUserMessage } from './messages.js'
import { selectableUserMessagesFilter } from '../components/MessageSelector.js'

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
  // Pass through the boolean fields the picker filter (and other UI
  // gates) checks: isMeta marks injected continuation messages from
  // resume / interrupt recovery; isCompactSummary tags compact-boundary
  // synthetic prompts; isVisibleInTranscriptOnly suppresses transcript-
  // only entries from the selectable list. Without these, the picker
  // sees a UserMessage with all flags false and surfaces meta turns
  // like "Continue from where you left off" as real prompts.
  const raw = tm as Partial<UserMessage>
  return {
    ...createUserMessage({
      content:
        typeof content === 'string' || Array.isArray(content)
          ? (content as string | Parameters<typeof createUserMessage>[0]['content'])
          : '',
    }),
    uuid: tm.uuid,
    timestamp: tm.timestamp,
    isMeta: raw.isMeta ?? false,
    isCompactSummary: raw.isCompactSummary ?? false,
    isVisibleInTranscriptOnly: raw.isVisibleInTranscriptOnly ?? false,
  } as UserMessage
}

/**
 * Walk parentUuid back from the head leaf and collect every user
 * message on the chain that the picker would surface as a real
 * rewindable prompt. Filtering goes through `selectableUserMessagesFilter`
 * — same gate the picker's in-memory list uses — so the JSONL-derived
 * "future" rows match the in-memory rows in what they include / hide:
 * synthetic interrupt sentinels, isMeta continuation messages, compact
 * summaries, transcript-only entries, slash-command / bash / tool-output
 * tag wrappers — all dropped.
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
    if (cur.type === 'user') {
      const um = transcriptToUserMessage(cur)
      // Apply the picker's gate to the adapted UserMessage so meta /
      // synthetic / compact / command-tag rows are dropped uniformly.
      if (selectableUserMessagesFilter(um as unknown as Message)) {
        // unshift to keep oldest-first order (we walk newest → oldest).
        out.unshift(um)
      }
    }
    if (!cur.parentUuid) break
    cur = messages.get(cur.parentUuid)
  }
  return out
}

/**
 * Conversation branch helpers for the /rewind picker's Conversation tab.
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
 *     synthetic ↶ rows). See axiomate/agent/src/components/MessageSelector.tsx
 *     `messageOptions` and `syntheticAnchors`.
 *
 *  2. `findAbandonedLeafChains` — given the loaded transcript, return one
 *     chain per *abandoned* leaf, i.e. every leaf reachable in the JSONL
 *     except the one the user is currently on. Each chain is the sequence of
 *     user messages from the leaf back through `parentUuid` until the chain
 *     joins the current head's chain (or hits null / the most recent compact
 *     boundary, whichever comes first).
 *
 *     Loader (`loadTranscriptFile`) already prunes everything before the most
 *     recent compact boundary, so abandoned chains never span across compact
 *     boundaries — the message Map simply doesn't contain those entries.
 *     The walk is implemented defensively anyway (stops at null / unknown
 *     parentUuid) so a malformed transcript can't infinite-loop us.
 */
import type { UUID } from 'crypto'

import type { TranscriptMessage } from '../types/logs.js'
import type { UserMessage } from '../types/message.js'

import { createUserMessage } from './messages.js'

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
 * Result type — one entry per abandoned leaf. `chain` is ordered oldest → newest
 * (root-side first, leaf last) and only contains user-typed messages, since
 * those are the picker's selectable units.
 */
export type AbandonedChain = {
  /** UUID of the abandoned leaf message (newest in the chain). */
  leafUuid: UUID
  /** Timestamp of the abandoned leaf — used for chronological merge. */
  leafTimestamp: string
  /** User messages in the abandoned branch, oldest → newest. */
  chain: UserMessage[]
}

/**
 * Walk every abandoned leaf back to where it joins the current head's chain
 * (or to a chain root if it never joins, e.g. pre-compact orphan).
 *
 * `headChainUuids` is the set of uuids on the active conversation chain —
 * caller computes it by walking the head leaf back through parentUuid.
 * Anything in that set is "current chain"; we stop the walk there so the
 * abandoned chain only contains the divergent suffix.
 */
export function findAbandonedLeafChains(args: {
  messages: Map<UUID, TranscriptMessage>
  leafUuids: Set<UUID>
  headChainUuids: Set<UUID>
  /** UUID the current head record / heuristic resolved to; excluded from results. */
  headLeafUuid: UUID | undefined
}): AbandonedChain[] {
  const { messages, leafUuids, headChainUuids, headLeafUuid } = args
  const out: AbandonedChain[] = []

  for (const leafUuid of leafUuids) {
    if (leafUuid === headLeafUuid) continue
    if (headChainUuids.has(leafUuid)) continue
    const leaf = messages.get(leafUuid)
    if (!leaf) continue

    const chain: UserMessage[] = []
    const seen = new Set<UUID>()
    let cur: TranscriptMessage | undefined = leaf
    while (cur && !seen.has(cur.uuid)) {
      seen.add(cur.uuid)
      // Stop when we re-enter the current chain — the divergence point and
      // everything before it is shared, so don't double-render those rows.
      if (headChainUuids.has(cur.uuid)) break
      if (cur.type === 'user') {
        chain.unshift(transcriptToUserMessage(cur))
      }
      const parentUuid = cur.parentUuid
      if (!parentUuid) break
      cur = messages.get(parentUuid)
    }

    if (chain.length === 0) continue
    out.push({
      leafUuid,
      leafTimestamp: leaf.timestamp,
      chain,
    })
  }

  out.sort((a, b) => (a.leafTimestamp < b.leafTimestamp ? 1 : -1))
  return out
}

/**
 * Walk the head leaf back through parentUuid and collect every uuid on the
 * way. Helper for `findAbandonedLeafChains` callers — returned set is the
 * "current chain" boundary.
 */
export function buildHeadChainUuids(
  messages: Map<UUID, TranscriptMessage>,
  headLeafUuid: UUID | undefined,
): Set<UUID> {
  const out = new Set<UUID>()
  if (!headLeafUuid) return out
  let cur = messages.get(headLeafUuid)
  while (cur && !out.has(cur.uuid)) {
    out.add(cur.uuid)
    if (!cur.parentUuid) break
    cur = messages.get(cur.parentUuid)
  }
  return out
}

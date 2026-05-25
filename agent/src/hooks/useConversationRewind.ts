/**
 * Conversation rewind orchestration. Owns the three callbacks that
 * mutate React state when the user (or the auto-restore path) wants to
 * rewind the conversation to a specific message:
 *
 *  - rewindConversationTo: slice messages, persist head record + rewind
 *    marker, reset conversation id / microcompact / permission mode.
 *  - restoreMessageSync: rewindConversationTo + repopulate the input
 *    box from the rewound message (text + image paste). Used on
 *    interrupt-restore so React batches the abort's setMessages with
 *    the rewind into a single render (no flicker).
 *  - handleRestoreMessage: picker entry point — defers
 *    restoreMessageSync via setImmediate so the "Interrupted" message
 *    has time to render before the rewind blanks it.
 *
 * Lives outside REPL.tsx so the conversation-rewind picker
 * (`ConversationRewindPicker.tsx`, /rewind-chat) and the file-rewind
 * picker (`MessageSelector.tsx`, /rewind) don't share rewind logic
 * through REPL — only the file picker has any business calling
 * `onRestoreCode`, and only the conversation picker has any business
 * calling these.
 *
 * The 'both' rewind mode (Restore file and conversation) was removed
 * in #215 because it created an asymmetric undo state — only the file
 * half was recoverable. handleRestoreMessage is now conversation-only.
 */
import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID, type UUID } from 'crypto'
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
} from 'react'

import { resetMicrocompactState } from '../services/compact/microCompact.js'
import type { AppState } from '../state/AppStateStore.js'
import type { Message, UserMessage } from '../types/message.js'
import type { PromptInputMode } from '../types/textInputTypes.js'
import { logError } from '../utils/log.js'
import { textForResubmit } from '../utils/messages.js'
import {
  recordConversationHead,
  recordRewindMarker,
} from '../utils/sessionStorage.js'
import { getSessionId } from '../bootstrap/state.js'
import type { PastedContent } from '../utils/config.js'

type SetMessagesAction =
  | Message[]
  | ((prev: Message[]) => Message[])

export type ConversationRewindActions = {
  rewindConversationTo: (message: UserMessage) => void
  restoreMessageSync: (message: UserMessage) => void
  /**
   * MessageSelector compatibility shape — mode arg is vestigial after
   * #215 dropped the 'both' option, but kept for prop-type stability.
   * Returns Promise to match the existing async callback signature
   * MessageSelector expects.
   */
  handleRestoreMessage: (
    message: UserMessage,
    mode?: 'conversation-only',
  ) => Promise<void>
}

export function useConversationRewind(deps: {
  messagesRef: RefObject<Message[]>
  setMessages: (action: SetMessagesAction) => void
  setConversationId: Dispatch<SetStateAction<UUID>>
  setAppState: (
    action: AppState | ((prev: AppState) => AppState),
  ) => void
  setInputValue: (v: string) => void
  setInputMode: Dispatch<SetStateAction<PromptInputMode>>
  setPastedContents: Dispatch<SetStateAction<Record<number, PastedContent>>>
}): ConversationRewindActions {
  const {
    messagesRef,
    setMessages,
    setConversationId,
    setAppState,
    setInputValue,
    setInputMode,
    setPastedContents,
  } = deps

  const rewindConversationTo = useCallback(
    (message: UserMessage) => {
      const prev = messagesRef.current ?? []
      const messageIndex = prev.lastIndexOf(message)
      if (messageIndex === -1) return
      setMessages(prev.slice(0, messageIndex))
      setConversationId(randomUUID())
      resetMicrocompactState()

      // Persist the head + audit marker so /resume / --continue
      // honor this rewind even before the user types anything new.
      // Skip if rewinding to the very first message (no truncated-
      // chain leaf to point at — fallback to latest-leaf is correct).
      if (messageIndex > 0) {
        const newLeaf = prev[messageIndex - 1]
        if (newLeaf) {
          try {
            recordConversationHead(getSessionId(), newLeaf.uuid)
            const fromLeafUuid = (
              prev[prev.length - 1] as { uuid?: UUID } | undefined
            )?.uuid
            if (fromLeafUuid && fromLeafUuid !== newLeaf.uuid) {
              const abandonedCount = prev
                .slice(messageIndex)
                .filter(m => m.type === 'user').length
              recordRewindMarker(getSessionId(), {
                fromLeafUuid,
                toLeafUuid: newLeaf.uuid,
                abandonedCount,
              })
            }
          } catch (e) {
            logError(e as Error)
          }
        }
      }

      setAppState(prevState => ({
        ...prevState,
        toolPermissionContext:
          message.permissionMode &&
          prevState.toolPermissionContext.mode !== message.permissionMode
            ? {
                ...prevState.toolPermissionContext,
                mode: message.permissionMode,
              }
            : prevState.toolPermissionContext,
        promptSuggestion: {
          text: null,
          promptId: null,
          shownAt: 0,
          acceptedAt: 0,
          generationRequestId: null,
        },
      }))
    },
    [messagesRef, setMessages, setConversationId, setAppState],
  )

  const restoreMessageSync = useCallback(
    (message: UserMessage) => {
      rewindConversationTo(message)
      const r = textForResubmit(message)
      if (r) {
        setInputValue(r.text)
        setInputMode(r.mode)
      }
      if (
        Array.isArray(message.message.content) &&
        message.message.content.some(b => b.type === 'image')
      ) {
        const imageBlocks: ImageBlockParam[] =
          message.message.content.filter(
            (b): b is ImageBlockParam => b.type === 'image',
          )
        if (imageBlocks.length > 0) {
          const newPastedContents: Record<number, PastedContent> = {}
          imageBlocks.forEach((block, index) => {
            if (block.source.type === 'base64') {
              const id = message.imagePasteIds?.[index] ?? index + 1
              newPastedContents[id] = {
                id,
                type: 'image',
                content: block.source.data,
                mediaType: block.source.media_type,
              }
            }
          })
          setPastedContents(newPastedContents)
        }
      }
    },
    [
      rewindConversationTo,
      setInputValue,
      setInputMode,
      setPastedContents,
    ],
  )

  const handleRestoreMessage = useCallback(
    async (message: UserMessage, _mode?: 'conversation-only') => {
      void _mode
      // Defer so an "Interrupted" line emitted by an in-flight abort has
      // time to render before the rewind blanks the chain. Without
      // setImmediate the abort's transient message stays vestigial at
      // the top of the screen.
      setImmediate(
        (restore, m) => restore(m),
        restoreMessageSync,
        message,
      )
    },
    [restoreMessageSync],
  )

  return { rewindConversationTo, restoreMessageSync, handleRestoreMessage }
}

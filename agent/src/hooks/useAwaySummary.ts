/**
 * useAwaySummary — when the terminal regains focus after > 5 min blur,
 * generate a short "while you were away" recap using the fastModel and
 * append it to the REPL history as a SystemMessage.
 *
 * Opt-in via settings.awaySummaryEnabled OR env
 * AXIOMATE_CODE_ENABLE_AWAY_SUMMARY=1. Default OFF (cost + UX shock).
 *
 * Triggers once per blur event. Skipped during an in-flight turn — the
 * recap would race with streaming output. Skipped for conversations with
 * no assistant messages (nothing to recap).
 */
import { useEffect, useRef } from 'react'
import {
  AWAY_SUMMARY_THRESHOLD_MS,
  generateAwaySummary,
  isAwaySummaryEnabled,
} from '../services/awaySummary.js'
import type { Message } from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'
import { createSystemMessage } from '../utils/messages.js'
import React from 'react'

export function useAwaySummary(params: {
  isFocused: boolean
  isLoading: boolean
  messagesRef: React.RefObject<Message[]>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
}): void {
  const { isFocused, isLoading, messagesRef, setMessages } = params
  const lastFocusedRef = useRef(isFocused)
  const blurredAtRef = useRef<number | null>(null)
  const inflightAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      // Abort any in-progress generation on unmount.
      inflightAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const wasFocused = lastFocusedRef.current
    lastFocusedRef.current = isFocused

    if (!isAwaySummaryEnabled()) return

    // Just blurred: record timestamp and return.
    if (wasFocused && !isFocused) {
      blurredAtRef.current = Date.now()
      return
    }

    // Just regained focus: check if we were blurred long enough.
    if (!wasFocused && isFocused) {
      const blurredAt = blurredAtRef.current
      blurredAtRef.current = null
      if (blurredAt == null) return
      const gapMs = Date.now() - blurredAt
      if (gapMs < AWAY_SUMMARY_THRESHOLD_MS) return

      // Skip during in-flight turn; would race with streaming output.
      if (isLoading) return

      // Skip empty / near-empty sessions — no signal to recap.
      const messages = messagesRef.current ?? []
      const hasAssistantTurn = messages.some(m => m.type === 'assistant')
      if (!hasAssistantTurn) return

      // Cancel any previous in-flight generation (e.g. quick focus toggles).
      inflightAbortRef.current?.abort()
      const abortController = new AbortController()
      inflightAbortRef.current = abortController

      const gapMinutes = Math.round(gapMs / 60_000)
      logForDebugging(
        `[awaySummary] focus regained after ${gapMinutes}min, generating recap`,
      )
      void generateAwaySummary(messages, abortController.signal).then(recap => {
        if (abortController.signal.aborted || !recap) return
        setMessages(prev => [
          ...prev,
          createSystemMessage(
            `While you were away (${gapMinutes}min): ${recap}`,
            'info',
          ),
        ])
      })
    }
  }, [isFocused, isLoading, messagesRef, setMessages])
}

import React from 'react'
import { Box, Text } from '../../ink.js'
import {
  FeedbackSurveyView,
  isValidResponseInput,
} from './FeedbackSurveyView.js'
import type { TranscriptShareResponse } from './TranscriptSharePrompt.js'
import { TranscriptSharePrompt } from './TranscriptSharePrompt.js'
import type { FeedbackSurveyResponse } from './utils.js'

type Props = {
  state:
    | 'closed'
    | 'open'
    | 'thanks'
    | 'transcript_prompt'
    | 'submitting'
    | 'submitted'
  lastResponse: FeedbackSurveyResponse | null
  handleSelect: (selected: FeedbackSurveyResponse) => void
  handleTranscriptSelect?: (selected: TranscriptShareResponse) => void
  inputValue: string
  setInputValue: (value: string) => void
  message?: string
}

export function FeedbackSurvey({
  state,
  lastResponse,
  handleSelect,
  handleTranscriptSelect,
  inputValue,
  setInputValue,
  message,
}: Props): React.ReactNode {
  if (state === 'closed') {
    return null
  }

  if (state === 'thanks') {
    return (
      <FeedbackSurveyThanks
        lastResponse={lastResponse}
      />
    )
  }

  if (state === 'submitted') {
    return (
      <Box marginTop={1}>
        <Text color="success">
          {'\u2713'} Thanks for sharing your transcript!
        </Text>
      </Box>
    )
  }

  if (state === 'submitting') {
    return (
      <Box marginTop={1}>
        <Text dimColor>Sharing transcript{'\u2026'}</Text>
      </Box>
    )
  }

  if (state === 'transcript_prompt') {
    if (!handleTranscriptSelect) {
      return null
    }
    // Hide prompt if user is typing non-response characters
    if (inputValue && !['1', '2', '3'].includes(inputValue)) {
      return null
    }
    return (
      <TranscriptSharePrompt
        onSelect={handleTranscriptSelect}
        inputValue={inputValue}
        setInputValue={setInputValue}
      />
    )
  }

  // state === 'open'
  // Hide the survey if the user is typing anything other than a survey response.
  // This prevents the survey from showing up when the user is typing a message,
  // which can result in accidental survey submissions (e.g. "s3cmd").
  if (inputValue && !isValidResponseInput(inputValue)) {
    return null
  }

  return (
    <FeedbackSurveyView
      onSelect={handleSelect}
      inputValue={inputValue}
      setInputValue={setInputValue}
      message={message}
    />
  )
}

type ThanksProps = {
  lastResponse: FeedbackSurveyResponse | null
}

function FeedbackSurveyThanks({
  lastResponse,
}: ThanksProps): React.ReactNode {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="success">Thanks for the feedback!</Text>
      {lastResponse === 'bad' ? (
        <Text dimColor>Use /issue to report model behavior issues.</Text>
      ) : null}
    </Box>
  )
}

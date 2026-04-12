// Configurable speech-to-text client for /voice.
//
// The recorder produces 16 kHz mono PCM i16 LE chunks. Transcription adapters
// receive those chunks and return text through a small streaming-shaped
// connection interface, even when the underlying provider is batch-only.

import {
  getGlobalConfig,
  type HttpSttProviderConfig,
  type OpenAICompatibleSttProviderConfig,
  type VoiceSttProviderConfig,
} from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { logError } from '../utils/log.js'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_TIMEOUT_MS = 60_000
const SAMPLE_RATE = 16_000
const CHANNELS = 1
const BITS_PER_SAMPLE = 16

export type VoiceTranscriptionCallbacks = {
  onTranscript: (text: string, isFinal: boolean) => void
  onError: (error: string, opts?: { fatal?: boolean }) => void
  onClose: () => void
  onReady: (connection: VoiceTranscriptionConnection) => void
}

export type FinalizeSource =
  | 'completed'
  | 'no_audio'
  | 'failed'
  | 'already_closed'

export type VoiceTranscriptionConnection = {
  send: (audioChunk: Buffer) => void
  finalize: () => Promise<FinalizeSource>
  close: () => void
  isConnected: () => boolean
}

export function getVoiceTranscriptionConfigStatus(): {
  available: boolean
  reason: string | null
} {
  const config = getConfiguredSttProvider()
  if (!config) {
    return {
      available: false,
      reason:
        'Voice mode requires a speech-to-text provider in ~/.axiomate.json at voice.stt.',
    }
  }

  const apiKeyError = validateApiKey(config)
  if (apiKeyError) {
    return { available: false, reason: apiKeyError }
  }

  if (
    (config.type === 'openai' || config.type === 'openai-compatible') &&
    !config.model?.trim()
  ) {
    return {
      available: false,
      reason: 'voice.stt.model is required for OpenAI-compatible transcription.',
    }
  }

  if (config.type === 'http' && !config.url?.trim()) {
    return { available: false, reason: 'voice.stt.url is required.' }
  }

  return { available: true, reason: null }
}

export function isVoiceTranscriptionAvailable(): boolean {
  return getVoiceTranscriptionConfigStatus().available
}

export async function connectVoiceTranscriber(
  callbacks: VoiceTranscriptionCallbacks,
  options?: { language?: string; keyterms?: string[] },
): Promise<VoiceTranscriptionConnection | null> {
  const status = getVoiceTranscriptionConfigStatus()
  if (!status.available) {
    callbacks.onError(status.reason ?? 'Voice transcription is not configured.', {
      fatal: true,
    })
    return null
  }

  const config = getConfiguredSttProvider()
  if (!config) return null

  const connection = new BatchTranscriptionConnection(config, callbacks, options)
  queueMicrotask(() => callbacks.onReady(connection))
  return connection
}

class BatchTranscriptionConnection implements VoiceTranscriptionConnection {
  #chunks: Buffer[] = []
  #closed = false
  #finalizing: Promise<FinalizeSource> | null = null

  constructor(
    private readonly config: VoiceSttProviderConfig,
    private readonly callbacks: VoiceTranscriptionCallbacks,
    private readonly options?: { language?: string; keyterms?: string[] },
  ) {}

  send(audioChunk: Buffer): void {
    if (this.#closed || this.#finalizing) return
    this.#chunks.push(Buffer.from(audioChunk))
  }

  finalize(): Promise<FinalizeSource> {
    if (this.#closed) return Promise.resolve('already_closed')
    this.#finalizing ??= this.#transcribe()
    return this.#finalizing
  }

  close(): void {
    this.#closed = true
    this.#chunks = []
    this.callbacks.onClose()
  }

  isConnected(): boolean {
    return !this.#closed
  }

  async #transcribe(): Promise<FinalizeSource> {
    const pcm = Buffer.concat(this.#chunks)
    this.#chunks = []

    if (pcm.length === 0) {
      return 'no_audio'
    }

    try {
      const config = this.config
      const text =
        config.type === 'http'
          ? await transcribeHttp(config, pcm, this.options)
          : await transcribeOpenAICompatible(config, pcm, this.options)

      const trimmed = text.trim()
      if (trimmed) {
        this.callbacks.onTranscript(trimmed, true)
      }
      return 'completed'
    } catch (error) {
      logError(error)
      const message = errorMessage(error)
      logForDebugging(`[voice_transcription] transcription failed: ${message}`)
      this.callbacks.onError(`Voice transcription error: ${message}`)
      return 'failed'
    }
  }
}

async function transcribeOpenAICompatible(
  config: OpenAICompatibleSttProviderConfig,
  pcm: Buffer,
  options?: { language?: string; keyterms?: string[] },
): Promise<string> {
  const baseUrl = trimTrailingSlash(config.baseUrl ?? DEFAULT_OPENAI_BASE_URL)
  const url = `${baseUrl}/audio/transcriptions`
  const apiKey = resolveApiKey(config)
  const form = createMultipartAudioForm(pcm, config.model)
  const language = config.language ?? options?.language
  if (language) form.append('language', language)
  if (config.responseFormat) form.append('response_format', config.responseFormat)
  if (config.temperature !== undefined) {
    form.append('temperature', String(config.temperature))
  }

  const prompt = buildPrompt(config.prompt, options?.keyterms)
  if (prompt) form.append('prompt', prompt)

  appendExtraFields(form, config.extraParams)

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      body: form,
    },
    config.timeoutMs,
  )

  return parseTranscriptionResponse(response, 'text')
}

async function transcribeHttp(
  config: HttpSttProviderConfig,
  pcm: Buffer,
  options?: { language?: string; keyterms?: string[] },
): Promise<string> {
  const apiKey = resolveApiKey(config)
  const form = createMultipartAudioForm(
    pcm,
    config.model,
    config.fileField,
    config.modelField,
  )

  const language = config.language ?? options?.language
  if (language) form.append(config.languageField ?? 'language', language)
  appendExtraFields(form, config.extraFields)

  const headers: Record<string, string> = { ...(config.headers ?? {}) }
  if (apiKey) {
    headers[config.authHeader ?? 'Authorization'] =
      `${config.authPrefix ?? 'Bearer '}${apiKey}`
  }

  const response = await fetchWithTimeout(
    config.url,
    {
      method: config.method ?? 'POST',
      headers,
      body: form,
    },
    config.timeoutMs,
  )

  return parseTranscriptionResponse(response, config.responsePath ?? 'text')
}

function createMultipartAudioForm(
  pcm: Buffer,
  model?: string,
  fileField = 'file',
  modelField = 'model',
): FormData {
  const form = new FormData()
  const wav = pcm16MonoToWav(pcm)
  const blob = new Blob([new Uint8Array(wav) as unknown as BlobPart], {
    type: 'audio/wav',
  })
  form.append(fileField, blob, 'voice.wav')
  if (model) form.append(modelField, model)
  return form
}

function pcm16MonoToWav(pcm: Buffer): Buffer {
  const dataSize = pcm.length
  const header = Buffer.alloc(44)
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8)
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8)

  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(CHANNELS, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(BITS_PER_SAMPLE, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcm])
}

async function fetchWithTimeout(
  url: string,
  init: {
    method: string
    headers?: Record<string, string>
    body: FormData
  },
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `HTTP ${String(response.status)} ${response.statusText}${body ? `: ${body.slice(0, 500)}` : ''}`,
      )
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function parseTranscriptionResponse(
  response: Response,
  responsePath: string | string[],
): Promise<string> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return response.text()
  }

  const body = (await response.json()) as unknown
  const value = readPath(body, responsePath)
  if (typeof value === 'string') return value
  if (value === undefined || value === null) {
    throw new Error(
      `Transcription response did not contain ${formatPath(responsePath)}.`,
    )
  }
  return String(value)
}

function readPath(value: unknown, path: string | string[]): unknown {
  const parts = Array.isArray(path) ? path : path.split('.').filter(Boolean)
  let current = value
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function appendExtraFields(
  form: FormData,
  fields?: Record<string, unknown>,
): void {
  if (!fields) return
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    form.append(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
}

function buildPrompt(
  prompt: string | undefined,
  keyterms: string[] | undefined,
): string | undefined {
  const terms = keyterms?.filter(Boolean)
  if (!prompt && !terms?.length) return undefined
  if (!terms?.length) return prompt
  return [prompt, `Key terms: ${terms.join(', ')}`].filter(Boolean).join('\n')
}

function getConfiguredSttProvider(): VoiceSttProviderConfig | null {
  return getGlobalConfig().voice?.stt ?? null
}

function validateApiKey(config: VoiceSttProviderConfig): string | null {
  if (config.type !== 'openai') return null
  if (resolveApiKey(config)) return null
  return 'voice.stt.apiKey or voice.stt.apiKeyEnv is required for type "openai".'
}

function resolveApiKey(config: {
  apiKey?: string
  apiKeyEnv?: string
}): string | undefined {
  if (config.apiKey?.trim()) return config.apiKey.trim()
  if (config.apiKeyEnv?.trim()) {
    const value = process.env[config.apiKeyEnv.trim()]
    if (value?.trim()) return value.trim()
  }
  return undefined
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function formatPath(path: string | string[]): string {
  return Array.isArray(path) ? path.join('.') : path
}

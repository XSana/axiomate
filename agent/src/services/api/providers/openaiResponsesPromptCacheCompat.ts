import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getOriginalCwd, getSessionId } from '../../../bootstrap/state.js'
import type { ModelProviderConfig } from '../../../utils/config.js'
import { getConfigHomeDir } from '../../../utils/envUtils.js'
import {
  normalizePath,
  projectHash as checkpointProjectHash,
} from '../../../utils/checkpoints/paths.js'
import { safeParseJSON } from '../../../utils/json.js'
import { jsonStringify } from '../../../utils/slowOperations.js'

export const DEFAULT_PROMPT_CACHE_KEY_TEMPLATE =
  'a:{projectHash}:{providerHash}:{sessionHash}'

export const CODEX_TRANSPORT_USER_AGENT =
  'codex_exec/0.120.0 (Ubuntu 22.4.0; x86_64) gnome-terminal (codex_exec; 0.120.0)'

type PromptCacheState = {
  serverKey?: string
  unsupported?: boolean
  rewriteCount?: number
}

export type PromptCacheSelection = {
  clientKey: string
  selectedKey?: string
  stateId: string
}

type PromptCacheIdentity = {
  projectHash: string
  providerHash: string
  sessionId: string
  sessionHash: string
  clientKey: string
  stateId: string
}

type PromptCacheRecordInput = {
  selection: PromptCacheSelection | null
  response: unknown
}

export class OpenAIResponsesPromptCacheCompat {
  private stateById = new Map<string, PromptCacheState | null>()

  constructor(
    private readonly config: {
      baseUrl: string
      modelConfig?: ModelProviderConfig
    },
  ) {}

  selectPromptCacheKey(): PromptCacheSelection | null {
    const identity = this.resolveIdentity()
    if (!identity) return null
    const state = this.loadState(identity.stateId)
    if (state?.unsupported) {
      return {
        clientKey: identity.clientKey,
        stateId: identity.stateId,
      }
    }
    return {
      clientKey: identity.clientKey,
      selectedKey: normalizePromptCacheKey(state?.serverKey) ?? identity.clientKey,
      stateId: identity.stateId,
    }
  }

  buildHeaders(selection: PromptCacheSelection | null): Record<string, string> | undefined {
    const cfg = this.config.modelConfig
    if (cfg?.codexTransportCompat !== true) return undefined

    const headerToken = selection
      ? selection.selectedKey
      : getSessionId()
    if (!headerToken) return undefined

    const sessionId = getSessionId()
    const turnId = `${sessionId || 'axiomate'}_turn_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const metadata = {
      session_id: headerToken,
      turn_id: turnId,
      sandbox: 'none',
    }
    return {
      'User-Agent': cfg.userAgent || CODEX_TRANSPORT_USER_AGENT,
      originator: 'codex_exec',
      session_id: headerToken,
      'x-client-request-id': headerToken,
      'x-codex-window-id': `${headerToken}:0`,
      'x-codex-turn-metadata': jsonStringify(metadata),
    }
  }

  recordResponse(input: PromptCacheRecordInput): void {
    const selection = input.selection
    if (!selection?.selectedKey) return

    const returnedKey = normalizePromptCacheKey(extractPromptCacheKey(input.response))
    if (!returnedKey) return

    const state = this.loadState(selection.stateId) ?? {}
    const requestedKey = selection.selectedKey
    if (returnedKey === requestedKey) {
      state.serverKey = returnedKey
      state.unsupported = false
      state.rewriteCount = 0
      this.saveState(selection.stateId, state)
      return
    }

    const rewriteLimit = normalizeRewriteLimit(
      this.config.modelConfig?.promptCacheRewriteLimit,
    )
    const nextRewriteCount = (state.rewriteCount ?? 0) + 1
    state.rewriteCount = nextRewriteCount

    if (rewriteLimit > 0 && nextRewriteCount >= rewriteLimit) {
      state.unsupported = true
      this.saveState(selection.stateId, state)
      return
    }

    state.serverKey = returnedKey
    state.unsupported = false
    this.saveState(selection.stateId, state)
  }

  private resolveIdentity(): PromptCacheIdentity | null {
    const promptCacheKey = this.config.modelConfig?.promptCacheKey
    if (promptCacheKey !== true && typeof promptCacheKey !== 'string') {
      return null
    }

    const projectHash = checkpointProjectHash(normalizePath(getOriginalCwd()))
    const providerHash = hash16(normalizeBaseUrl(this.config.baseUrl))
    const sessionId = getSessionId()
    const sessionHash = hash16(sessionId)
    const template = promptCacheKey === true
      ? DEFAULT_PROMPT_CACHE_KEY_TEMPLATE
      : promptCacheKey
    const clientKey = normalizePromptCacheKey(
      template
        .replaceAll('{projectHash}', projectHash)
        .replaceAll('{providerHash}', providerHash)
        .replaceAll('{sessionHash}', sessionHash)
    )
    if (!clientKey) return null

    const stateId = hash16(
      [projectHash, providerHash, clientKey].join('\0'),
    )

    return {
      projectHash,
      providerHash,
      sessionId,
      sessionHash,
      clientKey,
      stateId,
    }
  }

  private loadState(stateId: string): PromptCacheState | null {
    if (this.stateById.has(stateId)) {
      return this.stateById.get(stateId) ?? null
    }
    const path = statePath(stateId)
    if (!existsSync(path)) {
      this.stateById.set(stateId, null)
      return null
    }
    try {
      const parsed = safeParseJSON(readFileSync(path, 'utf8'))
      if (!parsed || typeof parsed !== 'object') {
        this.stateById.set(stateId, null)
        return null
      }
      const raw = parsed as Record<string, unknown>
      const state: PromptCacheState = {
        ...(typeof raw.serverKey === 'string'
          ? { serverKey: raw.serverKey }
          : {}),
        ...(typeof raw.unsupported === 'boolean'
          ? { unsupported: raw.unsupported }
          : {}),
        ...(typeof raw.rewriteCount === 'number' && Number.isInteger(raw.rewriteCount)
          ? { rewriteCount: raw.rewriteCount }
          : {}),
      }
      this.stateById.set(stateId, state)
      return state
    } catch {
      this.stateById.set(stateId, null)
      return null
    }
  }

  private saveState(stateId: string, state: PromptCacheState): void {
    this.stateById.set(stateId, state)
    const path = statePath(stateId)
    try {
      mkdirSync(dirname(path), { recursive: true })
      const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(tmpPath, `${jsonStringify(state)}\n`, 'utf8')
      renameSync(tmpPath, path)
    } catch {
      // State persistence is a compatibility optimization, not request-critical.
    }
  }
}

function extractPromptCacheKey(response: unknown): unknown {
  if (!response || typeof response !== 'object') return undefined
  return (response as { prompt_cache_key?: unknown }).prompt_cache_key
}

function normalizePromptCacheKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeRewriteLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 3
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function hash16(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function statePath(stateId: string): string {
  return join(getConfigHomeDir(), 'prompt-cache-state', `${stateId}.json`)
}

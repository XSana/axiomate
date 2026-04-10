import type { BraveWebSearchProviderConfig } from '../../../utils/config.js'
import type { ToolCallProgress, ToolUseContext } from '../../../Tool.js'
import type { WebSearchProgress } from '../../../types/tools.js'
import {
  createProgressId,
  emitQueryUpdate,
  emitResultsReceived,
  SearchProviderError,
  type SearchProvider,
} from '../searchProvider.js'
import type { Output, WebSearchInput } from '../types.js'
import {
  buildSearchRuns,
  buildSummary,
  clampResultCount,
  filterHits,
  type SearchHitWithSnippet,
} from './providerUtils.js'

type BraveWebResult = {
  title?: string
  url?: string
  description?: string
  extra_snippets?: string[]
}

type BraveSearchError = {
  code?: string
  detail?: string
  message?: string
}

type BraveSearchResponse = {
  web?: {
    results?: BraveWebResult[]
  }
  error?: BraveSearchError
}

const DEFAULT_BASE_URL = 'https://api.search.brave.com/res/v1/web/search'
const DEFAULT_COUNT = 10
const MAX_COUNT = 20

export class BraveWebSearchProvider implements SearchProvider {
  readonly type = 'brave-web-search' as const
  readonly capabilities = {
    allowedDomains: 'adapter',
    blockedDomains: 'adapter',
    snippets: 'native',
  } as const

  constructor(
    readonly name: string,
    private readonly config: BraveWebSearchProviderConfig,
  ) {}

  async search(
    input: WebSearchInput,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<WebSearchProgress>,
  ): Promise<Output> {
    const startTime = performance.now()
    const runs = buildSearchRuns(input)
    const results: Output['results'] = []

    for (const run of runs) {
      const toolUseId = createProgressId('web-search', run.query)
      emitQueryUpdate(onProgress, toolUseId, run.query)

      const response = await this.fetchResults(run.query, context)
      const hits = filterHits(
        mapHits(response.web?.results ?? []),
        input.allowed_domains,
        input.blocked_domains,
      )

      emitResultsReceived(onProgress, toolUseId, run.query, hits.length)

      const summary = buildSummary(run.summaryLabel, hits)
      if (summary) {
        results.push(summary)
      }
      results.push({
        content: hits.map(({ title, url }) => ({ title, url })),
      })
    }

    return {
      query: input.query,
      results,
      durationSeconds: (performance.now() - startTime) / 1000,
    }
  }

  private async fetchResults(
    query: string,
    context: ToolUseContext,
  ): Promise<BraveSearchResponse> {
    const url = new URL(this.config.baseUrl ?? DEFAULT_BASE_URL)
    url.searchParams.set('q', query)
    url.searchParams.set(
      'count',
      String(clampResultCount(this.config.count, DEFAULT_COUNT, MAX_COUNT)),
    )

    if (this.config.country) {
      url.searchParams.set('country', this.config.country)
    }

    if (this.config.searchLang) {
      url.searchParams.set('search_lang', this.config.searchLang)
    }

    if (this.config.uiLang) {
      url.searchParams.set('ui_lang', this.config.uiLang)
    }

    if (this.config.safeSearch) {
      url.searchParams.set('safesearch', this.config.safeSearch)
    }

    if (this.config.extraSnippets) {
      url.searchParams.set('extra_snippets', 'true')
    }

    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': this.config.apiKey,
        },
        signal: context.abortController.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error
      }
      throw new SearchProviderError({
        providerName: this.name,
        code: 'network',
        message: `Search provider ${this.name} request failed.`,
        retryable: true,
        cause: error,
      })
    }

    let payload: BraveSearchResponse | null = null
    try {
      payload = (await response.json()) as BraveSearchResponse
    } catch (error) {
      if (!response.ok) {
        payload = null
      } else {
        throw new SearchProviderError({
          providerName: this.name,
          code: 'response',
          message: `Search provider ${this.name} returned an invalid JSON response.`,
          cause: error,
        })
      }
    }

    if (!response.ok) {
      throw new SearchProviderError({
        providerName: this.name,
        code: getErrorCodeForResponse(response.status, payload),
        message:
          getErrorMessage(payload) ||
          `Search provider ${this.name} returned HTTP ${response.status}`,
        retryable: isRetryableStatus(response.status),
        statusCode: response.status,
      })
    }

    if (!payload) {
      throw new SearchProviderError({
        providerName: this.name,
        code: 'response',
        message: `Search provider ${this.name} returned an empty response.`,
      })
    }

    if (payload.error) {
      throw new SearchProviderError({
        providerName: this.name,
        code: 'response',
        message:
          payload.error.detail ||
          payload.error.message ||
          `Search provider ${this.name} returned an unknown error.`,
      })
    }

    return payload
  }
}

function mapHits(items: BraveWebResult[]): SearchHitWithSnippet[] {
  return items
    .map(item => ({
      title: item.title?.trim() ?? '',
      url: item.url?.trim() ?? '',
      snippet: getSnippet(item),
    }))
    .filter(hit => hit.title.length > 0 && hit.url.length > 0)
}

function getSnippet(item: BraveWebResult): string | undefined {
  const extraSnippet = item.extra_snippets
    ?.map(snippet => snippet.trim())
    .find(snippet => snippet.length > 0)

  return extraSnippet || item.description?.trim()
}

function getErrorMessage(payload: BraveSearchResponse | null): string | undefined {
  if (!payload?.error) {
    return undefined
  }

  return payload.error.detail || payload.error.message
}

function getErrorCodeForResponse(
  status: number,
  payload: BraveSearchResponse | null,
) {
  const combined = `${payload?.error?.code ?? ''} ${payload?.error?.detail ?? ''} ${
    payload?.error?.message ?? ''
  }`.toLowerCase()

  if (status === 401 || status === 403) {
    return 'auth' as const
  }
  if (status === 429) {
    return 'rate_limit' as const
  }
  if (status >= 500) {
    return 'unavailable' as const
  }

  if (combined.includes('token') || combined.includes('auth')) {
    return 'auth' as const
  }
  if (combined.includes('rate') || combined.includes('quota')) {
    return 'rate_limit' as const
  }
  if (combined.includes('subscription') || combined.includes('plan')) {
    return 'config' as const
  }

  return 'invalid_request' as const
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

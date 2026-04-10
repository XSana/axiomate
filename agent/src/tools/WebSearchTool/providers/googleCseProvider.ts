import type { GoogleCustomSearchProviderConfig } from '../../../utils/config.js'
import type { ToolCallProgress, ToolUseContext } from '../../../Tool.js'
import type { WebSearchProgress } from '../../../types/tools.js'
import {
  createProgressId,
  emitQueryUpdate,
  emitResultsReceived,
  SearchProviderError,
  type SearchProvider,
} from '../searchProvider.js'
import type { Output, SearchHit, WebSearchInput } from '../types.js'

type GoogleSearchItem = {
  title?: string
  link?: string
  snippet?: string
}

type GoogleSearchResponse = {
  items?: GoogleSearchItem[]
  error?: {
    code?: number
    message?: string
    errors?: Array<{ message?: string }>
  }
}

type SearchRun = {
  query: string
  summaryLabel: string
}

type SearchHitWithSnippet = SearchHit & {
  snippet?: string
}

const DEFAULT_BASE_URL = 'https://customsearch.googleapis.com/customsearch/v1'
const DEFAULT_MAX_RESULTS = 10
const MAX_SUMMARY_RESULTS = 5
const MAX_SNIPPET_LENGTH = 280

export class GoogleCseSearchProvider implements SearchProvider {
  readonly type = 'google-cse' as const
  readonly capabilities = {
    allowedDomains: 'adapter',
    blockedDomains: 'adapter',
    snippets: 'native',
  } as const

  constructor(
    readonly name: string,
    private readonly config: GoogleCustomSearchProviderConfig,
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
        mapHits(response.items ?? []),
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
  ): Promise<GoogleSearchResponse> {
    const url = new URL(this.config.baseUrl ?? DEFAULT_BASE_URL)
    url.searchParams.set('key', this.config.apiKey)
    url.searchParams.set('cx', this.config.cx)
    url.searchParams.set('q', query)
    url.searchParams.set('num', String(clampMaxResults(this.config.maxResults)))

    let response: Response
    try {
      response = await fetch(url, {
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

    let payload: GoogleSearchResponse | null = null
    try {
      payload = (await response.json()) as GoogleSearchResponse
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
      const message =
        payload?.error?.message ||
        payload?.error?.errors?.find(err => err.message)?.message ||
        `Search provider ${this.name} returned HTTP ${response.status}`
      throw new SearchProviderError({
        providerName: this.name,
        code: getErrorCodeForStatus(response.status),
        message,
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
          payload.error.message ||
          `Search provider ${this.name} returned an unknown error.`,
      })
    }

    return payload
  }
}

function buildSearchRuns(input: WebSearchInput): SearchRun[] {
  const blockedDomains = normalizeDomains(input.blocked_domains)
  const allowedDomains = normalizeDomains(input.allowed_domains)

  if (allowedDomains.length > 0) {
    return allowedDomains.map(domain => {
      const query = buildProviderQuery(input.query, domain, blockedDomains)
      return {
        query,
        summaryLabel: query,
      }
    })
  }

  return [
    {
      query: buildProviderQuery(input.query, undefined, blockedDomains),
      summaryLabel: input.query,
    },
  ]
}

function buildProviderQuery(
  query: string,
  allowedDomain: string | undefined,
  blockedDomains: string[],
): string {
  const parts = [query.trim()]

  if (allowedDomain) {
    parts.push(`site:${allowedDomain}`)
  }

  for (const blockedDomain of blockedDomains) {
    parts.push(`-site:${blockedDomain}`)
  }

  return parts.join(' ').trim()
}

function mapHits(items: GoogleSearchItem[]): SearchHitWithSnippet[] {
  return items
    .map(item => ({
      title: item.title?.trim() ?? '',
      url: item.link?.trim() ?? '',
      snippet: item.snippet?.trim(),
    }))
    .filter(hit => hit.title.length > 0 && hit.url.length > 0)
}

function filterHits(
  hits: SearchHitWithSnippet[],
  allowedDomains?: string[],
  blockedDomains?: string[],
): SearchHitWithSnippet[] {
  const allowed = normalizeDomains(allowedDomains)
  const blocked = normalizeDomains(blockedDomains)

  return hits.filter(hit => {
    const hostname = extractHostname(hit.url)
    if (!hostname) {
      return false
    }

    if (allowed.length > 0 && !allowed.some(domain => hostMatches(hostname, domain))) {
      return false
    }

    if (blocked.some(domain => hostMatches(hostname, domain))) {
      return false
    }

    return true
  })
}

function buildSummary(label: string, hits: SearchHitWithSnippet[]): string {
  if (hits.length === 0) {
    return `No results found for "${label}".`
  }

  const summaryLines = hits
    .slice(0, MAX_SUMMARY_RESULTS)
    .map((hit, index) => {
      const snippet = truncateSnippet(hit.snippet ?? 'No snippet available.')
      return `${index + 1}. ${hit.title}: ${snippet}`
    })

  return `Search snippets for "${label}":\n${summaryLines.join('\n')}`
}

function clampMaxResults(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS
  }

  return Math.max(1, Math.min(10, Math.trunc(value)))
}

function truncateSnippet(snippet: string): string {
  const collapsed = snippet.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= MAX_SNIPPET_LENGTH) {
    return collapsed
  }
  return collapsed.slice(0, MAX_SNIPPET_LENGTH - 3).trimEnd() + '...'
}

function normalizeDomains(domains?: string[]): string[] {
  return (domains ?? [])
    .map(normalizeDomain)
    .filter((domain, index, all) => domain.length > 0 && all.indexOf(domain) === index)
}

function normalizeDomain(domain: string): string {
  const value = domain.trim().toLowerCase()
  if (!value) {
    return ''
  }

  try {
    const normalizedUrl = value.includes('://') ? value : `https://${value}`
    return new URL(normalizedUrl).hostname.toLowerCase()
  } catch {
    return value
      .replace(/^[a-z]+:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
      .trim()
  }
}

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function getErrorCodeForStatus(status: number) {
  if (status === 401 || status === 403) {
    return 'auth' as const
  }
  if (status === 429) {
    return 'rate_limit' as const
  }
  if (status >= 500) {
    return 'unavailable' as const
  }
  return 'invalid_request' as const
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

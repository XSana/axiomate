export type WebSearchInput = {
  query: string
  allowed_domains?: string[]
  blocked_domains?: string[]
}

export type SearchHit = {
  title: string
  url: string
}

export type SearchResult = {
  content: SearchHit[]
}

export type Output = {
  query: string
  results: Array<SearchResult | string>
  durationSeconds: number
}

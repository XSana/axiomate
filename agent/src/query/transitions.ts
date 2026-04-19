// Query loop transition types. Consumed only by query.ts.

/** Signals that the query loop should terminate. */
export type Terminal = {
  readonly reason: string
  [key: string]: unknown
}

/** Signals that the query loop should continue with another iteration. */
export type Continue = {
  readonly reason: string
  [key: string]: unknown
}

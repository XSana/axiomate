/**
 * Runtime gate for /ultrareview. Previously backed by GrowthBook config;
 * now always disabled (config inlined as null).
 */
export function isUltrareviewEnabled(): boolean {
  const cfg: Record<string, unknown> | null = null
  return cfg?.enabled === true
}

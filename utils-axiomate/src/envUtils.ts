export function isEnvTruthy(envVar: string | boolean | undefined): boolean {
  if (!envVar) return false
  if (typeof envVar === 'boolean') return envVar
  const normalizedValue = envVar.toLowerCase().trim()
  return ['1', 'true', 'yes', 'on'].includes(normalizedValue)
}

export function isEnvDefinedFalsy(envVar: string | boolean | undefined): boolean {
  if (envVar === undefined) return false
  if (typeof envVar === 'boolean') return !envVar
  if (!envVar) return false
  const normalizedValue = envVar.toLowerCase().trim()
  return ['0', 'false', 'no', 'off'].includes(normalizedValue)
}

export function hasNodeOption(flag: string): boolean {
  const nodeOptions = process.env.NODE_OPTIONS
  if (!nodeOptions) return false
  return nodeOptions.split(/\s+/).includes(flag)
}

export function parseEnvVars(rawEnvArgs: string[] | undefined): Record<string, string> {
  const parsedEnv: Record<string, string> = {}
  if (rawEnvArgs) {
    for (const envStr of rawEnvArgs) {
      const [key, ...valueParts] = envStr.split('=')
      if (!key || valueParts.length === 0) {
        throw new Error(
          `Invalid environment variable format: ${envStr}, environment variables should be added as: -e KEY1=value1 -e KEY2=value2`,
        )
      }
      parsedEnv[key] = valueParts.join('=')
    }
  }
  return parsedEnv
}

// TODO: getClaudeConfigHomeDir — requires config dir convention for axiomate
// TODO: isBareMode — application-level concept, implement when agent needs it

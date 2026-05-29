/**
 * Load integration test credentials from local.json.
 *
 * Integration tests MUST use this loader instead of getGlobalConfig().
 * Reasons:
 *   1. Isolation — don't read from user's real ~/.axiomate.json
 *   2. Safety — don't accidentally spend money on user's production account
 *      if a test has a bug that makes lots of calls
 *   3. Reproducibility — every developer has the same set of test models
 *      declared in testModels.ts, each supplies their own keys in
 *      local.json (gitignored)
 *
 * If local.json is missing, emits a clear setup error.
 */
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import type {
  AuxiliaryTaskConfig,
  GlobalConfig,
  MainModelRoutingConfig,
  ModelProviderConfig,
} from '../../../utils/config.js'
import { normalizeModelRoutingConfig } from '../../../utils/model/modelRouting.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ENV_LOCAL_PATH = join(__dirname, 'local.json')
const ENV_EXAMPLE_PATH = join(__dirname, 'example.json')

export type IntegrationModelConfig = {
  protocol: 'openai-chat' | 'openai-responses' | 'anthropic'
  baseUrl: string
  apiKey: string
  model?: string
  vendor?: ModelProviderConfig['vendor']
  contextWindow?: number
  maxOutputTokens?: number
  supportsImages?: boolean
  thinking?: ModelProviderConfig['thinking']
  repairToolCalls?: boolean
  extraParams?: Record<string, unknown>
  usageMapping?: ModelProviderConfig['usageMapping']
  userAgent?: string
}

export type IntegrationEnv = {
  models: Record<string, IntegrationModelConfig>
  model?: MainModelRoutingConfig
  auxiliary?: Record<string, AuxiliaryTaskConfig>
}

let cached: IntegrationEnv | null = null

export function loadIntegrationEnv(): IntegrationEnv {
  if (cached) return cached
  if (!existsSync(ENV_LOCAL_PATH)) {
    throw new Error(
      `Integration test env file missing: ${ENV_LOCAL_PATH}\n\n` +
        `To set up:\n` +
        `  1. cp ${ENV_EXAMPLE_PATH} ${ENV_LOCAL_PATH}\n` +
        `  2. Fill in real API keys in local.json\n` +
        `  3. local.json is already gitignored — safe from accidental commits\n\n` +
        `This file is separate from ~/.axiomate.json by design. Integration tests ` +
        `use their own credentials so they never affect your real config.`,
    )
  }
  const raw = readFileSync(ENV_LOCAL_PATH, 'utf-8')
  const parsed = JSON.parse(raw) as IntegrationEnv
  if (!parsed.models || typeof parsed.models !== 'object') {
    throw new Error(
      `local.json is malformed: expected a top-level "models" object. ` +
        `See example.json for the correct format.`,
    )
  }
  cached = parsed
  return parsed
}

/**
 * Look up the config for a model by name (as declared in testModels.ts).
 * Throws a clear setup error if the model isn't in local.json.
 */
export function getIntegrationModelConfig(
  modelName: string,
): IntegrationModelConfig {
  const env = loadIntegrationEnv()
  const config = env.models[modelName]
  if (!config) {
    throw new Error(
      `Integration test model "${modelName}" is not configured in local.json.\n\n` +
        `Add it to the "models" section:\n` +
        `  {\n` +
        `    "models": {\n` +
        `      "${modelName}": {\n` +
        `        "protocol": "openai-chat",\n` +
        `        "baseUrl": "...",\n` +
        `        "apiKey": "sk-..."\n` +
        `      }\n` +
        `    }\n` +
        `  }`,
    )
  }
  if (
    !config.apiKey ||
    config.apiKey.startsWith('sk-YOUR-') ||
    config.apiKey === 'sk-PLACEHOLDER'
  ) {
    throw new Error(
      `Integration test model "${modelName}" has a placeholder apiKey. ` +
        `Replace it with a real key in local.json.`,
    )
  }
  return config
}

export function buildIntegrationModelRoutingConfig(
  modelName: string,
  modelCfg: IntegrationModelConfig,
): Pick<GlobalConfig, 'models' | 'model' | 'auxiliary'> {
  return normalizeModelRoutingConfig({
    models: {
      [modelName]: {
        ...toModelProviderConfig(modelName, modelCfg),
      },
    },
    model: {
      defaultRoute: 'default',
      routes: {
        default: {
          primary: modelName,
          fallbackChain: [],
        },
      },
    },
  } as unknown as GlobalConfig)
}

export function toModelProviderConfig(
  modelName: string,
  modelCfg: IntegrationModelConfig,
): ModelProviderConfig {
  const {
    protocol,
    baseUrl,
    apiKey,
    model = modelName,
    vendor,
    contextWindow,
    maxOutputTokens,
    supportsImages,
    thinking,
    repairToolCalls,
    extraParams,
    usageMapping,
    userAgent,
  } = modelCfg

  return {
    model,
    protocol,
    baseUrl,
    apiKey,
    ...(vendor !== undefined ? { vendor } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(supportsImages !== undefined ? { supportsImages } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(repairToolCalls !== undefined ? { repairToolCalls } : {}),
    ...(extraParams !== undefined ? { extraParams } : {}),
    ...(usageMapping !== undefined ? { usageMapping } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
  }
}

import {
  getGlobalConfig,
  type SearchProviderConfig,
} from '../../utils/config.js'
import {
  SearchProviderError,
  type SearchProvider,
  type SearchProviderFactory,
} from './searchProvider.js'
import { GoogleCseSearchProvider } from './providers/googleCseProvider.js'

type SearchProviderResolution = {
  providerName: string
  providerConfig: SearchProviderConfig
  provider: SearchProvider
}

const SEARCH_PROVIDER_FACTORIES = {
  'google-cse': {
    type: 'google-cse',
    create: (providerName, config) =>
      new GoogleCseSearchProvider(providerName, config),
  },
} satisfies Record<SearchProviderConfig['type'], SearchProviderFactory>

export function getSearchProviderForModel(model: string): SearchProvider {
  return resolveSearchProviderForModel(model).provider
}

export function resolveSearchProviderForModel(
  model: string,
): SearchProviderResolution {
  const config = getGlobalConfig()
  const modelConfig = config.models?.[model]

  if (!modelConfig) {
    throw new SearchProviderError({
      providerName: 'unconfigured',
      code: 'config',
      message: `Model '${model}' is not configured in ~/.axiomate.json and cannot use WebSearch.`,
    })
  }

  if (!modelConfig.searchProvider) {
    throw new SearchProviderError({
      providerName: 'unconfigured',
      code: 'config',
      message: `Model '${model}' does not define a searchProvider in ~/.axiomate.json.`,
    })
  }

  const providerConfig = config.searchProviders?.[modelConfig.searchProvider]
  if (!providerConfig) {
    throw new SearchProviderError({
      providerName: modelConfig.searchProvider,
      code: 'config',
      message: `Search provider '${modelConfig.searchProvider}' was not found in ~/.axiomate.json searchProviders.`,
    })
  }

  return {
    providerName: modelConfig.searchProvider,
    providerConfig,
    provider: createSearchProvider(modelConfig.searchProvider, providerConfig),
  }
}

export function hasSearchProviderForModel(model: string): boolean {
  try {
    resolveSearchProviderForModel(model)
    return true
  } catch {
    return false
  }
}

function createSearchProvider(
  providerName: string,
  config: SearchProviderConfig,
): SearchProvider {
  const factory = SEARCH_PROVIDER_FACTORIES[config.type]
  if (!factory) {
    throw new SearchProviderError({
      providerName,
      code: 'config',
      message: `Unsupported search provider type '${(config as { type: string }).type}' for '${providerName}'.`,
    })
  }
  return (factory as SearchProviderFactory).create(providerName, config)
}

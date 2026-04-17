export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

export function getAPIProvider(): APIProvider {
  return 'firstParty'
}

export function getAPIProviderForanalytics(): APIProvider {
  return getAPIProvider()
}

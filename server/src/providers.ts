import { env } from './env.js';

export type OptionalProvider = 'orgo' | 'xai' | 'composio';

const settings = {
  orgo: { key: () => env.orgoKey, variable: 'ORGO_API_KEY' },
  xai: { key: () => env.xaiKey, variable: 'XAI_API_KEY' },
  composio: { key: () => env.composioKey, variable: 'COMPOSIO_API_KEY' },
};

export class ProviderUnavailableError extends Error {
  constructor(public readonly provider: OptionalProvider, public readonly setting = settings[provider].variable) {
    const source = setting.endsWith('_API_KEY') ? `${setting} or its _FILE setting` : setting;
    super(`${provider} is not configured. Set ${source} to enable it.`);
    this.name = 'ProviderUnavailableError';
  }
}

export function isProviderConfigured(provider: OptionalProvider): boolean {
  return Boolean(settings[provider].key().trim());
}

export function requireProvider(provider: OptionalProvider): void {
  if (!isProviderConfigured(provider)) throw new ProviderUnavailableError(provider);
}

export function requireOrgoComputer(): string {
  const computerId = env.orgoComputerId.trim();
  if (!computerId) throw new ProviderUnavailableError('orgo', 'ORGO_COMPUTER_ID');
  requireProvider('orgo');
  return computerId;
}

/** Configuration only: credentials do not prove provider health or authorization. */
export function providerConfiguration() {
  return Object.fromEntries(Object.entries(settings).map(([id, setting]) => [id, {
    status: setting.key().trim() ? 'configured_unverified' : 'unconfigured',
  }]));
}

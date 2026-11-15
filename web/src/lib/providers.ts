export type OptionalProvider = 'orgo' | 'xai' | 'composio';
export type ProviderConfiguration = Record<OptionalProvider, { status: 'unconfigured' | 'configured_unverified' }>;

export const providerRecovery = {
  xai: 'Voice and dictation are unavailable. Ask your operator to configure the xAI provider, then refresh this page.',
  composio: 'App connections are unavailable. Ask your operator to configure Composio, then refresh this page.',
  orgo: 'The computer provider is unavailable. Ask your operator to configure Orgo, then refresh this page.',
};

/** Configured only enables a request; the server still verifies credentials and authorization. */
export const isProviderConfigured = (providers: ProviderConfiguration | null, id: OptionalProvider) => providers?.[id]?.status === 'configured_unverified';

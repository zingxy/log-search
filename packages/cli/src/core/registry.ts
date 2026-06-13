import type { Provider } from '@log-search/provider-types';

export class ProviderRegistry {
  private providers = new Map<string, Provider>();

  register(provider: Provider): void {
    if (this.providers.has(provider.type)) {
      throw new Error(`Provider type "${provider.type}" is already registered`);
    }
    this.providers.set(provider.type, provider);
  }

  get(type: string): Provider | undefined {
    return this.providers.get(type);
  }

  list(): Provider[] {
    return [...this.providers.values()];
  }

  availableTypes(): string[] {
    return [...this.providers.keys()];
  }
}

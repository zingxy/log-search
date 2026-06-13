import type { Command } from 'commander';
import type { ProviderRegistry } from '../core/registry.js';

export function registerProvidersCommand(program: Command, registry: ProviderRegistry): void {
  program
    .command('providers')
    .description('List available providers')
    .action(() => {
      const providers = registry.list();
      console.log('TYPE  DESCRIPTION');
      for (const provider of providers) {
        console.log(`${provider.type.padEnd(5)} ${provider.description}`);
      }
    });
}

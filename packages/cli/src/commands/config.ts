import type { Command } from 'commander';
import type { ProviderRegistry } from '../core/registry.js';
import { loadConfig } from '../config/loader.js';
import { validateConfig, formatValidationErrors } from '../config/validator.js';

export function registerConfigCommand(program: Command, registry: ProviderRegistry): void {
  const configCmd = program.command('config').description('Configuration management');

  configCmd
    .command('validate')
    .description('Validate configuration file')
    .action(async (_options, command) => {
      const configDir = command.optsWithGlobals().config as string | undefined;
      const config = await loadConfig(configDir);
      const result = validateConfig(config, new Set(registry.availableTypes()));

      console.log(`Providers: ${config.providers.length}`);
      console.log(`Profiles: ${config.profiles.length}`);

      if (!result.valid) {
        console.error('Validation failed:');
        console.error(formatValidationErrors(result.errors));
        process.exitCode = 2;
        return;
      }

      console.log('Configuration is valid.');
    });
}

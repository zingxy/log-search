#!/usr/bin/env node
import { Command } from 'commander';
import { ProviderRegistry } from './core/registry.js';
import { registerBuiltins } from './providers/builtins.js';
import { registerQueryCommand } from './commands/query.js';
import { registerTailCommand } from './commands/tail.js';
import { registerProfilesCommand } from './commands/profiles.js';
import { registerProvidersCommand } from './commands/providers.js';
import { registerConfigCommand } from './commands/config.js';
import { registerInitCommand } from './commands/init.js';

async function main(): Promise<void> {
  const registry = new ProviderRegistry();
  registerBuiltins(registry.register.bind(registry));

  // Load external plugins from config.
  const { loadConfig } = await import('./config/loader.js');
  try {
    const config = await loadConfig();
    for (const pluginName of config.plugins) {
      try {
        const mod = await import(pluginName);
        const provider = mod.default ?? mod;
        if (provider && typeof provider === 'object') {
          registry.register(provider);
        }
      } catch (err) {
        console.error(`Failed to load plugin "${pluginName}": ${(err as Error).message}`);
      }
    }
  } catch (err) {
    // Config file may not exist yet; plugins will be empty.
    if ((err as Error).name !== 'ConfigNotFoundError') {
      console.error((err as Error).message);
    }
  }

  const program = new Command();
  program
    .name('log-search')
    .description('Unified log query CLI for humans and AI agents')
    .version('0.1.0')
    .option('--config <path>', 'configuration directory');

  registerQueryCommand(program, registry);
  registerTailCommand(program, registry);
  registerProfilesCommand(program);
  registerProvidersCommand(program, registry);
  registerConfigCommand(program, registry);
  registerInitCommand(program);

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

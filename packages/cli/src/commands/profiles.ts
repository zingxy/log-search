import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';

export function registerProfilesCommand(program: Command): void {
  program
    .command('profiles')
    .description('List configured profiles')
    .action(async (_options, command) => {
      const configDir = command.optsWithGlobals().config as string | undefined;
      const config = await loadConfig(configDir);

      console.log('NAME       PROVIDERS');
      for (const profile of config.profiles) {
        const providers = profile.providers.join(', ');
        console.log(`${profile.name.padEnd(10)} ${providers}`);
      }
    });
}

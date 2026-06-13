import type { Command } from 'commander';
import { initConfigDir } from '../config/loader.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize configuration directory')
    .action(async (_options, command) => {
      const configDir = command.optsWithGlobals().config as string | undefined;
      const filePath = await initConfigDir(configDir);
      console.log(`Created config template: ${filePath}`);
    });
}

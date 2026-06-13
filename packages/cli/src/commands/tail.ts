import type { Command } from 'commander';
import type { ProviderRegistry } from '../core/registry.js';
import { loadConfig } from '../config/loader.js';
import { runTail } from '../core/runner.js';
import { formatEntry } from '../core/formatter.js';

export function registerTailCommand(program: Command, registry: ProviderRegistry): void {
  program
    .command('tail')
    .description('Tail logs in real time')
    .requiredOption('-p, --profile <name>', 'profile name')
    .option('-s, --since <time>', 'start time (e.g. 5m)')
    .option('-k, --keyword <word>', 'keyword filter')
    .option('--format <format>', 'output format: text or json', 'text')
    .action(async (options, command) => {
      const configDir = command.optsWithGlobals().config as string | undefined;
      const config = await loadConfig(configDir);

      const profileName: string = options.profile;
      const stream = runTail(config, registry, {
        profileName,
        keyword: options.keyword,
        since: options.since,
      });

      const providerCount = config.profiles.find((p) => p.name === profileName)?.providers.length ?? 1;
      const formatOptions = {
        format: options.format as 'text' | 'json',
        multiSource: providerCount > 1,
      };

      let hasError = false;

      try {
        for await (const item of stream) {
          if (item.type === 'error') {
            hasError = true;
            console.error(item.error.message);
            continue;
          }
          console.log(formatEntry(item.entry, formatOptions));
        }
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 4;
        return;
      }

      if (hasError) {
        process.exitCode = 4;
      }
    });
}

import type { Command } from 'commander';
import type { ProviderRegistry } from '../core/registry.js';
import { loadConfig } from '../config/loader.js';
import { runQuery } from '../core/runner.js';
import { formatEntry } from '../core/formatter.js';

export function registerQueryCommand(program: Command, registry: ProviderRegistry): void {
  program
    .command('query')
    .description('Query historical logs')
    .requiredOption('-p, --profile <name>', 'profile name')
    .option('-s, --since <time>', 'start time (e.g. 1h, 2024-06-01T00:00:00)')
    .option('-u, --until <time>', 'end time (e.g. 30m, 2024-06-01T01:00:00)')
    .option('-k, --keyword <word>', 'keyword filter')
    .option('-n, --limit <number>', 'maximum number of entries', parseInt)
    .option('--format <format>', 'output format: text or json', 'text')
    .option('--raw-query <query>', 'provider-native query string')
    .action(async (options, command) => {
      const configDir = command.optsWithGlobals().config as string | undefined;
      const config = await loadConfig(configDir);

      const profileName: string = options.profile;
      const stream = runQuery(config, registry, {
        profileName,
        keyword: options.keyword,
        since: options.since,
        until: options.until,
        limit: options.limit,
        rawQuery: options.rawQuery,
      });

      const providerCount = config.profiles.find((p) => p.name === profileName)?.providers.length ?? 1;
      const formatOptions = {
        format: options.format as 'text' | 'json',
        multiSource: providerCount > 1,
      };

      let hasError = false;

      for await (const item of stream) {
        if (item.type === 'error') {
          hasError = true;
          console.error(item.error.message);
          continue;
        }
        console.log(formatEntry(item.entry, formatOptions));
      }

      if (hasError) {
        process.exitCode = 4;
      }
    });
}

import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import type { ProviderRegistry } from '../core/registry.js';
import {
  loadConfig,
  resolveConfigDir,
  normalizeProviders,
  normalizeProfiles,
  type RawConfig,
  type LoadedConfig,
} from '../config/loader.js';
import { validateConfig, formatValidationErrors } from '../config/validator.js';
import schema from '../config/config.schema.json' with { type: 'json' };

const ajv = new (Ajv as unknown as new (opts: { allErrors: boolean }) => {
  compile: <T = unknown>(schema: unknown) => {
    (data: T): boolean;
    errors?: ErrorObject[] | null;
  };
})({ allErrors: true });
const validateSchema = ajv.compile(schema);

function formatAjvErrors(errors: ErrorObject[]): string {
  return errors
    .map((e) => {
      const path = e.instancePath || '(root)';
      return `  - ${path}: ${e.message}`;
    })
    .join('\n');
}

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

  configCmd
    .command('lint')
    .description('Lint configuration file against schema and runtime rules')
    .action(async (_options, command) => {
      const configDir = command.optsWithGlobals().config as string | undefined;
      const dir = resolveConfigDir(configDir);
      const filePath = join(dir, 'config.yaml');

      if (!existsSync(filePath)) {
        console.error(`Configuration file not found: ${filePath}`);
        process.exitCode = 1;
        return;
      }

      const content = await readFile(filePath, 'utf-8');
      let raw: unknown;
      try {
        raw = yaml.load(content);
      } catch (err) {
        console.error(`Failed to parse ${filePath}:`);
        console.error(`  - ${(err as Error).message}`);
        process.exitCode = 2;
        return;
      }

      const rawConfig = (raw ?? {}) as RawConfig;
      const messages: string[] = [];

      if (!validateSchema(rawConfig)) {
        messages.push(formatAjvErrors(validateSchema.errors!));
      }

      try {
        const loaded: LoadedConfig = {
          providers: normalizeProviders(rawConfig.providers),
          profiles: normalizeProfiles(rawConfig.profiles),
          plugins: Array.isArray(rawConfig.plugins) ? rawConfig.plugins : [],
        };
        const runtime = validateConfig(loaded, new Set(registry.availableTypes()));
        if (!runtime.valid) {
          messages.push(formatValidationErrors(runtime.errors));
        }
      } catch (err) {
        messages.push(`  - ${(err as Error).message}`);
      }

      if (messages.length > 0) {
        console.error(`Lint failed for ${filePath}:`);
        console.error(messages.join('\n'));
        process.exitCode = 2;
        return;
      }

      console.log(`Configuration is valid: ${filePath}`);
    });
}

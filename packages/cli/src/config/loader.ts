import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';

export interface RawProviderConfig {
  type: string;
  description?: string;
  [key: string]: unknown;
}

export interface RawProfileConfig {
  provider?: string;
  providers?: string | string[];
  defaults?: Record<string, unknown>;
}

export interface RawConfig {
  providers?: Record<string, RawProviderConfig>;
  profiles?: Record<string, RawProfileConfig>;
  plugins?: string[];
}

export interface ProviderEntry {
  name: string;
  type: string;
  description?: string;
  config: unknown;
}

export interface ProfileEntry {
  name: string;
  providers: string[];
  defaults: Record<string, unknown>;
}

export interface LoadedConfig {
  providers: ProviderEntry[];
  profiles: ProfileEntry[];
  plugins: string[];
}

export function getDefaultConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  if (xdgConfigHome) {
    return resolve(xdgConfigHome, 'log-search');
  }
  return resolve(homedir(), '.config', 'log-search');
}

export function resolveConfigDir(input?: string): string {
  if (input) {
    return resolve(input);
  }
  return getDefaultConfigDir();
}

export function normalizeProviders(raw: RawConfig['providers']): ProviderEntry[] {
  const result: ProviderEntry[] = [];
  if (!raw) return result;
  for (const [name, config] of Object.entries(raw)) {
    if (!config || typeof config !== 'object') {
      throw new Error(`Provider "${name}" config must be an object`);
    }
    if (typeof config.type !== 'string') {
      throw new Error(`Provider "${name}" is missing required field "type"`);
    }
    result.push({
      name,
      type: config.type,
      description: typeof config.description === 'string' ? config.description : undefined,
      config,
    });
  }
  return result;
}

export function normalizeProfiles(raw: RawConfig['profiles']): ProfileEntry[] {
  const result: ProfileEntry[] = [];
  if (!raw) return result;
  for (const [name, config] of Object.entries(raw)) {
    if (!config || typeof config !== 'object') {
      throw new Error(`Profile "${name}" config must be an object`);
    }
    let providers: string[] = [];
    if (config.provider) {
      providers = [config.provider];
    } else if (config.providers) {
      providers = Array.isArray(config.providers) ? config.providers : [config.providers];
    }
    result.push({
      name,
      providers,
      defaults: config.defaults ?? {},
    });
  }
  return result;
}

export async function loadConfig(configDir?: string): Promise<LoadedConfig> {
  const dir = resolveConfigDir(configDir);
  const filePath = join(dir, 'config.yaml');

  if (!existsSync(filePath)) {
    throw new ConfigNotFoundError(filePath);
  }

  const content = await readFile(filePath, 'utf-8');
  let raw: unknown;
  try {
    raw = yaml.load(content);
  } catch (err) {
    throw new Error(`Failed to parse config file ${filePath}: ${(err as Error).message}`);
  }

  if (raw === null) {
    return { providers: [], profiles: [], plugins: [] };
  }

  if (typeof raw !== 'object') {
    throw new Error(`Config file ${filePath} must contain a YAML object`);
  }

  const rawConfig = raw as RawConfig;
  return {
    providers: normalizeProviders(rawConfig.providers),
    profiles: normalizeProfiles(rawConfig.profiles),
    plugins: Array.isArray(rawConfig.plugins) ? rawConfig.plugins : [],
  };
}

export async function initConfigDir(configDir?: string): Promise<string> {
  const dir = resolveConfigDir(configDir);
  const filePath = join(dir, 'config.yaml');

  if (existsSync(filePath)) {
    return filePath;
  }

  await mkdir(dir, { recursive: true });
  const template = `providers: {}
profiles: {}
plugins: []
`;
  await writeFile(filePath, template, 'utf-8');
  return filePath;
}

export class ConfigNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Config file not found: ${path}\nRun \`log-search init\` to create one.`);
    this.name = 'ConfigNotFoundError';
  }
}

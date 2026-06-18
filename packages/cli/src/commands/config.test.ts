import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Command } from 'commander';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderRegistry } from '../core/registry.js';
import { registerBuiltins } from '../providers/builtins.js';
import { registerConfigCommand } from './config.js';

function createProgram(registry: ProviderRegistry): Command {
  const program = new Command();
  program.option('--config <path>', 'configuration directory');
  registerConfigCommand(program, registry);
  return program;
}

async function setupConfig(content: string): Promise<string> {
  const dir = join(tmpdir(), `log-search-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'config.yaml'), content, 'utf-8');
  return dir;
}

describe('config lint', () => {
  let consoleErrorSpy: MockInstance;
  let consoleLogSpy: MockInstance;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('reports valid configuration', async () => {
    const dir = await setupConfig(`providers:
  helix:
    type: docker
    container: app
profiles:
  dev:
    providers:
      - helix
plugins: []
`);
    const registry = new ProviderRegistry();
    registerBuiltins(registry.register.bind(registry));
    const program = createProgram(registry);

    await program.parseAsync(['node', 'log-search', '--config', dir, 'config', 'lint']);

    expect(process.exitCode).toBeUndefined();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration is valid'));

    await rm(dir, { recursive: true, force: true });
  });

  it('reports schema errors', async () => {
    const dir = await setupConfig(`providers:
  bad:
    type: docker
profiles: {}
plugins: []
`);
    const registry = new ProviderRegistry();
    registerBuiltins(registry.register.bind(registry));
    const program = createProgram(registry);

    await program.parseAsync(['node', 'log-search', '--config', dir, 'config', 'lint']);

    expect(process.exitCode).toBe(2);
    const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(output).toContain("must have required property 'container'");

    await rm(dir, { recursive: true, force: true });
  });

  it('reports runtime reference errors', async () => {
    const dir = await setupConfig(`providers:
  helix:
    type: docker
    container: app
profiles:
  dev:
    providers:
      - missing
plugins: []
`);
    const registry = new ProviderRegistry();
    registerBuiltins(registry.register.bind(registry));
    const program = createProgram(registry);

    await program.parseAsync(['node', 'log-search', '--config', dir, 'config', 'lint']);

    expect(process.exitCode).toBe(2);
    const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(output).toContain('Profile "dev" references unknown provider "missing"');

    await rm(dir, { recursive: true, force: true });
  });

  it('reports missing config file', async () => {
    const dir = join(tmpdir(), `log-search-config-test-missing-${Date.now()}`);
    const registry = new ProviderRegistry();
    registerBuiltins(registry.register.bind(registry));
    const program = createProgram(registry);

    await program.parseAsync(['node', 'log-search', '--config', dir, 'config', 'lint']);

    expect(process.exitCode).toBe(1);
    const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(output).toContain('Configuration file not found');
  });

  it('reports yaml parse errors', async () => {
    const dir = await setupConfig('providers: [not valid yaml');
    const registry = new ProviderRegistry();
    registerBuiltins(registry.register.bind(registry));
    const program = createProgram(registry);

    await program.parseAsync(['node', 'log-search', '--config', dir, 'config', 'lint']);

    expect(process.exitCode).toBe(2);
    const output = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(output).toContain('Failed to parse');

    await rm(dir, { recursive: true, force: true });
  });
});

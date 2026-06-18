import { describe, it, expect } from 'vitest';
import { normalizeProviders, normalizeProfiles, resolveConfigDir, ConfigNotFoundError } from './loader.js';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('normalizeProviders', () => {
  it('normalizes provider map', () => {
    const result = normalizeProviders({
      sls: { type: 'sls', region: 'cn-hangzhou', project: 'p', logstore: 'l' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('sls');
    expect(result[0].type).toBe('sls');
  });

  it('throws on missing type', () => {
    expect(() => normalizeProviders({ bad: {} as never })).toThrow('type');
  });
});

describe('normalizeProfiles', () => {
  it('normalizes providers array', () => {
    const result = normalizeProfiles({
      multi: { providers: ['a', 'b'] },
    });
    expect(result[0].providers).toEqual(['a', 'b']);
  });

  it('rejects unsupported singular provider field', () => {
    expect(() =>
      normalizeProfiles({
        web: { provider: 'ssh-web' } as never,
      })
    ).toThrow('Use "providers" array instead');
  });
});

describe('loadConfig', () => {
  it('throws ConfigNotFoundError when config does not exist', async () => {
    await expect(import('./loader.js').then((m) => m.loadConfig('/nonexistent-dir-12345'))).rejects.toBeInstanceOf(
      ConfigNotFoundError
    );
  });
});

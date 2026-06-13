import { describe, it, expect, vi } from 'vitest';
import { validate, sshProvider } from './index.js';
import type { QueryOptions, TailOptions } from '@log-search/provider-types';

const baseProfile = {
  name: 'test',
  providers: ['ssh-test'],
  defaults: { path: '/var/log/app.log' },
};

describe('validate', () => {
  it('accepts valid config', () => {
    const config = validate({ host: 'example.com', user: 'admin' });
    expect(config).toEqual({
      type: 'ssh',
      host: 'example.com',
      user: 'admin',
      port: 22,
      path: undefined,
    });
  });

  it('rejects missing host', () => {
    expect(() => validate({ user: 'admin' })).toThrow('host');
  });

  it('rejects invalid port', () => {
    expect(() => validate({ host: 'example.com', user: 'admin', port: 99999 })).toThrow('port');
  });
});

describe('sshProvider', () => {
  it('has correct metadata', () => {
    expect(sshProvider.type).toBe('ssh');
    expect(sshProvider.description).toContain('SSH');
  });
});

import { describe, it, expect } from 'vitest';
import { validate, dockerProvider } from './index.js';

describe('validate', () => {
  it('accepts valid local config', () => {
    const config = validate({ container: 'api-server' });
    expect(config).toEqual({ type: 'docker', container: 'api-server' });
  });

  it('accepts valid remote config', () => {
    const config = validate({
      container: 'api-server',
      ssh: { host: 'remote.example.com', user: 'admin' },
    });
    expect(config).toEqual({
      type: 'docker',
      container: 'api-server',
      ssh: { host: 'remote.example.com', user: 'admin', port: 22 },
    });
  });

  it('rejects missing container', () => {
    expect(() => validate({})).toThrow('container');
  });

  it('rejects invalid ssh port', () => {
    expect(() =>
      validate({ container: 'api', ssh: { host: 'h', user: 'u', port: 99999 } })
    ).toThrow('port');
  });
});

describe('dockerProvider', () => {
  it('has correct metadata', () => {
    expect(dockerProvider.type).toBe('docker');
    expect(dockerProvider.description).toContain('Docker');
  });
});

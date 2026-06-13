import { describe, it, expect } from 'vitest';
import { validate, slsProvider } from './index.js';

describe('validate', () => {
  it('accepts valid config', () => {
    const config = validate({
      region: 'cn-hangzhou',
      project: 'my-app',
      logstore: 'app-log',
    });
    expect(config).toEqual({
      type: 'sls',
      region: 'cn-hangzhou',
      project: 'my-app',
      logstore: 'app-log',
    });
  });

  it('rejects missing project', () => {
    expect(() => validate({ region: 'cn-hangzhou', logstore: 'app-log' })).toThrow('project');
  });
});

describe('slsProvider', () => {
  it('has correct metadata', () => {
    expect(slsProvider.type).toBe('sls');
    expect(slsProvider.description).toContain('Aliyun');
  });
});

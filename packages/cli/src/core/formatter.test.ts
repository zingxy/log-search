import { describe, it, expect } from 'vitest';
import { formatEntry, sortEntries } from './formatter.js';
import type { LogEntry } from '@log-search/provider-types';

describe('formatEntry', () => {
  const entry: LogEntry = {
    source: 'local',
    raw: 'hello world',
    message: 'hello world',
    timestamp: '2024-06-13T08:00:00Z',
  };

  it('formats text for single source', () => {
    expect(formatEntry(entry, { format: 'text', multiSource: false })).toBe('hello world');
  });

  it('formats text for multi source', () => {
    expect(formatEntry(entry, { format: 'text', multiSource: true })).toBe('[local]          hello world');
  });

  it('formats json', () => {
    expect(formatEntry(entry, { format: 'json', multiSource: false })).toBe(JSON.stringify(entry));
  });
});

describe('sortEntries', () => {
  it('sorts by timestamp', () => {
    const entries: LogEntry[] = [
      { source: 'b', raw: 'b', message: 'b', timestamp: '2024-06-13T08:00:02Z' },
      { source: 'a', raw: 'a', message: 'a', timestamp: '2024-06-13T08:00:01Z' },
    ];
    const sorted = sortEntries(entries);
    expect(sorted[0].source).toBe('a');
  });
});

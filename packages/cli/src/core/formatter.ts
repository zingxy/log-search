import type { LogEntry } from '@log-search/provider-types';

export type OutputFormat = 'text' | 'json';

export interface FormatterOptions {
  format: OutputFormat;
  multiSource: boolean;
}

export function formatEntry(entry: LogEntry, options: FormatterOptions): string {
  if (options.format === 'json') {
    return JSON.stringify(entry);
  }

  if (options.multiSource) {
    const label = `[${entry.source}]`;
    return `${label.padEnd(16)} ${entry.raw}`;
  }

  return entry.raw;
}

export function sortEntries(entries: LogEntry[]): LogEntry[] {
  return entries.sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      return a.timestamp.localeCompare(b.timestamp);
    }
    if (a.timestamp) return -1;
    if (b.timestamp) return 1;
    return 0;
  });
}

export async function* mergeStreams(
  streams: AsyncIterable<LogEntry>[]
): AsyncIterable<LogEntry> {
  if (streams.length === 0) return;
  if (streams.length === 1) {
    yield* streams[0];
    return;
  }

  const buffers: LogEntry[][] = streams.map(() => []);
  let activeCount = streams.length;
  const iterators = streams.map((s) => s[Symbol.asyncIterator]());

  const readers = iterators.map(async (iter, index) => {
    try {
      while (true) {
        const result = await iter.next();
        if (result.done) break;
        buffers[index].push(result.value);
      }
    } catch {
      // Stream errors are handled by the dispatcher; stop reading this stream.
    } finally {
      activeCount--;
    }
  });

  try {
    while (activeCount > 0 || buffers.some((b) => b.length > 0)) {
      // Find the non-empty buffer with the earliest entry.
      let selectedIndex = -1;
      for (let i = 0; i < buffers.length; i++) {
        if (buffers[i].length === 0) continue;
        if (selectedIndex === -1) {
          selectedIndex = i;
          continue;
        }
        const a = buffers[selectedIndex][0];
        const b = buffers[i][0];
        if (a.timestamp && b.timestamp && b.timestamp < a.timestamp) {
          selectedIndex = i;
        }
      }

      if (selectedIndex === -1) {
        // All buffers empty but readers still active; wait briefly.
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }

      yield buffers[selectedIndex].shift()!;
    }
  } finally {
    await Promise.allSettled(readers);
    for (const iter of iterators) {
      await iter.return?.();
    }
  }
}

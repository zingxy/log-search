import type { Provider, Profile, QueryOptions, TailOptions, LogEntry } from '@log-search/provider-types';
import type { ProviderEntry, ProfileEntry } from '../config/loader.js';
import type { ProviderRegistry } from './registry.js';
import { sortEntries } from './formatter.js';

export interface ResolvedProfile {
  profile: Profile;
  providerEntries: ProviderEntry[];
}

export function resolveProfile(
  config: { providers: ProviderEntry[]; profiles: ProfileEntry[] },
  registry: ProviderRegistry,
  name: string
): ResolvedProfile {
  const profileEntry = config.profiles.find((p) => p.name === name);
  if (!profileEntry) {
    const suggestions = config.profiles
      .map((p) => p.name)
      .filter((n) => n.includes(name) || name.includes(n))
      .slice(0, 3);
    let message = `Profile "${name}" not found.`;
    if (suggestions.length > 0) {
      message += `\nDid you mean: ${suggestions.join(', ')}?`;
    }
    throw new Error(message);
  }

  const providerEntries: ProviderEntry[] = [];
  for (const providerName of profileEntry.providers) {
    const providerEntry = config.providers.find((p) => p.name === providerName);
    if (!providerEntry) {
      throw new Error(`Profile "${name}" references unknown provider "${providerName}"`);
    }
    providerEntries.push(providerEntry);
  }

  const profile: Profile = {
    name: profileEntry.name,
    providers: profileEntry.providers,
    defaults: profileEntry.defaults,
  };

  return { profile, providerEntries };
}

export interface RunQueryOptions {
  profileName: string;
  keyword?: string;
  since?: string;
  until?: string;
  limit?: number;
  rawQuery?: string;
}

export type RunResult =
  | { type: 'entry'; entry: LogEntry }
  | { type: 'error'; provider: string; error: Error };

export async function* runQuery(
  config: { providers: ProviderEntry[]; profiles: ProfileEntry[] },
  registry: ProviderRegistry,
  opts: RunQueryOptions
): AsyncIterable<RunResult> {
  const resolved = resolveProfile(config, registry, opts.profileName);

  const baseOpts: Omit<QueryOptions, 'providerConfig' | 'source'> = {
    profile: resolved.profile,
    keyword: opts.keyword,
    since: opts.since,
    until: opts.until,
    limit: opts.limit,
    rawQuery: opts.rawQuery,
  };

  const entries: LogEntry[] = [];
  const errors: { provider: string; error: Error }[] = [];

  await Promise.all(
    resolved.providerEntries.map(async (entry) => {
      const provider = registry.get(entry.type);
      if (!provider) {
        errors.push({
          provider: entry.name,
          error: new Error(`Provider type "${entry.type}" not registered`),
        });
        return;
      }

      let validatedConfig: unknown;
      try {
        validatedConfig = provider.validate(entry.config);
      } catch (err) {
        errors.push({ provider: entry.name, error: err as Error });
        return;
      }

      const providerOpts: QueryOptions = {
        ...baseOpts,
        source: entry.name,
        providerConfig: validatedConfig,
      };

      try {
        for await (const logEntry of provider.query(providerOpts)) {
          entries.push(logEntry);
        }
      } catch (err) {
        errors.push({
          provider: entry.name,
          error: new Error(`[${entry.name}] ${(err as Error).message}`),
        });
      }
    })
  );

  for (const entry of sortEntries(entries)) {
    yield { type: 'entry', entry };
  }
  for (const err of errors) {
    yield { type: 'error', ...err };
  }
}

export interface RunTailOptions {
  profileName: string;
  keyword?: string;
  since?: string;
}

export async function* runTail(
  config: { providers: ProviderEntry[]; profiles: ProfileEntry[] },
  registry: ProviderRegistry,
  opts: RunTailOptions
): AsyncIterable<RunResult> {
  const resolved = resolveProfile(config, registry, opts.profileName);

  const baseOpts: Omit<TailOptions, 'providerConfig' | 'source'> = {
    profile: resolved.profile,
    keyword: opts.keyword,
    since: opts.since,
  };

  type QueueItem = { type: 'entry'; entry: LogEntry } | { type: 'error'; provider: string; error: Error };
  const queue: QueueItem[] = [];
  let activeReaders = 0;

  for (const entry of resolved.providerEntries) {
    const provider = registry.get(entry.type);
    if (!provider) {
      yield { type: 'error', provider: entry.name, error: new Error(`Provider type "${entry.type}" not registered`) };
      continue;
    }

    let validatedConfig: unknown;
    try {
      validatedConfig = provider.validate(entry.config);
    } catch (err) {
      yield { type: 'error', provider: entry.name, error: err as Error };
      continue;
    }

    const providerOpts: TailOptions = {
      ...baseOpts,
      source: entry.name,
      providerConfig: validatedConfig,
    };

    activeReaders++;
    (async () => {
      try {
        for await (const logEntry of provider.tail(providerOpts)) {
          queue.push({ type: 'entry', entry: logEntry });
        }
      } catch (err) {
        queue.push({
          type: 'error',
          provider: entry.name,
          error: new Error(`[${entry.name}] ${(err as Error).message}`),
        });
      } finally {
        activeReaders--;
      }
    })();
  }

  while (activeReaders > 0 || queue.length > 0) {
    // Sort available entries by timestamp and yield the earliest.
    const entryIndices = queue
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.type === 'entry');

    if (entryIndices.length > 0) {
      let earliestIndex = 0;
      for (let i = 1; i < entryIndices.length; i++) {
        const a = (entryIndices[earliestIndex].item as { type: 'entry'; entry: LogEntry }).entry;
        const b = (entryIndices[i].item as { type: 'entry'; entry: LogEntry }).entry;
        if (a.timestamp && b.timestamp && b.timestamp < a.timestamp) {
          earliestIndex = i;
        }
      }
      const { item, index } = entryIndices[earliestIndex];
      queue.splice(index, 1);
      yield item;
    } else if (queue.length > 0) {
      yield queue.shift()!;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

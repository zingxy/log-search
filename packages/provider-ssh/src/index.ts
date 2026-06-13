import { spawn } from 'node:child_process';
import type { Provider, QueryOptions, TailOptions, LogEntry } from '@log-search/provider-types';

export interface SshConfig {
  type: 'ssh';
  host: string;
  user: string;
  port?: number;
  path?: string;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing or invalid required field: ${field}`);
  }
  return value;
}

export function validate(config: unknown): SshConfig {
  if (config === null || typeof config !== 'object') {
    throw new Error('SSH provider config must be an object');
  }
  const c = config as Record<string, unknown>;
  const host = assertString(c.host, 'host');
  const user = assertString(c.user, 'user');
  const port = c.port === undefined ? 22 : Number(c.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Invalid field: port must be an integer between 1 and 65535');
  }
  const path = c.path === undefined ? undefined : assertString(c.path, 'path');

  return { type: 'ssh', host, user, port, path };
}

function resolvePath(opts: QueryOptions | TailOptions, config: SshConfig): string {
  const defaults = opts.profile.defaults as Record<string, unknown>;
  const path = (defaults.path as string | undefined) ?? config.path;
  if (!path) {
    throw new Error('No log path configured. Set path in provider config or profile defaults.');
  }
  return path;
}

function buildRemoteCommand(
  config: SshConfig,
  path: string,
  keyword: string | undefined,
  limit: number | undefined,
  mode: 'query' | 'tail'
): string {
  const parts: string[] = [];

  if (mode === 'tail') {
    parts.push(`tail -f ${shellQuote(path)}`);
  } else {
    if (limit !== undefined && limit > 0) {
      // For query, grep first then limit tail.
      parts.push(`grep -E ${shellQuote(keyword ?? '.')} ${shellQuote(path)} | tail -n ${limit}`);
      return parts.join(' | ');
    }
    parts.push(`grep -E ${shellQuote(keyword ?? '.')} ${shellQuote(path)}`);
  }

  if (mode === 'tail' && keyword) {
    parts.push(`grep -E ${shellQuote(keyword)}`);
  }

  return parts.join(' | ');
}

function shellQuote(input: string): string {
  // Basic shell quoting; sufficient for paths/keywords in controlled configs.
  return `'${input.replace(/'/g, `'\\''`)}'`;
}

function buildSshArgs(config: SshConfig, remoteCommand: string, allocateTty: boolean): string[] {
  const args: string[] = [];
  if (allocateTty) {
    args.push('-t');
  }
  args.push('-p', String(config.port));
  args.push(`${config.user}@${config.host}`);
  args.push(remoteCommand);
  return args;
}

async function* runSsh(
  source: string,
  config: SshConfig,
  remoteCommand: string,
  allocateTty: boolean
): AsyncIterable<LogEntry> {
  const args = buildSshArgs(config, remoteCommand, allocateTty);
  const child = spawn('ssh', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const decoder = new TextDecoder();
  let buffer = '';

  const onData = (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      const entry: LogEntry = {
        source,
        raw: line,
        message: line,
      };
      // Try to extract a leading ISO timestamp.
      const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s/);
      if (tsMatch) {
        entry.timestamp = tsMatch[1];
      }
      pushEntry(entry);
    }
  };

  const queue: LogEntry[] = [];
  let finished = false;
  let error: Error | undefined;

  const pushEntry = (entry: LogEntry) => {
    queue.push(entry);
    if (resolveNext) {
      resolveNext();
      resolveNext = undefined;
    }
  };

  let resolveNext: (() => void) | undefined;

  child.stdout.on('data', onData);
  child.stderr.on('data', (chunk: Buffer) => {
    const text = decoder.decode(chunk);
    // Collect stderr; emit as error at end unless already handled.
    if (!error) {
      error = new Error(text.trim() || 'SSH command failed');
    }
  });

  child.on('error', (err) => {
    error = err;
    if (resolveNext) {
      resolveNext();
      resolveNext = undefined;
    }
  });

  child.on('close', (code) => {
    finished = true;
    if (code !== 0 && code !== null && !error) {
      error = new Error(`SSH exited with code ${code}`);
    }
    if (resolveNext) {
      resolveNext();
      resolveNext = undefined;
    }
  });

  try {
    while (!finished || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    }
  } finally {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  if (error) {
    throw new Error(`[${source}] ${error.message}`);
  }
}

export async function* query(opts: QueryOptions): AsyncIterable<LogEntry> {
  const config = validate(opts.providerConfig);
  const path = resolvePath(opts, config);
  const remoteCommand = buildRemoteCommand(
    config,
    path,
    opts.keyword,
    opts.limit,
    'query'
  );
  yield* runSsh(opts.source, config, remoteCommand, false);
}

export async function* tail(opts: TailOptions): AsyncIterable<LogEntry> {
  const config = validate(opts.providerConfig);
  const path = resolvePath(opts, config);
  const remoteCommand = buildRemoteCommand(
    config,
    path,
    opts.keyword,
    undefined,
    'tail'
  );
  yield* runSsh(opts.source, config, remoteCommand, true);
}

export const sshProvider: Provider = {
  type: 'ssh',
  description: 'Read logs from remote servers via SSH (tail/grep/cat).',
  validate,
  query,
  tail,
};

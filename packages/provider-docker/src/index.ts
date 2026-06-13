import { spawn } from 'node:child_process';
import type { Provider, QueryOptions, TailOptions, LogEntry } from '@log-search/provider-types';

export interface DockerConfig {
  type: 'docker';
  container: string;
  ssh?: {
    host: string;
    user: string;
    port?: number;
  };
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing or invalid required field: ${field}`);
  }
  return value;
}

export function validate(config: unknown): DockerConfig {
  if (config === null || typeof config !== 'object') {
    throw new Error('Docker provider config must be an object');
  }
  const c = config as Record<string, unknown>;
  const container = assertString(c.container, 'container');

  let ssh: DockerConfig['ssh'];
  if (c.ssh) {
    if (typeof c.ssh !== 'object') {
      throw new Error('Field "ssh" must be an object');
    }
    const s = c.ssh as Record<string, unknown>;
    const port = s.port === undefined ? 22 : Number(s.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error('Invalid field: ssh.port must be an integer between 1 and 65535');
    }
    ssh = {
      host: assertString(s.host, 'ssh.host'),
      user: assertString(s.user, 'ssh.user'),
      port,
    };
  }

  return { type: 'docker', container, ssh };
}

function parseSince(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Docker --since accepts Go duration (1h, 5m) or RFC3339 timestamp.
  const match = value.match(/^(\d+)([smhd])$/);
  if (match) return value;
  return new Date(value).toISOString();
}

function shellQuote(input: string): string {
  return `'${input.replace(/'/g, `'\\''`)}'`;
}

function buildDockerCommand(
  config: DockerConfig,
  opts: { since?: string; tail?: number; follow?: boolean; keyword?: string }
): { cmd: string; args: string[] } {
  const dockerArgs = ['logs', '--timestamps'];
  const since = parseSince(opts.since);
  if (since) dockerArgs.push('--since', since);
  if (opts.tail !== undefined && opts.tail > 0) dockerArgs.push('--tail', String(opts.tail));
  if (opts.follow) dockerArgs.push('--follow');
  dockerArgs.push(config.container);

  const dockerCmd = `docker ${dockerArgs.map(shellQuote).join(' ')}`;

  if (config.ssh) {
    const ssh = config.ssh;
    const remoteCommand = opts.keyword ? `${dockerCmd} | grep -E ${shellQuote(opts.keyword)}` : dockerCmd;
    const args: string[] = [];
    if (opts.follow) args.push('-t');
    args.push('-p', String(ssh.port));
    args.push(`${ssh.user}@${ssh.host}`);
    args.push(remoteCommand);
    return { cmd: 'ssh', args };
  }

  if (opts.keyword) {
    // Local execution with keyword filter needs a shell pipe.
    return {
      cmd: 'sh',
      args: ['-c', `${dockerCmd} | grep -E ${shellQuote(opts.keyword)}`],
    };
  }

  return { cmd: 'docker', args: dockerArgs };
}

async function* runDocker(
  source: string,
  config: DockerConfig,
  opts: { since?: string; tail?: number; follow?: boolean; keyword?: string }
): AsyncIterable<LogEntry> {
  const { cmd, args } = buildDockerCommand(config, opts);
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const decoder = new TextDecoder();
  let buffer = '';
  let stderr = '';

  const queue: LogEntry[] = [];
  let finished = false;
  let error: Error | undefined;
  let resolveNext: (() => void) | undefined;

  const pushEntry = (entry: LogEntry) => {
    queue.push(entry);
    if (resolveNext) {
      resolveNext();
      resolveNext = undefined;
    }
  };

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      // docker logs --timestamps: 2024-06-13T08:18:00.123456789Z log message
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s(.*)$/);
      const entry: LogEntry = {
        source,
        raw: line,
        message: match ? match[2] : line,
      };
      if (match) entry.timestamp = match[1];
      pushEntry(entry);
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += decoder.decode(chunk, { stream: true });
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
      error = new Error(`${cmd} exited with code ${code}: ${stderr.trim() || 'unknown error'}`);
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
    if (!child.killed) child.kill('SIGTERM');
  }

  if (error) {
    throw new Error(`[${source}] ${error.message}`);
  }
}

export async function* query(opts: QueryOptions): AsyncIterable<LogEntry> {
  const config = validate(opts.providerConfig);
  yield* runDocker(opts.source, config, {
    since: opts.since,
    tail: opts.limit,
    keyword: opts.keyword,
    follow: false,
  });
}

export async function* tail(opts: TailOptions): AsyncIterable<LogEntry> {
  const config = validate(opts.providerConfig);
  yield* runDocker(opts.source, config, {
    since: opts.since,
    keyword: opts.keyword,
    follow: true,
  });
}

export const dockerProvider: Provider = {
  type: 'docker',
  description: 'Read logs from Docker containers, optionally via SSH remote Docker daemon.',
  validate,
  query,
  tail,
};

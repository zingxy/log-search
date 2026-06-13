import { spawn } from 'node:child_process';
import type { Provider, QueryOptions, TailOptions, LogEntry } from '@log-search/provider-types';

export interface SlsConfig {
  type: 'sls';
  region: string;
  project: string;
  logstore: string;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing or invalid required field: ${field}`);
  }
  return value;
}

export function validate(config: unknown): SlsConfig {
  if (config === null || typeof config !== 'object') {
    throw new Error('SLS provider config must be an object');
  }
  const c = config as Record<string, unknown>;
  return {
    type: 'sls',
    region: assertString(c.region, 'region'),
    project: assertString(c.project, 'project'),
    logstore: assertString(c.logstore, 'logstore'),
  };
}

function parseTimeExpression(value: string | undefined, fallback: Date): string {
  if (!value) {
    return fallback.toISOString();
  }
  // Support relative expressions like "1h", "30m".
  const match = value.match(/^(\d+)([smhd])$/);
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = match[2];
    const msPerUnit: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const delta = num * msPerUnit[unit];
    return new Date(Date.now() - delta).toISOString();
  }
  // Assume ISO timestamp otherwise.
  return new Date(value).toISOString();
}

function buildQuery(keyword: string | undefined, rawQuery: string | undefined): string {
  if (rawQuery && keyword) {
    return `(${rawQuery}) AND ${keyword}`;
  }
  return rawQuery ?? keyword ?? '*';
}

interface SlsGetLogsRequest {
  project: string;
  logstore: string;
  fromTime: string;
  toTime: string;
  query: string;
  line: number;
  offset?: number;
}

function buildRequest(config: SlsConfig, opts: QueryOptions): SlsGetLogsRequest {
  const now = new Date();
  const fromTime = parseTimeExpression(opts.since, new Date(now.getTime() - 3600000));
  const toTime = parseTimeExpression(opts.until, now);
  return {
    project: config.project,
    logstore: config.logstore,
    fromTime,
    toTime,
    query: buildQuery(opts.keyword, opts.rawQuery),
    line: opts.limit ?? 100,
  };
}

async function runAliyunlog(
  source: string,
  config: SlsConfig,
  request: SlsGetLogsRequest
): Promise<LogEntry[]> {
  const args = [
    'log',
    'get_logs',
    `--request=${JSON.stringify(request)}`,
  ];

  const child = spawn('aliyunlog', args, {
    env: {
      ...process.env,
      // Allow region to be picked up by aliyunlog CLI.
      ALIYUN_LOG_ENDPOINT: `${config.region}.log.aliyuncs.com`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const decoder = new TextDecoder();
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk: Buffer) => {
    stdout += decoder.decode(chunk, { stream: true });
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += decoder.decode(chunk, { stream: true });
  });

  const code = await new Promise<number | null>((resolve) => {
    child.on('close', resolve);
    child.on('error', () => resolve(null));
  });

  if (code !== 0) {
    throw new Error(`[${source}] aliyunlog failed (exit ${code}): ${stderr.trim() || 'unknown error'}`);
  }

  // aliyunlog may output multiple JSON objects/arrays separated by newlines.
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  const entries: LogEntry[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // If the line is not valid JSON, treat it as raw log text.
      entries.push({
        source,
        raw: line,
        message: line,
      });
      continue;
    }

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        entries.push(slsItemToEntry(source, item));
      }
    } else if (parsed !== null && typeof parsed === 'object') {
      entries.push(slsItemToEntry(source, parsed as Record<string, unknown>));
    }
  }

  return entries;
}

function slsItemToEntry(source: string, item: Record<string, unknown>): LogEntry {
  const raw = JSON.stringify(item);

  // Try common SLS fields.
  let timestamp: string | undefined;
  if (typeof item.__time__ === 'number') {
    timestamp = new Date(item.__time__ * 1000).toISOString();
  } else if (typeof item.__time__ === 'string') {
    timestamp = new Date(Number(item.__time__) * 1000).toISOString();
  } else if (typeof item.time === 'number') {
    timestamp = new Date(item.time * 1000).toISOString();
  }

  let message: string;
  if (typeof item.message === 'string') {
    message = item.message;
  } else if (typeof item.content === 'string') {
    message = item.content;
  } else if (typeof item.msg === 'string') {
    message = item.msg;
  } else {
    // Fallback: use the first string field or the raw JSON.
    const firstString = Object.values(item).find((v) => typeof v === 'string') as string | undefined;
    message = firstString ?? raw;
  }

  return {
    source,
    timestamp,
    raw,
    message,
    metadata: item,
  };
}

export async function* query(opts: QueryOptions): AsyncIterable<LogEntry> {
  const config = validate(opts.providerConfig);
  const request = buildRequest(config, opts);
  const entries = await runAliyunlog(opts.source, config, request);
  for (const entry of entries) {
    yield entry;
  }
}

export async function* tail(_opts: TailOptions): AsyncIterable<LogEntry> {
  throw new Error('tail is not supported by sls provider in this version.');
}

export const slsProvider: Provider = {
  type: 'sls',
  description: 'Query logs from Aliyun Simple Log Service.',
  validate,
  query,
  tail,
};

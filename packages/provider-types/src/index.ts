/**
 * A single log entry returned by a provider.
 */
export interface LogEntry {
  /** Source provider instance name. */
  source: string;

  /** ISO 8601 timestamp, if available. */
  timestamp?: string;

  /** Log level, if available. */
  level?: string;

  /** Main log message. */
  message: string;

  /** Raw log line as returned by the source. */
  raw: string;

  /** Additional provider-specific metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Profile definition resolved from config.
 */
export interface Profile {
  /** Profile name. */
  name: string;

  /**
   * Provider instance names.
   * The config loader normalizes the singular `provider` field into this array.
   */
  providers: string[];

  /** Default query options. */
  defaults: Record<string, unknown>;
}

/**
 * Options passed to Provider.query().
 */
export interface QueryOptions {
  /** Resolved profile. */
  profile: Profile;

  /** Provider instance name (e.g. "sls-prod-api"). */
  source: string;

  /** Raw provider configuration from the config file. */
  providerConfig: unknown;

  /** Keyword filter. */
  keyword?: string;

  /** Start time expression or ISO timestamp. */
  since?: string;

  /** End time expression or ISO timestamp. */
  until?: string;

  /** Maximum number of log entries to return. */
  limit?: number;

  /** Provider-native query string, passed through as-is. */
  rawQuery?: string;
}

/**
 * Options passed to Provider.tail().
 */
export interface TailOptions {
  /** Resolved profile. */
  profile: Profile;

  /** Provider instance name (e.g. "sls-prod-api"). */
  source: string;

  /** Raw provider configuration from the config file. */
  providerConfig: unknown;

  /** Keyword filter. */
  keyword?: string;

  /** Start time expression or ISO timestamp. */
  since?: string;
}

/**
 * Unified interface that every log source must implement.
 */
export interface Provider {
  /** Provider type identifier, e.g. "sls" or "ssh". */
  readonly type: string;

  /** Short description shown by `log-search providers`. */
  readonly description: string;

  /**
   * Validate and normalize provider configuration.
   * The return value is opaque to CLI Core and passed back as `providerConfig`.
   */
  validate(config: unknown): unknown;

  /** Query historical logs. */
  query(opts: QueryOptions): AsyncIterable<LogEntry>;

  /** Tail logs in real time. */
  tail(opts: TailOptions): AsyncIterable<LogEntry>;
}

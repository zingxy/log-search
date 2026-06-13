# log-search

A unified CLI for querying logs from multiple sources. Built for both humans and AI agents.

## Features

- **Multiple log sources**: SSH remote files, Aliyun SLS, and Docker logs (local or via SSH) in the first release.
- **Unified interface**: Query and tail logs with the same commands regardless of source.
- **Multi-provider profiles**: One profile can query several providers and merge results by timestamp.
- **Human & AI friendly**: Plain text output by default; `--format json` emits NDJSON for easy parsing.
- **Pluggable providers**: Implement a simple interface to add new log sources.
- **No credential storage**: Reuses existing SSH agent and Aliyun CLI credentials.

## Installation

```bash
# From source
pnpm install
pnpm build
pnpm link --global

# Or after publishing to npm
npm install -g log-search
```

## Quick Start

```bash
# Create a config template at ~/.config/log-search/config.yaml
log-search init

# Edit the config, then validate it
log-search config validate

# Query logs
log-search query -p prod-api -s 1h -k error

# Tail logs
log-search tail -p web -k "500"

# JSON output for scripts / AI
log-search query -p prod-api -s 1h --format json | jq '.message'
```

## Configuration

Configuration lives at `~/.config/log-search/config.yaml`.

```yaml
providers:
  sls-prod-api:
    type: sls
    region: cn-hangzhou
    project: my-app-prod
    logstore: api-log

  ssh-web-01:
    type: ssh
    host: web-01.example.com
    user: admin
    path: /var/log/nginx/access.log

  docker-api:
    type: docker
    container: api-server

  docker-remote-api:
    type: docker
    container: api-server
    ssh:
      host: app-01.example.com
      user: admin

profiles:
  prod-api:
    providers:
      - sls-prod-api
    defaults:
      since: 1h
      keyword: error

  web:
    provider: ssh-web-01
    defaults:
      path: /var/log/nginx/access.log

  api:
    provider: docker-api
    defaults:
      since: 1h

  remote-api:
    provider: docker-remote-api
    defaults:
      since: 1h

plugins: []
```

### Provider vs Profile

- **Provider**: technical connection config (`host`, `region`, `project`, etc.).
- **Profile**: semantic query entry point. It binds one or more providers and supplies default query options.

## Commands

| Command | Description |
|---|---|
| `log-search init` | Create a config template |
| `log-search query -p <profile>` | Query historical logs |
| `log-search tail -p <profile>` | Tail logs in real time |
| `log-search profiles` | List profiles |
| `log-search providers` | List available providers |
| `log-search config validate` | Validate configuration |

## Writing a Custom Provider

A provider is an ESM module that exports an object implementing the `Provider` interface:

```typescript
import type { Provider, QueryOptions, TailOptions, LogEntry } from '@log-search/provider-types';

export const myProvider: Provider = {
  type: 'my-source',
  description: 'Read logs from my custom source',
  validate(config) {
    // validate and return normalized config
    return config;
  },
  async* query(opts: QueryOptions) {
    // yield LogEntry items
  },
  async* tail(opts: TailOptions) {
    // yield LogEntry items
  },
};
```

Register it by adding the package name to `plugins` in your config:

```yaml
plugins:
  - 'log-search-provider-my-source'
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

## Project Structure

```text
packages/
  cli/              # CLI core
  provider-types/   # Shared Provider interface
  provider-ssh/     # SSH provider
  provider-sls/     # Aliyun SLS provider
```

## License

MIT

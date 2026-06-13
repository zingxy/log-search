# log-search CLI 设计文档

## 1. 概述

`log-search` 是一个面向开发者和 AI Agent 的命令行日志查询工具。它通过统一的 `Provider` 接口屏蔽不同日志来源的差异，使用户可以用同一套命令查询 SSH 远程文件日志、阿里云 SLS 日志以及未来扩展的其他来源。

## 2. 目标与非目标

### 2.1 目标

- 提供统一的 CLI 入口，支持 `query`（历史查询）和 `tail`（实时跟踪）两种模式。
- 支持多日志来源：第一期为 SSH 远程文件和阿里云 SLS。
- 支持一个 profile 绑定多个 provider，结果按时间合并输出。
- 人类和 AI 都能使用：默认文本输出便于阅读，`--format json` 输出 NDJSON 便于程序解析。
- 认证复用系统已有能力（SSH agent、aliyun CLI 配置），不额外存储密钥。
- Provider 可扩展：通过统一接口和 ESM 插件机制，用户可以自行实现新的 provider。

### 2.2 非目标

- 第一期不实现交互式 TUI。
- 第一期 SLS provider 只实现 `query`，不实现 `tail`。
- 第一期不做本地二次过滤（provider 层过滤后直接使用）。
- 不做日志结构化解析规则配置（如 grok、logstash pattern）。
- 不做 Web UI 或 MCP 封装。

## 3. 架构设计

```text
┌─────────────────────────────────────────┐
│  log-search CLI Core (TypeScript/ESM)   │
│  - 命令解析                              │
│  - 配置加载与校验                        │
│  - Profile 解析                          │
│  - Provider Registry                     │
│  - 输出格式化                            │
└─────────────┬───────────────────────────┘
              │ resolves profile
              ▼
┌─────────────────────────────────────────┐
│  Provider Interface                     │
│  - validate(config): unknown            │
│  - query(opts): AsyncIterable<LogEntry> │
│  - tail(opts): AsyncIterable<LogEntry>  │
└─────────────┬───────────────────────────┘
              │ loads by provider type
    ┌─────────┴─────────┐
    ▼                   ▼
┌──────────┐      ┌──────────┐
│ provider │      │ provider │
│ sls      │      │ ssh      │
│ (built-in│      │ (built-in│
│  or      │      │  or      │
│  plugin) │      │  plugin) │
└──────────┘      └──────────┘
```

数据流：

1. 用户输入命令，如 `log-search query --profile prod-api --since 1h -k error`。
2. CLI Core 读取 `~/.config/log-search/config.yaml`。
3. 找到 `prod-api` profile，解析出其绑定的 provider 列表。
4. 从 Provider Registry 加载每个 provider 实现。
5. 并行调用每个 provider 的 `query(opts)`。
6. 收集各 provider 返回的 `LogEntry` 流，按 `timestamp` 排序合并。
7. CLI Core 根据 `--format` 参数输出 text 或 NDJSON。

## 4. Provider 接口

```typescript
export interface Provider {
  /** Provider 类型标识，如 "sls"、"ssh" */
  readonly type: string;

  /** 简短描述，用于 `log-search providers` 展示 */
  readonly description: string;

  /** 校验并规范化 provider 配置；返回值的类型由 provider 自己定义 */
  validate(config: unknown): unknown;

  /** 查询历史日志 */
  query(opts: QueryOptions): AsyncIterable<LogEntry>;

  /** 实时跟踪日志 */
  tail(opts: TailOptions): AsyncIterable<LogEntry>;
}

export interface QueryOptions {
  profile: Profile;
  providerConfig: unknown;
  keyword?: string;
  since?: string;
  until?: string;
  limit?: number;
  rawQuery?: string;
}

export interface TailOptions {
  profile: Profile;
  providerConfig: unknown;
  keyword?: string;
  since?: string;
}

export interface LogEntry {
  /** 来源 provider 实例名 */
  source: string;

  /** ISO 8601 时间戳 */
  timestamp?: string;

  /** 日志级别 */
  level?: string;

  /** 日志主体内容 */
  message: string;

  /** 原始日志行 */
  raw: string;

  /** Provider 附加字段 */
  metadata?: Record<string, unknown>;
}

export interface Profile {
  name: string;
  /** provider 实例名列表；配置文件里支持 `provider` 单数简写，加载时归一化为数组 */
  providers: string[];
  defaults: Record<string, unknown>;
}
```

## 5. Profile 与配置

配置文件位置：`~/.config/log-search/config.yaml`（遵循 XDG Base Directory 规范）。

配置结构：

```yaml
# ~/.config/log-search/config.yaml

providers:
  # SLS 生产环境
  sls-prod-api:
    type: sls
    description: "生产环境 API 日志"
    region: cn-hangzhou
    project: my-app-prod
    logstore: api-log

  # SLS 测试环境
  sls-test-api:
    type: sls
    description: "测试环境 API 日志"
    region: cn-hangzhou
    project: my-app-test
    logstore: api-log

  # SSH Web 服务器
  ssh-web-01:
    type: ssh
    description: "Web 服务器 01"
    host: web-01.example.com
    user: admin
    port: 22

profiles:
  # 单 provider
  web:
    provider: ssh-web-01
    defaults:
      path: /var/log/nginx/access.log

  # 多 provider
  prod-api:
    providers:
      - sls-prod-api
      - ssh-web-01
    defaults:
      since: 1h
      keyword: error
      rawQuery: topic:api

  test-api:
    provider: sls-test-api
    defaults:
      since: 1h
      keyword: error
      rawQuery: topic:api

# 外部插件列表
plugins:
  - "@log-search/provider-k8s"
```

### 5.1 Provider 与 Profile 的职责分界

- **Provider**：负责“怎么连、连哪里”。配置里放连接参数，如 `region`、`project`、`host`、`user`。
- **Profile**：负责“查什么、怎么查”。配置里放查询默认值，如 `since`、`keyword`、`rawQuery`、`limit`。

`profile.defaults` 中的通用字段由 CLI Core 解析；provider-specific 字段（如 SLS 的 `query`、SSH 的 `path`）原样透传给 provider。

### 5.2 多环境表达

“环境”（dev/test/staging/prod）不是 CLI 的系统概念，只是命名约定。可以通过 provider/profile 命名体现，例如 `sls-prod-api`、`test-api`。

## 6. 命令设计

### 6.1 全局选项

| 选项 | 说明 |
|---|---|
| `--config` | 指定配置目录，默认 `~/.config/log-search/` |
| `--version` | 显示版本 |
| `--help` | 显示帮助 |

### 6.2 `log-search query`

查询历史日志。

| 参数 | 说明 | 示例 |
|---|---|---|
| `--profile, -p` | 必填，profile 名 | `--profile prod-api` |
| `--since, -s` | 起始时间 | `--since 1h`、`--since 2024-06-01T00:00:00` |
| `--until, -u` | 结束时间 | `--until 30m` |
| `--keyword, -k` | 关键字过滤 | `-k "payment failed"` |
| `--limit, -n` | 最大返回条数 | `--limit 100` |
| `--format` | 输出格式：`text` 或 `json` | `--format json` |
| `--raw-query` | provider 原生查询语法透传 | `--raw-query "topic:api AND status:500"` |

示例：

```bash
log-search query -p prod-api -s 1h -k error
log-search query -p prod-api -s 1h --format json | jq '.message'
log-search query -p prod-api --raw-query "topic:api AND status:500" --format json
```

### 6.3 `log-search tail`

实时跟踪日志。

| 参数 | 说明 | 示例 |
|---|---|---|
| `--profile, -p` | 必填 | `--profile web` |
| `--since, -s` | 从何时开始 tail | `--since 5m` |
| `--keyword, -k` | 过滤关键字 | `-k "500"` |
| `--format` | 输出格式 | `--format json` |

示例：

```bash
log-search tail -p web -k "500"
```

### 6.4 `log-search profiles`

列出所有 profile。

```bash
log-search profiles
```

输出：

```text
NAME       PROVIDERS
prod-api   sls-prod-api, ssh-web-01
test-api   sls-test-api
web        ssh-web-01
```

### 6.5 `log-search providers`

列出所有可用 provider。

```bash
log-search providers
```

输出：

```text
TYPE  DESCRIPTION
sls   Query logs from Aliyun Simple Log Service.
ssh   Read logs from remote servers via SSH.
```

### 6.6 `log-search config validate`

验证配置文件。

```bash
log-search config validate
```

### 6.7 `log-search init`

初始化配置目录和模板文件。

```bash
log-search init
```

## 7. Provider 加载机制

### 7.1 内置 Provider

CLI Core 显式 import 并注册内置 provider：

```typescript
import { slsProvider } from '@log-search/provider-sls';
import { sshProvider } from '@log-search/provider-ssh';

const registry = new ProviderRegistry();
registry.register(slsProvider);
registry.register(sshProvider);
```

### 7.2 插件 Provider

通过配置文件 `plugins` 列表显式声明，CLI 用 ESM 动态 `import()` 加载：

```typescript
for (const pluginName of config.plugins ?? []) {
  const mod = await import(pluginName);
  const provider = mod.default ?? mod;
  registry.register(provider);
}
```

插件包命名建议：`@log-search/provider-<type>` 或 `log-search-provider-<type>`。

### 7.3 Provider 未找到

当 profile 引用的 provider type 未注册时：

```text
Provider type "k8s" not found for provider "k8s-prod".
Built-in providers: sls, ssh
Configured plugins: @log-search/provider-k8s
```

## 8. 输出格式化

### 8.1 Text 格式（默认）

单 provider 时直接输出 `raw`：

```text
2024-06-13T08:18:00Z ERROR payment failed
2024-06-13T08:18:01Z WARN  request timeout
```

多 provider 时前面加 `[source]`：

```text
[sls-prod-api] 2024-06-13T08:18:00Z ERROR payment failed
[ssh-web-01]   2024-06-13T08:18:01Z ERROR connection timeout
```

### 8.2 JSON 格式（`--format json`）

输出 NDJSON（Newline Delimited JSON），每行一个 JSON 对象：

```json
{"source":"sls-prod-api","timestamp":"2024-06-13T08:18:00Z","level":"ERROR","message":"payment failed","raw":"2024-06-13T08:18:00Z ERROR payment failed"}
{"source":"ssh-web-01","timestamp":"2024-06-13T08:18:01Z","level":"ERROR","message":"connection timeout","raw":"2024-06-13T08:18:01Z ERROR connection timeout"}
```

### 8.3 多 Provider 合并排序

- `query`：并行查询所有 provider，按 `timestamp` 排序后输出；无 `timestamp` 的日志按到达顺序排在末尾。
- `tail`：同时消费多个 provider 流，使用固定大小的滑动窗口（默认 100 条）按 `timestamp` 排序输出；无 `timestamp` 的日志按到达顺序输出。

## 9. 错误处理

所有错误输出到 **stderr**，成功日志输出到 **stdout**。

### 9.1 退出码

| 退出码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 通用错误 |
| 2 | 配置错误 |
| 3 | Provider 未找到 |
| 4 | Provider 执行失败 |
| 130 | 用户中断（Ctrl+C） |

### 9.2 典型错误

**配置文件不存在：**

```text
Config file not found: ~/.config/log-search/config.yaml
Run `log-search init` to create one.
```

**Profile 不存在：**

```text
Profile "prod-ap" not found.
Did you mean: prod-api, test-api?
```

**Provider 配置校验失败：**

```text
Invalid provider config for "sls-prod-api":
- missing required field: project
```

**Provider 执行失败：**

```text
[ssh-web-01] Failed to query logs:
ssh: connect to host app-01.example.com port 22: Connection refused
```

### 9.3 多 Provider 部分失败

- `query`：失败的 provider 报错到 stderr，其他 provider 继续输出，最终退出码为 4。
- `tail`：失败的 provider 停止 tail，其他 provider 继续，按 Ctrl+C 时全部停止。

## 10. 内置 Provider 实现要点

### 10.1 SSH Provider

**连接参数：**

```yaml
type: ssh
host: app-01.example.com
user: admin
port: 22
```

**query 实现：**

根据参数生成远端 shell 命令并 spawn。例如 `--limit 100 --keyword error`：

```bash
ssh admin@app-01.example.com "grep -E 'error' /var/log/app.log | tail -n 100"
```

逐行读取 stdout，包装为 `LogEntry`。

**tail 实现：**

```bash
ssh -t admin@app-01.example.com "tail -f /var/log/app.log | grep -E 'error'"
```

`-t` 分配 tty，保证 Ctrl+C 可中断。

**时间过滤：**

SSH 读文件不支持按日志时间字段精确过滤。第一期 `--since` 先不实现精确映射，由用户通过 `--keyword` 或 `--raw-query` 传原生 shell 过滤逻辑；`--limit` 映射为 `tail -n <limit>`。

### 10.2 SLS Provider

**连接参数：**

```yaml
type: sls
region: cn-hangzhou
project: my-app-prod
logstore: api-log
```

**query 实现：**

调用 `aliyunlog log get_logs`：

```bash
aliyunlog log get_logs --request='{"project":"my-app-prod","logstore":"api-log","fromTime":"...","toTime":"...","query":"topic:api AND error","line":100}'
```

解析返回的 JSON，每条日志转换为 `LogEntry`。

**tail 实现：**

第一期不实现。调用时抛出错误：

```text
tail is not supported by sls provider in this version.
```

## 11. 项目结构

```text
log-search/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.json
├── README.md
└── packages/
    ├── cli/
    │   ├── package.json
    │   ├── src/
    │   │   ├── index.ts
    │   │   ├── commands/
    │   │   │   ├── query.ts
    │   │   │   ├── tail.ts
    │   │   │   ├── profiles.ts
    │   │   │   ├── providers.ts
    │   │   │   └── config.ts
    │   │   ├── config/
    │   │   │   ├── loader.ts
    │   │   │   └── validator.ts
    │   │   ├── core/
    │   │   │   ├── registry.ts
    │   │   │   ├── dispatcher.ts
    │   │   │   ├── formatter.ts
    │   │   │   └── runner.ts
    │   │   └── providers/
    │   │       └── builtins.ts
    │   └── bin/
    │       └── log-search.js
    ├── provider-types/
    │   ├── package.json
    │   └── src/
    │       └── index.ts
    ├── provider-sls/
    │   ├── package.json
    │   └── src/
    │       └── index.ts
    └── provider-ssh/
        ├── package.json
        └── src/
            └── index.ts
```

### 11.1 依赖关系

```text
cli → provider-types
cli → provider-sls
cli → provider-ssh
provider-sls → provider-types
provider-ssh → provider-types
```

### 11.2 ESM 配置

每个 `package.json`：

```json
{
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  }
}
```

根 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022"
  }
}
```

## 12. 测试策略

### 12.1 单元测试

使用 **Vitest**（ESM 友好）。重点覆盖：

- 配置加载与校验
- Provider Registry
- Formatter（text / NDJSON）
- Profile 解析
- 命令参数解析

### 12.2 Provider 测试

- SSH provider：mock `spawn('ssh', ...)`，验证生成的命令参数。
- SLS provider：mock `spawn('aliyunlog', ...)`，验证 request JSON。

### 12.3 集成测试

使用本地 fake provider 测试完整命令链路，不依赖真实 SLS/SSH。

### 12.4 E2E 测试（后续）

使用 `execa` 运行 CLI 命令，验证 stdout/stderr/退出码。

### 12.5 CI

GitHub Actions 跑 `pnpm test`，覆盖 Node.js 18/20/22。

## 13. 初始化与安装

### 13.1 本地开发

```bash
pnpm install
pnpm build
pnpm link --global
```

### 13.2 发布安装

```bash
npm install -g log-search
```

### 13.3 初始化配置

```bash
log-search init
```

创建 `~/.config/log-search/config.yaml` 模板。

### 13.4 依赖前提

- Node.js ≥ 18
- pnpm
- 阿里云 CLI 或 `aliyunlog` CLI（SLS provider 使用）
- OpenSSH 客户端（SSH provider 使用）

## 14. 决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 方案 | 薄封装 + 插件化 Provider | 避免重复实现协议，同时保持统一接口和可扩展性 |
| 技术栈 | TypeScript + Node.js + pnpm monorepo | 用户指定，ESM 现代 |
| 配置格式 | YAML | 常见、可读性好、AI 和人都熟悉 |
| 输出格式 | 默认 text，`--format json` 输出 NDJSON | 人类和 AI 都友好 |
| 认证 | 复用 aliyun CLI / SSH agent | 不存储密钥，安全 |
| Profile 多 provider | 支持 | 方便同时查多个来源 |
| SLS tail | 第一期不做 | SLS 没有原生 tail，轮询复杂度超出本期范围 |
| 颜色高亮 | 第一期不做 | 避免 ANSI 字符干扰 AI 解析 |

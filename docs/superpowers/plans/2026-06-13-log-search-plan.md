# log-search CLI 实现计划

基于设计文档 `docs/superpowers/specs/2026-06-13-log-search-design.md`。

## 1. 项目初始化

### 1.1 创建 monorepo 骨架

- 初始化根目录 `package.json`，设置 `"type": "module"`、 `"private": true`。
- 创建 `pnpm-workspace.yaml`，包含 `packages/*`。
- 创建根 `tsconfig.json`，`compilerOptions.module` 和 `moduleResolution` 设为 `NodeNext`，`target` 设为 `ES2022`。
- 安装根依赖：`vitest`、`@types/node`、`typescript`。
- 配置 `pnpm build`、`pnpm test`、`pnpm dev` 等脚本。

### 1.2 创建 workspace 包

创建以下空包并写好 `package.json`：

- `packages/provider-types`
- `packages/provider-ssh`
- `packages/provider-sls`
- `packages/cli`

每个包设置 `"type": "module"`、`exports`、`scripts: { build, test }`。

### 1.3 验证

- 能运行 `pnpm install` 成功。
- 能运行 `pnpm -r build` 成功（此时为空构建）。
- 能运行 `pnpm -r test` 成功（无测试也成功）。

## 2. 实现 `@log-search/provider-types`

### 2.1 定义核心接口

在 `packages/provider-types/src/index.ts` 中定义：

- `Provider` 接口
- `QueryOptions`、`TailOptions`
- `LogEntry`、`Profile`

### 2.2 导出类型

确保所有类型通过 ESM `export` 导出，其他包可以 `import`。

### 2.3 验证

- 其他包能 `import { Provider } from '@log-search/provider-types'`。
- Vitest 能正常引用类型。

## 3. 实现 `@log-search/provider-ssh`

### 3.1 配置校验

实现 `validate(config)`：

- 必填字段：`type`、`host`、`user`
- 可选字段：`port`（默认 22）、`path`
- 类型检查并返回规范化配置

### 3.2 实现 `query`

- 根据 `providerConfig.path`、`opts.keyword`、`opts.limit` 构造远端 shell 命令。
- 使用 `child_process.spawn` 执行 `ssh user@host "grep -E '<keyword>' <path> | tail -n <limit>"`。
- 逐行读取 stdout，每行包装为 `LogEntry`：
  - `source` = profile provider 实例名
  - `raw` = 原始行
  - `message` = 原始行
- stderr 透传到 CLI Core（通过抛错或 stderr 输出）。

### 3.3 实现 `tail`

- 使用 `ssh -t user@host "tail -f <path> | grep -E '<keyword>'"`。
- 逐行读取并产出 `LogEntry`。
- 处理 Ctrl+C 中断，优雅关闭子进程。

### 3.4 测试

- mock `spawn`，验证生成的 ssh 命令参数。
- 验证 `LogEntry` 字段正确。
- 验证配置校验失败场景。

## 4. 实现 `@log-search/provider-sls`

### 4.1 配置校验

实现 `validate(config)`：

- 必填字段：`type`、`region`、`project`、`logstore`
- 返回规范化配置

### 4.2 实现 `query`

- 根据 `providerConfig` 和 `opts` 构造 `aliyunlog log get_logs` 的 JSON request：
  - `project`、`logstore`
  - `fromTime`、`toTime`（从 `opts.since`/`opts.until` 解析）
  - `query`（合并 `opts.rawQuery` 和 `opts.keyword`）
  - `line`（`opts.limit`，默认 100）
- spawn `aliyunlog log get_logs --request='...'`。
- 解析返回的 JSON，每条 SLS 日志转为 `LogEntry`：
  - `source` = provider 实例名
  - `timestamp` = SLS 时间字段
  - `message` = 日志内容
  - `raw` = JSON 字符串或原始内容

### 4.3 实现 `tail`

第一期不实现，调用时抛出清晰错误：

```
tail is not supported by sls provider in this version.
```

### 4.4 测试

- mock `spawn`，验证 `aliyunlog` 命令和 request JSON。
- 验证返回的 `LogEntry` 字段。
- 验证配置校验失败场景。

## 5. 实现 `log-search` CLI Core

### 5.1 命令解析

使用 `commander` 或 `cac` 实现：

- `log-search query`
- `log-search tail`
- `log-search profiles`
- `log-search providers`
- `log-search config validate`
- `log-search init`

全局选项 `--config`。

### 5.2 配置加载

- 默认读取 `~/.config/log-search/config.yaml`。
- 支持 `--config` 覆盖目录。
- 使用 `js-yaml` 解析 YAML。
- 将 `profile.provider` 单数写法归一化为 `profile.providers` 数组。
- 校验顶层结构：`providers`、`profiles`、`plugins`。

### 5.3 Provider Registry

- 显式注册内置 provider：`@log-search/provider-sls`、`@log-search/provider-ssh`。
- 读取 `config.plugins`，用 `await import(pluginName)` 动态加载外部 provider。
- 提供 `get(type)` 方法，找不到时返回 `undefined` 并附带可用 provider 列表。

### 5.4 Dispatcher / Runner

- 根据 profile 解析出 provider 实例列表。
- 并行调用 `query` 或 `tail`。
- 收集多个 `AsyncIterable<LogEntry>`。
- 处理多 provider 部分失败：失败的 provider 报错到 stderr，其他继续。

### 5.5 Formatter

实现两种输出格式：

- **text**：
  - 单 provider：直接输出 `raw`
  - 多 provider：输出 `[source] raw`
- **json**：
  - NDJSON，每行一个 JSON 对象

### 5.6 合并排序

- `query`：收集所有结果后按 `timestamp` 排序；无 `timestamp` 放末尾。
- `tail`：使用固定大小滑动窗口（默认 100 条）按 `timestamp` 排序输出。

### 5.7 错误处理

- 所有错误输出到 stderr。
- 统一退出码：
  - 0 成功
  - 2 配置错误
  - 3 provider 未找到
  - 4 provider 执行失败
  - 130 Ctrl+C

### 5.8 `init` 命令

创建 `~/.config/log-search/config.yaml` 模板文件：

```yaml
providers: {}
profiles: {}
plugins: []
```

### 5.9 `profiles` / `providers` / `config validate` 命令

- `profiles`：列出 profile 名和关联 provider。
- `providers`：列出 registry 中所有 provider type 和 description。
- `config validate`：校验所有 provider 配置和 profile 引用。

### 5.10 bin 入口

创建 `packages/cli/bin/log-search.js`：

```javascript
#!/usr/bin/env node
import '../dist/index.js';
```

在 `package.json` 中配置 `bin` 字段。

## 6. 集成与端到端验证

### 6.1 本地 fake provider 集成测试

在 `packages/cli/test` 中编写一个 fake provider：

```typescript
const fakeProvider: Provider = {
  type: 'fake',
  description: 'Fake provider for testing',
  validate: (c) => c,
  async* query(opts) {
    yield { source: 'fake', raw: 'hello', message: 'hello', timestamp: '2024-06-13T00:00:00Z' };
  },
  async* tail(opts) {
    yield { source: 'fake', raw: 'world', message: 'world', timestamp: '2024-06-13T00:00:01Z' };
  },
};
```

验证完整命令链路：配置加载 → profile 解析 → provider 调用 → formatter 输出。

### 6.2 手动 E2E 验证

- 配置一个 SSH profile，指向本地或测试服务器，验证 `query` 和 `tail`。
- 配置一个 SLS profile（如果有测试环境），验证 `query`。

## 7. 文档与发布准备

### 7.1 README

- 项目介绍
- 安装方式
- 配置示例
- 命令参考
- Provider 开发指南

### 7.2 .gitignore

- `node_modules/`
- `dist/`
- `.DS_Store`
- `*.log`

### 7.3 GitHub Actions CI

创建 `.github/workflows/ci.yml`：

- Node.js 18/20/22
- pnpm install
- pnpm build
- pnpm test

### 7.4 发布配置

- 配置 `changesets` 或手动版本管理。
- 每个包配置 `publishConfig.access`。

## 8. 任务优先级

| 优先级 | 任务 |
|---|---|
| P0 | 项目初始化、provider-types、SSH provider、CLI Core 命令解析与配置加载 |
| P1 | SLS provider、Formatter、Dispatcher、错误处理 |
| P2 | `profiles`/`providers`/`config validate`/`init` 命令 |
| P3 | 测试、CI、README、发布准备 |

## 9. 验收标准

- [ ] `pnpm install && pnpm build && pnpm test` 全部通过。
- [ ] `log-search init` 能创建配置模板。
- [ ] `log-search query -p <ssh-profile>` 能正确输出日志。
- [ ] `log-search tail -p <ssh-profile>` 能实时跟踪日志。
- [ ] `log-search query -p <sls-profile>` 能正确查询 SLS 日志。
- [ ] `log-search query -p <multi-provider-profile> --format json` 输出 NDJSON。
- [ ] 配置文件错误时给出清晰错误信息和正确退出码。

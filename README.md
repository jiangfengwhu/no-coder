# noCoder

用户共同维护一个 Web 应用的实验：提交需求 → 串行创建 Jules session → 在会话中检查、打包并部署 Cloudflare → 核对 PR 与线上代码 → 合并 → 下一条需求。

当前部署：https://nocoder-lab.809740942.workers.dev

占位配置已备好：本机发布凭据填 `.env`（模板 `.env.example`），本机 Worker 密钥填 `.dev.vars`（模板 `.dev.vars.example`），仓库 source 填 `wrangler.jsonc` 的 `vars.JULES_SOURCE`。实际密钥文件均被 Git 忽略。详见 [配置位置](docs/JULES_DEPLOY.md#已备好的占位配置)。

首次交付已部署入口和持久队列；Jules API Key、GitHub 令牌及 Jules Source 尚需配置，真实生成闭环尚未验收。管理密钥已通过初始化脚本配置，本机副本在 Git 忽略的 `.dev.vars` 中。

## 项目结构

```text
frontend/               React + Vite + shadcn/ui；说明、需求表单、队列、记录、调度管理
backend/src/app.ts      应用业务 API（Jules 可修改）
backend/src/control/    Durable Object 队列、Jules / GitHub 对接
backend/test/           串行性、恢复、发布门禁及输入验证测试
.github/workflows/      PR 验证及 Cloudflare 自动部署
scripts/                本地启动、部署版本验证
wrangler.jsonc          Cloudflare Worker、静态文件、Durable Object 配置
```

前后端源码分开，生产环境发布到同一个 Cloudflare Worker 域名，避免跨域配置。数据库采用 SQLite-backed Durable Object 的持久存储，不依赖浏览器 localStorage。全站使用同一个命名队列对象。

## 本地运行

需要 Node.js 24 或更新版本。

```sh
npm ci
npm run build
npm run dev
```

打开 Vite 输出的本地地址（默认 http://127.0.0.1:5173）。Vite 将 `/api` 转发给本地 Worker（8787）。仅查看生产构建时，运行 `npx wrangler dev --port 8787` 并打开 http://127.0.0.1:8787。

没有密钥时，说明页、提交、队列和持久化照常工作；页面明确提示 Jules 未连接，后端不会创建模拟 session。所有测试中的假服务仅用于测试，不会部署。

## 部署到 Cloudflare

```sh
npx wrangler login
npm run deploy
```

`wrangler.jsonc` 已配置 `nocoder-lab` Worker 和 SQLite Durable Object 迁移。Worker 的环境变量在配置文件维护，密钥通过 `wrangler secret put` 或 Cloudflare Dashboard 设置，避免手工 Dashboard 变量在后续 CLI 部署时被覆盖。

### 1. 连接 Jules

在 https://jules.google.com 连接 GitHub，授权 `jiangfengwhu/no-coder`。在 Jules 设置中创建 API Key，并将其保存为 Worker Secret：

```sh
npx wrangler secret put JULES_API_KEY
```

从 Jules 的 Sources API 找到此仓库对应的 `name`，原样填写 `wrangler.jsonc` 的 `JULES_SOURCE`。不要猜测 source ID。API：`GET https://jules.googleapis.com/v1alpha/sources`，通过 `x-goog-api-key` 请求头认证。官方文档：https://jules.google/docs/api/reference/sources/

### 2. GitHub 权限

为此仓库创建 fine-grained PAT，仓库权限至少包含：

- Contents：Read and write（合并 PR）。
- Pull requests：Read and write。
- Checks：Read。
- Commit statuses：Read。
- Actions：Read（确认部署工作流结果）。
- Metadata：Read。

```sh
npx wrangler secret put GITHUB_TOKEN
```

Jules 集成可能需要单独开启 GitHub Actions 对其分支 PR 的工作流执行；如果 `validate` 没有运行，队列会停在验证阶段。主分支建议设置 `validate` 为必需检查，允许 squash merge。不要使用 GitHub Actions 自带的 `GITHUB_TOKEN` 代替此 PAT：由该内置令牌产生的推送通常不会触发新的工作流。

### 3. 管理密钥

```sh
npx wrangler secret put QUEUE_ADMIN_TOKEN
```

设置一个足够长的随机值。页面底部“管理”可使用此值暂停、恢复、批准可选的人工合并，或处理未确认 session。管理密钥只保存在打开的管理窗口内，不写入浏览器存储。可选 `SUBMISSION_TOKEN` 用于设置需求提交邀请码。

也可运行 `npm run setup:admin`，自动生成管理密钥、存入本机 Git 忽略的 `.dev.vars` 并上传 Cloudflare。重复运行会复用本地已有密钥，不会自动轮换。

### 4. Jules 会话内直接发布

默认由 Jules 在会话中执行发布脚本。完成代码修改并提交本地 commit 后运行：

```sh
npm run deploy:jules
```

发布进程环境需要 `CLOUDFLARE_API_TOKEN`，使用 Cloudflare 的 Edit Cloudflare Workers 模板并限制到实际账户。排队任务的提示词会同时给出 `NC_JOB_ID`。不把密钥放进提示词或源码。Jules 未配置运行凭据时，脚本会报错并要求配置，不会假装上传成功。

脚本先检查、构建前端、打包后端，再将 Worker 和静态资源一起上传；最后核对线上 commit、代码树与任务标记。队列确认线上与 PR 代码树一致后才合并，并在合并后再次确认一致，才处理下一项。完整说明与可直接复制给 Jules 的指令见 [docs/JULES_DEPLOY.md](docs/JULES_DEPLOY.md)。

`validate.yml` 保留 PR 检查，`deploy.yml` 仅作为手动发布备用，不在合并后重复部署。默认模式无需把 Cloudflare 发布 Token 再存到 GitHub Actions；手动触发备用工作流时才需配置 Actions 的 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` Secrets 和 `APP_URL` Variable。

修改配置后重新部署：

```sh
npm run deploy
```

`AUTO_MERGE` 默认为 `true`：通过门禁后自动 squash merge。设成 `false` 可测试人工批准模式，但会保留当前任务位置直到管理员批准。初版未包含自动回滚；部署失败会暂停调度，保留活动任务以供恢复。

## 队列与恢复约定

- 先提交先处理；所有访问者共享一个队列，一个任务从生成到发布全程占用唯一位置。
- 只有轮到某条需求时才创建 Jules session。提交接口用请求 ID 去重；请求 ID 不会公开。
- 创建远端 session 前保存创建意图。网络结果不明确时暂停，恢复时先按任务标记找回远端 session，绝不直接重试创建。
- Jules 等待补充时仍然占用位置；只允许持有原浏览器 HttpOnly Cookie 的提交者补充说明。Cookie 丢失后由管理员在 Jules 中处理。
- PR 必须来自当前仓库、指向配置分支；不能修改调度、入口或发布基础设施（具体范围见 AGENTS.md）。要求 GitHub Actions 的 `validate` 检查通过，合并时锁定 PR head SHA。
- 默认每 30 秒轮询，关闭页面后由 Durable Object Alarm 继续处理。未配置或暂停时不持续轮询。
- 未确认创建、验证失败、合并失败或部署失败时暂停。在 Jules 直接发布模式下，Jules 失败、缺少 PR 或 PR 被关闭也暂停，因为线上可能已经改变。两小时未结束也暂停；**不会假定远端停止，也不会启动下一项**。
- 管理员确认远端停止且没有未完成合并/部署以后，才能使用“结束当前任务并继续队列”。工具不会调用未知语义的远端取消接口。
- 公共列表返回全部未完成任务及最近 100 条结束记录；完整记录保留在 Durable Object。每个浏览器最多 3 条未完成需求，每个 IP 每分钟最多 5 次提交，等待队列上限 100 条。
- 第一阶段的路径门禁用于保护实验基础设施，不能替代对生成代码的安全审查或沙箱隔离。对外开放前可先设置邀请码，让实验在受控参与者之间运行。

## 验证

```sh
npm run check
npm run deploy:check
```

测试覆盖并发调度、FIFO、重启恢复、提交去重、反馈归属、创建结果不确定、合并结果不确定、验证失败、部署失败、超时和可选批准模式。单元测试不声称已验证真实 Jules 生成；真实闭环需上述账户配置完成后提交一条实际需求验收。

## API

| 路径 | 功能 |
| --- | --- |
| `GET /api/health` | 当前部署 SHA |
| `GET /api/queue` | 队列与服务配置状态 |
| `POST /api/requests` | 提交需求（title、description、acceptance、requestId，可选 inviteCode） |
| `POST /api/requests/:id/feedback` | 补充说明（message） |
| `POST /api/admin` | 管理操作，Authorization: Bearer 管理密钥 |
| `/api/app` | 应用业务 API 示例，由 Jules 扩展 |

所有控制接口的 POST 需要与请求 URL 同源的 Origin 头。不要将管理员令牌暴露给页面脚本。后端不返回浏览器身份摘要、提交幂等键或上游服务凭据。

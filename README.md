# noCoder

共享一个 Web 应用：用户提交需求 → Jules 串行实现并直接发布 → 核对线上与 PR 代码树 → 合并 → 下一条需求。

正式域名：https://nocoder.297782.xyz

备用地址：https://nocoder-lab.809740942.workers.dev

## 统一配置

只需在 Cloudflare → Workers & Pages → nocoder-lab → Settings → Variables and Secrets 替换三个 Secret 占位：

- JULES_API_KEY
- GITHUB_TOKEN
- CLOUDFLARE_API_TOKEN

已有 QUEUE_ADMIN_TOKEN 保留。仓库、分支、账户 ID、部署模式和域名已固定，Jules Source 自动查找。请先在 Jules 中授权 jiangfengwhu/no-coder。占位值不会触发真实任务。

DNS 由用户配置，开启 Cloudflare 代理。Worker 路由为 nocoder.297782.xyz/*；部署不会创建或修改 DNS 记录。

[配置与发布说明](docs/JULES_DEPLOY.md)

## 目录

```text
frontend/               React、Vite、shadcn/ui 工作台
backend/src/app.ts      Jules 可以扩展的应用业务接口
backend/src/control/    Durable Object 串行队列和服务对接
backend/test/           队列恢复、发布门禁和凭据授权测试
scripts/deploy-jules.mjs Jules 会话内打包和发布脚本
wrangler.jsonc          固定的 Worker、路由与非敏感配置
```

前后端源码分目录，一次发布到同一个 Cloudflare Worker。前端静态资源由 Workers Static Assets 提供，后端处理 /api/*，队列保存在 Durable Object。

队列页面使用休眠 WebSocket 接收实时更新，初次打开只读取一次 HTTP 快照，不再每 10 秒轮询。隐藏页面会断开连接，回到前台后重连；离线停止重试，连接失败按退避间隔重试。每分钟一次 WebSocket 心跳由运行时自动回应，不唤醒 Durable Object 的 JavaScript。

适配 Workers 免费计划：使用 SQLite Durable Object；空队列和暂停时不设轮询 Alarm；有活动任务时全站共用每分钟一次上游状态检查；状态未变化不重复写入存储。WebSocket 建连、入站消息、活动任务查询和存储仍会消耗相应免费额度，并非零消耗。

## 开发与检查

```sh
npm ci
npm run build
npm run dev
npm run check
```

本地 Vite 默认为 http://127.0.0.1:5173，转发 API 到本地 Worker 8787。本地密钥可放在 Git 忽略的 .dev.vars 中；生产配置直接在 Worker 控制台维护。

## 发布

正常的排队任务使用会话自动提供的 NC_JOB_ID 和 NC_DEPLOY_TOKEN 执行 npm run deploy:jules。脚本通过任务专用授权从 Worker 获取发布凭据，不需要另填本地或 Jules 密钥文件。

本机维护可以复用当前 Wrangler 登录：

```sh
npm run deploy:jules -- --local-auth
```

GitHub validate.yml 保留 PR 检查，deploy.yml 仅为手动备用，不在合并后重复发布。默认不需要配置 GitHub Actions 发布凭据。

## 队列约定

- 全站一个持久队列，先提交先处理，从实现到发布全程占用唯一位置。
- 提交请求去重；每个浏览器最多 3 条未完成需求，每个 IP 每分钟最多 5 次提交。
- 同一浏览器的提交者可以回复 Jules 的补充说明请求。
- 验证、发布、合并失败或结果不明时暂停，保留位置；两小时未结束也暂停。
- Jules 直接发布后即使任务失败也可能已改变线上，因此需要管理员确认源码与线上一致后恢复。
- PR 不得修改调度与发布基础设施，保护范围见 AGENTS.md。
- 暂无自动回滚。测试不代替真实 Jules 闭环验收，必要 Secret 填好以后再提交实际需求验收。

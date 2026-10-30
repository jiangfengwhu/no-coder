# Jules 会话内发布

本仓库的前后端代码分开存放，构建后部署到同一个 Cloudflare Worker。

| 源码 | 构建结果 | Cloudflare 上的运行方式 |
| --- | --- | --- |
| `frontend/` | Vite 生成 `dist/` | Workers Static Assets 提供页面、JS 和 CSS |
| `backend/src/index.ts` | Wrangler 打包 ES Module Worker | `/api/*` 进入后端 |
| `backend/src/control/queue.ts` | 同一 Worker 的 `AgentQueue` 类 | Durable Object 保存队列和调度状态 |

不需要另建前端站点或 Node.js 服务器，不需要上传源码压缩包。Wrangler 将构建后的静态资源与后端模块一次上传。`wrangler.jsonc` 中的 `assets.directory`、`main` 和 Durable Object binding 已配置。

## 会话环境

Jules 在 Ubuntu VM 中执行任务。仓库环境的初始化命令可使用：

```bash
set +x
export NVM_DIR="$HOME/.nvm"
[ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
npm ci
```

根据实际环境选择 Node.js 的安装方式；本项目推荐 Node.js 24。

发布进程需要以下环境变量：

| 变量 | 要求 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 必需。可编辑实际部署账户 Worker 的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 可选。脚本默认使用当前已部署账户 ID |
| `APP_URL` | 可选。默认 `https://nocoder-lab.809740942.workers.dev` |
| `NC_JOB_ID` | 排队任务必需。从该次会话指令中取得任务 UUID |

这些变量必须在执行部署命令的进程环境中可用。本脚本不假定初始化脚本的 `export` 会跨 VM 阶段保留。不要把 API Token 写到仓库、会话提示词或日志中；缺少凭据时应请求配置运行环境。Cloudflare Token 是发布凭据，不等于 `JULES_API_KEY`。Worker 自己的业务密钥仍保存在 Cloudflare Secrets，不打包到前端。

## 执行顺序

1. 实现需求，运行必要检查，将源码提交为本地 Git commit。工作目录必须干净。
2. 执行会话中的命令（将 UUID 替换为该任务实际值）：

```bash
NC_JOB_ID=任务实际UUID npm run deploy:jules
```

脚本执行：类型检查 → 测试 → Vite 构建前端 → Wrangler 打包后端及静态资源 → 上传 Cloudflare → 请求 `/api/health`，核对 commit、Git tree 与任务 UUID。任一步失败都以非零状态结束。`--keep-vars` 保留远端的其他普通变量；配置文件中同名变量依然以仓库值为准。

3. 只有脚本输出 `Verified deployment` 才能报告部署成功。非敏感部署记录保存在 Git 忽略的 `.worker-build/deployment.json`。
4. 提交 PR 到 `main`，在说明中给出发布网址、commit、tree 和检查结果。不要自己合并。
5. 发布后如有源码变化，重新提交并重新执行发布脚本。Jules 自动调整 commit 元信息时，队列按 Git tree 确认代码内容一致。

只验证打包、不上传：

```bash
npm run deploy:jules -- --dry-run
```

在本机使用已有 Wrangler OAuth 登录发布（无需在本机再复制 Token）：

```bash
npm run deploy:jules -- --local-auth
```

## 给手动 Jules 会话的指令

仓库页面提交的任务会自动附带发布指令。手工打开 Jules 会话时，可复制下面这段，并填写真实任务或说明是独立维护任务：

> 阅读 AGENTS.md 和 docs/JULES_DEPLOY.md。完成需求后先提交源码，然后在当前会话执行 npm run deploy:jules，将 frontend/ 的构建产物和 backend/ Worker 一次发布到现有 Cloudflare Worker。排队任务使用提示词给出的 NC_JOB_ID。只使用执行环境中的 CLOUDFLARE_API_TOKEN。若缺少凭据，说明缺少的变量并等待配置。发布后确认线上健康接口对应本次代码，报告 URL、commit、tree，再产出 PR，不要自行合并。不要仅给出部署建议，也不要在检查失败时报告成功。

## 队列与发布时机

默认 `DEPLOY_MODE=jules`。当前任务始终占用唯一队列位置，脚本上传前会核对任务仍为当前活动项且队列未暂停。队列读取真实线上版本，确认其任务标记与 PR 的代码树一致后才合并；合并后的代码树也必须一致，才能处理下一项。

**这是在 Jules 会话中先部署、再合并的实验模式。** 因此，Jules 失败、没有 PR 或 PR 被关闭时，即使会话已经结束也会暂停队列，要求核对线上代码是否已变化。没有自动回滚；管理员应先恢复源码与线上一致，再释放任务位置。

GitHub Actions 的 `validate.yml` 仍负责 PR 检查。`deploy.yml` 仅供手动触发，不会在合并后重复发布。选择此模式不需要给 GitHub Actions 再配置 Cloudflare 发布 Token，但 Jules 的执行环境必须能取得它。

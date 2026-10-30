# 配置与 Jules 发布

所有需要人工填写的密钥，统一在 Cloudflare → Workers & Pages → nocoder-lab → Settings → Variables and Secrets 修改。

## 需要替换的 Secret

| 名称 | 用途 | 初始状态 |
| --- | --- | --- |
| JULES_API_KEY | 后端创建及查询 Jules 任务 | REPLACE_WITH_JULES_API_KEY |
| GITHUB_TOKEN | 验证、合并本仓库 PR | REPLACE_WITH_GITHUB_TOKEN |
| CLOUDFLARE_API_TOKEN | Jules 通过 Wrangler 发布此应用 | REPLACE_WITH_CLOUDFLARE_API_TOKEN |
| QUEUE_ADMIN_TOKEN | 网页底部调度管理 | 已设置真实随机密钥，可保持不变 |

不需要设置账号 ID、GitHub 用户、仓库名、分支、Jules Source、部署模式或网站地址。非敏感配置固定在仓库中。Jules Source 按 jiangfengwhu/no-coder 自动查找，需先在 Jules 授权仓库。

占位值会被识别为未配置，不会触发创建任务或发布。替换 Secret 并应用到 Worker 后，打开网站队列页即可重新检查配置并唤醒待处理队列。

GITHUB_TOKEN 仅授权本仓库：Contents 和 Pull requests 读写，Checks、Commit statuses、Actions 读取。CLOUDFLARE_API_TOKEN 使用 Edit Cloudflare Workers 权限并限制到当前部署账户；本仓库包含路由，还需要对应 Zone 的 Workers Routes 编辑与 Zone 读取权限。

## 域名与 DNS

正式域名：https://nocoder.297782.xyz

备用及凭据入口：https://nocoder-lab.809740942.workers.dev

Worker 路由为 nocoder.297782.xyz/*，属于当前账户的 297782.xyz 区域。DNS 由用户配置，必须开启 Cloudflare 代理。本项目不自动创建或修改 DNS 记录。备用 workers.dev 地址用于 DNS 配置前验收及稳定的任务凭据入口。

## 前后端如何部署

- frontend/ 由 Vite 构建到 dist/，通过 Workers Static Assets 提供页面和资源。
- backend/src/index.ts 由 Wrangler 打包为 Worker，处理 /api/*。
- AgentQueue Durable Object 保存唯一串行队列，重新部署不会清空队列。
- npm run deploy:jules 会检查、构建、打包并一次上传前后端，随后核对线上 commit、Git tree 和任务 UUID。

## Jules 会话中的命令

后端自动给每条任务附加发布指令：

```bash
NC_JOB_ID=本次任务UUID NC_DEPLOY_TOKEN=本次任务授权 npm run deploy:jules
```

这两个值由提示词自动提供，不需要人工维护。任务专用授权由管理密钥签名，只有当前活动、未暂停的任务可以换取发布凭据；排队和已结束任务无法使用。Cloudflare Token 仅在脚本进程内存中取得并传给 Wrangler，不写入源码、文件或日志。任务授权也不得写入 PR 或报告。

1. Jules 实现需求并提交源码，保持工作目录干净。
2. 执行该次任务的发布命令，发布前再次检查活动任务位置。
3. 只有输出 Verified deployment 才能报告成功。
4. 提交 PR，队列核对线上与 PR 代码树一致后合并，再确认主分支一致，才处理下一项。

此模式先发布、再合并。失败或结果不明时暂停队列，不自动回滚。恢复前需要确认线上与仓库一致。

只验证打包：npm run deploy:jules -- --dry-run

本机维护可复用已有 Wrangler 登录：npm run deploy:jules -- --local-auth

Jules 环境只需 Node.js 24、Git 和 npm ci 安装好的依赖。初始化可使用 nvm install 24、nvm use 24、npm ci。所有持久密钥仍配置在 Worker 中。

本地 .env、.dev.vars 仅供独立开发兼容使用，不再是上线必填配置。请勿把真实密钥提交到仓库。

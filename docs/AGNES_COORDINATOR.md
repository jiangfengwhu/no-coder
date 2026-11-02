# Agnes 协调器

控制 Worker 使用 Agnes 的兼容 Chat Completions 接口：`https://apihub.agnes-ai.com/v1/chat/completions`，固定模型为 `agnes-3.0-flash`。旧的 `agnes-2.0-flash` 实测已不可用。唯一新增 Secret 是 `AGNES_API_KEY`，统一在 Cloudflare 的 nocoder-lab Worker 中配置。

用途：创建 Jules 会话前整理任务及验收条件；前端回退后归纳修复诊断；自动创意任务收到 Jules 问题时，决定能否在已有范围内回答。任务的原始需求仍保留。部署授权、Worker/GitHub 密钥不传给 Agnes；授权命令由控制端在模型处理之后生成。模型只返回 `action` 和 `message`，没有部署、回退、合并、创建额外会话的工具权限。

自动答复仅用于系统创建的创意任务。用户提交的任务仍由原提交者回复。同一问题按哈希去重，单任务最多三次自动回复，发出前持久化发送意图。发送结果不明时暂停，不自动重复发送。密钥、付费、权限、破坏性操作及需求歧义由模型标记为需要人工处理。Agnes 不可用时：新任务创建/自动答复暂停；前端回退后的修复通知使用原有脱敏诊断继续发送，避免阻塞恢复。

PR 正在检查时也会重新查询原会话状态，发现再次等待输入或开始工作会返回会话状态处理。不会只检查 PR 而忽略新的对话。

管理员可通过 `/api/admin` 的 `test_agnes` 操作测试 Worker 到 Agnes 的连通性与结构化解析。该操作需要管理密钥，仅使用固定的无敏感信息测试问题，不创建 Jules 会话。

# 超时自动检查

AUTO_ADMIN_REVIEW=true 时，任务超过两小时会检查关联 Jules 会话并续期，不再仅凭总运行时间阻断发布。保留 startedAt，另用 runtimeReviewedAt 保存最近检查通过的时间。允许继续的远端状态：QUEUED、PLANNING、IN_PROGRESS、AWAITING_USER_FEEDBACK、COMPLETED。

旧版本遗留的两小时超时暂停也会被识别，后台 Durable Object alarm 每分钟检查；原会话仍可继续时恢复队列。若 Jules 正在询问“队列暂停导致无法部署”，恢复后自动向原会话说明部署凭据已可领取。不会新建会话，不改变 PR 检查、代码树核验和每日任务上限。浏览器保持休眠 WebSocket，不增加前端 HTTP 轮询。

远端查询或问题读取暂时失败时保留超时暂停并等待下一次检查，不反复写入相同状态。管理员主动暂停、会话失败、计划审批、发布冲突、回退结果不确定不自动放行；恢复通知发送结果不明确时也保留暂停，避免重复发送。此机制只管理活动任务的超时续期，不向外提供管理员密钥。

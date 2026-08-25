# Hearth Core

一个让 AI **被事件唤醒、自己选择行动或保持沉默，并为全过程留下可审计记录**的开源后端。

这不是聊天界面，也不是某个人格的复制品。它提供的是一套通用、安全的“主动 AI”运行机制：触发器只负责敲门，决策器选择是否行动，治理层检查权限与冷却，执行器完成动作，事件流水记录发生过的一切。

> 当前是可运行的 `v0.2`：适合体验、研究和二次开发，还不建议未经审查直接用于医疗、安全告警等高风险场景。

## 它解决什么问题？

普通聊天机器人只有在人发消息后才运行。主动 AI 还需要回答这些问题：

- 什么事情可以唤醒它？
- 醒来后可以做什么？
- 谁决定是说话、等待还是沉默？
- 如何避免频繁打扰、重复发送或越权执行？
- 事后怎样看见它为什么醒来、看了什么、如何决定、最后做了什么？

Hearth Core 把一次唤醒记录为同一条事件链：

```text
触发进入候选池 trigger
  → 定时单轨扫描 sweep
  → 活跃静默门 / 写入冷却 governor
  → 全局仲裁：现在值不值得行动 arbitration
  → 获批后只读观察 observation
  → 再选择具体动作 decision
  → 权限/冷却/上限 governor
  → 执行 action
  → 统一事件流水 ledger
```

“保持沉默”是正式动作，不是错误。

## 五分钟启动（推荐：Docker）

你需要先安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)。

```bash
git clone https://github.com/softVale/hearth-core.git
cd hearth-core
```

Windows PowerShell 一键启动：

```powershell
.\start.ps1
```

macOS / Linux 一键启动：

```bash
chmod +x start.sh
./start.sh
```

脚本会自动创建 `.env`、生成随机管理密钥并构建服务。然后打开 <http://localhost:3520>，输入 `.env` 中的 `ADMIN_TOKEN`。

不想使用脚本，也可以手动复制 `.env.example` 为 `.env`，更换 `ADMIN_TOKEN`，再运行 `docker compose up -d --build`。

停止服务：

```bash
docker compose down
```

事件记录保存在本机 `data/events.jsonl`。`docker compose down` 不会删除它。

## 不用 Docker

需要 Node.js 20 或更高版本。本项目没有第三方运行依赖：

```bash
cp .env.example .env
# 将 .env 中的配置加载进环境后：
npm start
```

目前 Node 直接启动不会自动读取 `.env` 文件。新手建议使用上面的 Docker 方式。

## 默认为什么不需要模型？

默认 `DECIDER_MODE=demo`，使用内置演示决策器。这样任何人无需购买 API，也能看懂完整事件链，而且不会意外向外发送消息。

需要接入兼容 OpenAI Chat Completions 的模型时，修改 `.env`：

```dotenv
DECIDER_MODE=openai-compatible
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=你的密钥
LLM_MODEL=gpt-4.1-mini
```

密钥只放在本机 `.env`，不要提交到 GitHub。

## 醒来时可以选择什么？

v0.2 内置四个通用动作：

| 动作 | 含义 | 是否对外产生影响 |
| --- | --- | --- |
| `silent` | 保持沉默 | 否 |
| `defer` | 延后再考虑 | 否 |
| `note` | 把念头留在事件流水 | 否 |
| `webhook` | 调用外部 HTTP 地址 | 是，默认未配置 |

动作必须同时满足两个条件：决策器选择它，并且 `ALLOWED_ACTIONS` 明确允许它。`webhook` 还必须配置 `WEBHOOK_URL`。写入动作默认至少间隔 20 分钟，单靠模型不能绕过。

未来的邮件、手机通知、机器人消息、日历、智能设备等都应作为独立适配器接入，而不是把账号和密钥写进核心代码。

## 如何触发？

正常入口只把触发放入候选池，等待默认每 15 分钟一次的全局仲裁：

```bash
curl -X POST http://localhost:3520/api/triggers \
  -H "Authorization: Bearer 你的ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"calendar","reason":"到了喝水时间","payload":{"suggested_action":"note","message":"记得喝水"}}'
```

管理员可手动运行一轮扫描：

```bash
curl -X POST http://localhost:3520/api/sweep \
  -H "Authorization: Bearer 你的ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

网页和旧版兼容入口 `/api/wake` 会“登记触发并立即仲裁”，用于演示和调试；它仍不能绕过动作权限：

```bash
curl -X POST http://localhost:3520/api/wake \
  -H "Authorization: Bearer 你的ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual","reason":"到了喝水时间","payload":{"suggested_action":"note","message":"记得喝水"}}'
```

查看最近事件：

```bash
curl http://localhost:3520/api/events?limit=50 \
  -H "Authorization: Bearer 你的ADMIN_TOKEN"
```

## 统一留痕

生产原型曾分别记录状态机行为、行动链和念头决定。开源版统一为追加写入的事件流水，每条事件包含：

- `id`：事件自身编号；
- `cycle_id`：同一次唤醒的共同编号；
- `trigger_id`：最初触发事件编号；
- `type`：事件类型；
- `at`：发生时间；
- `data`：该步骤的结构化结果。

常见事件类型：

```text
trigger.received
sweep.started
arbitration.approved / arbitration.passed / arbitration.failed
observation.completed
decision.made / decision.failed
governor.allowed / governor.blocked
action.completed / action.failed
```

这使开发者能重放和分析一次自主行为，也让普通使用者能看见系统有没有越权或频繁打扰。

## 默认安全边界

- 默认不连接私人记忆、聊天记录、屏幕或设备。
- 默认没有可用的外部发送地址。
- 模型输出不能绕过允许动作列表。
- 对外动作受全局冷却与每日上限约束。
- 模型失败或输出非法时默认沉默。
- API 除 `/health` 和首页外均要求 `ADMIN_TOKEN`。
- 事件流水可能包含触发原因和动作内容，请把 `data/` 当作私人数据保管。

更完整的边界见 [SECURITY.md](SECURITY.md)。

## 开发

```bash
npm test
npm run check
npm run dev
```

目录说明：

```text
src/config.js   配置与安全默认值
src/ledger.js   统一事件流水
src/decider.js  演示/模型决策器
src/core.js     唤醒、治理与执行主流程
src/server.js   HTTP API
public/         中文查看页
test/           自动测试
```

## 项目来源与隐私

Hearth Core 提炼自一个真实运行的个人 AI 系统，但本仓库只保留通用机制。这里不包含原系统的用户数据、人格、关系记忆、聊天记录、域名、密钥、模型供应商私有配置或生产数据库。

欢迎用匿名、合成数据提交问题和复现步骤。请勿在 Issue 中粘贴 API 密钥、聊天原文、记忆库或事件流水。

## 路线图

- Webhook 和消息队列触发器；
- 可插拔只读观察器；
- SQLite 事件存储与可视化筛选；
- 通知/邮件等权限化动作适配器；
- 勿扰时间、按动作冷却、确认后执行；
- 事件数据自动脱敏和保留期限；
- Docker 镜像与版本发布。

## 许可证

[Apache License 2.0](LICENSE)。

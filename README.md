# 母婴行业成片Prompt Studio

面向客户的单页工具：选择洗发水、面霜或洗面奶，以及“场景口播＋产品吸睛＋使用演示”或“痛点＋功效可视化”，上传商品图，填写商品名称、适用人群、标准主痛点、核心卖点和商品质地，可选粘贴客户自有脚本，输出可直接投喂 Seedance 2.5 的30秒完整成片提示词。

## 本地启动

```bash
npm start
```

默认地址：`http://127.0.0.1:4317`

后端按“类目×套路”路由到六个 LabelGPT Agent，空间 `115`。本机调试会读取现有 LabelGPT 登录凭证；部署时应通过服务端环境变量提供凭证，不能把凭证写进前端代码。

## 服务端配置

- `LABELGPT_AGENT_SHAMPOO_SCENE`：洗发水场景口播，默认 `7670004447182864427`
- `LABELGPT_AGENT_SHAMPOO_PAIN`：洗发水痛点机制，默认 `7670099946380591113`
- `LABELGPT_AGENT_CREAM_SCENE`：面霜场景口播，默认 `7670101071544664110`
- `LABELGPT_AGENT_CREAM_PAIN`：面霜痛点机制，默认 `7670101101663830026`
- `LABELGPT_AGENT_CLEANSER_SCENE`：洗面奶场景口播，默认 `7670101065483943946`
- `LABELGPT_AGENT_CLEANSER_PAIN`：洗面奶痛点机制，默认 `7670101041572249610`
- `LABELGPT_IMAGE_PARSER_AGENT`：商品图专用反解析，默认 `7669651444601012234`
- `LABELGPT_SPACE_ID`：默认 `115`
- `LABELGPT_SYNC_TOKEN`、`LABELGPT_SID`：服务端上传商品图所需凭证
- `LABELGPT_CLI_PATH`、`LABELGPT_WORKDIR`：本地联调配置
- `APP_ACCESS_USER`、`APP_ACCESS_PASSWORD`：可选的临时客户访问账号与密码；未配置密码时保持本地免登录

当前后端先调用专用商品图反解析 Agent，得到包装视觉锚点与可读文字原文，再通过 `labelgpt-cli agent debug` 调用对应的“类目×套路” Agent。六套成片工作流都采用两层 PE：第一层接收专用图片解析结果并理解、融合客户脚本，第二层按对应类目与套路编译 Seedance 2.5 完整成片提示词。痛点机制套路会额外约束“一条痛点只对应一条有事实支持的机制”；证据不足时自动降级为真实质地、使用动作和有限结果。

Agent 开始节点中的 `商品图片` 已声明为 `Image` 类型，CLI 传入的 TOS 图片地址会作为多模态图片交给模型，而不是普通文本。

## 项目内容

- [`skills/`](skills/)：六套可独立交付的“类目×套路”项目 Skill。
- [`labelgpt-prompts/`](labelgpt-prompts/)：线上 LabelGPT 节点使用的中文 PE 源文件。
- [`docs/skill-delivery.md`](docs/skill-delivery.md)：Agent 映射、生成链路、验收结果与时延说明。
- [`scripts/smoke-test-live.mjs`](scripts/smoke-test-live.mjs)：使用测试商品图进行严格端到端验收。

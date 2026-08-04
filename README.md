# 母婴行业成片Prompt Studio

面向客户的单页工具：上传商品图，填写商品名称、适用人群、标准主痛点、核心卖点和商品质地，可选粘贴客户自有脚本，输出可直接投喂 Seedance 2.5 的 30 秒完整成片提示词。

## 本地启动

```bash
npm start
```

默认地址：`http://127.0.0.1:4317`

后端默认调用 LabelGPT Agent `7670004447182864427`，空间 `115`。本机调试会读取现有 LabelGPT 登录凭证；部署时应通过服务端环境变量提供凭证，不能把凭证写进前端代码。

## 服务端配置

- `LABELGPT_AGENT_ID`：默认 `7670004447182864427`
- `LABELGPT_SPACE_ID`：默认 `115`
- `LABELGPT_SYNC_TOKEN`、`LABELGPT_SID`：服务端上传商品图所需凭证
- `LABELGPT_CLI_PATH`、`LABELGPT_WORKDIR`：本地联调配置

当前后端通过 `labelgpt-cli agent debug` 调用已保存的 Agent 工作流并等待结果，单次最长等待 10 分钟。LabelGPT 工作流采用两层 PE：先由“客户脚本理解与融合”节点输出结构化创作意图，再由“Seedance 2.5成片Prompt编译”节点结合商品图生成最终提示词；未提供脚本时自动沿用自由生成模式。

Agent 开始节点中的 `商品图片` 已声明为 `Image` 类型，CLI 传入的 TOS 图片地址会作为多模态图片交给模型，而不是普通文本。

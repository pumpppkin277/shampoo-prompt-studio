import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4317);
const AGENT_IDS = {
  "shampoo:scene": process.env.LABELGPT_AGENT_SHAMPOO_SCENE || process.env.LABELGPT_AGENT_ID || "7670004447182864427",
  "shampoo:pain": process.env.LABELGPT_AGENT_SHAMPOO_PAIN || "7670099946380591113",
  "cream:scene": process.env.LABELGPT_AGENT_CREAM_SCENE || "7670101071544664110",
  "cream:pain": process.env.LABELGPT_AGENT_CREAM_PAIN || "7670101101663830026",
  "cleanser:scene": process.env.LABELGPT_AGENT_CLEANSER_SCENE || "7670101065483943946",
  "cleanser:pain": process.env.LABELGPT_AGENT_CLEANSER_PAIN || "7670101041572249610",
};
const IMAGE_PARSER_AGENT_ID = process.env.LABELGPT_IMAGE_PARSER_AGENT || "7669651444601012234";
const SPACE_ID = process.env.LABELGPT_SPACE_ID || "115";
const LABELGPT_CLI = process.env.LABELGPT_CLI_PATH || path.join(homedir(), ".local/bin/labelgpt-cli");
const LABELGPT_WORKDIR = process.env.LABELGPT_WORKDIR || path.join(homedir(), "Documents/临时任务");
const ACCESS_USER = process.env.APP_ACCESS_USER || "customer";
const ACCESS_PASSWORD = process.env.APP_ACCESS_PASSWORD || "";
const MAX_BODY = 12 * 1024 * 1024;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function hasAccess(req) {
  if (!ACCESS_PASSWORD) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator >= 0 && decoded.slice(0, separator) === ACCESS_USER && decoded.slice(separator + 1) === ACCESS_PASSWORD;
  } catch {
    return false;
  }
}

function requestAccess(res) {
  res.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="Prompt Studio", charset="UTF-8"',
  });
  res.end("请输入试用账号和密码");
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error("商品图片不能超过 10MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function localAuth() {
  const configRoot = process.env.LABELGPT_AUTH_DIR || path.join(homedir(), "Documents/临时任务/.labelgpt-cli");
  if (process.env.LABELGPT_SYNC_TOKEN && process.env.LABELGPT_SID) {
    return { syncToken: process.env.LABELGPT_SYNC_TOKEN, sid: process.env.LABELGPT_SID };
  }
  const [tokens, cookies] = await Promise.all([
    readFile(path.join(configRoot, "tokens.json"), "utf8").then(JSON.parse),
    readFile(path.join(configRoot, "cookies.json"), "utf8").then(JSON.parse),
  ]);
  return {
    syncToken: tokens.sites.cn.sync_token,
    sid: cookies.sites.cn.value,
  };
}

async function uploadImage(dataUrl, filename) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(dataUrl || "");
  if (!match) throw new Error("请上传 PNG、JPG 或 WebP 商品图");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("商品图片无效或超过 10MB");

  const auth = await localAuth();
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: match[1] }), filename || "product.png");
  const response = await fetch("https://labelgpt.bytedance.net/api/tos/upload?tosFolderName=labelgpt", {
    method: "POST",
    headers: {
      Cookie: `JWT_SYNC_TOKEN_KEY=${auth.syncToken}; labelgpt_sid_v4=${auth.sid}`,
      "X-Sync-Token": auth.syncToken,
      "X-Space-Id": SPACE_ID,
    },
    body: form,
  });
  const payload = await response.json();
  if (!response.ok || payload.code !== 0 || !payload.data?.tosUrl) {
    throw new Error(payload.message || "商品图上传失败");
  }
  return payload.data.tosUrl;
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(LABELGPT_CLI, args, { cwd: LABELGPT_WORKDIR });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) {
        const message = stderr.trim() || stdout.trim() || "提示词服务调用失败";
        try {
          const parsed = JSON.parse(message);
          const backendError = parsed.error || parsed;
          if (backendError.code === 83003 || String(backendError.message).includes("渠道校验不合法")) {
            return reject(new Error("提示词服务尚未开通网页调用渠道"));
          }
          return reject(new Error(backendError.message || message));
        } catch {
          return reject(new Error(message));
        }
      }
      try {
        const jsonStart = stdout.indexOf("{");
        const payload = JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : stdout);
        if (payload?.error) {
          const backendError = payload.error;
          if (backendError.code === 83003 || String(backendError.message).includes("渠道校验不合法")) {
            return reject(new Error("LABELGPT_CHANNEL_INVALID"));
          }
          return reject(new Error(backendError.message || "提示词服务调用失败"));
        }
        resolve(payload);
      } catch {
        reject(new Error("提示词服务返回格式异常"));
      }
    });
  });
}

function buildCustomerInfo(input) {
  const customerScript = String(input.customerScript || "").trim();
  return [
    `商品类目：${input.categoryLabel}`,
    `成片套路：${input.routineLabel}`,
    `商品图专用解析结果：${input.productImageAnalysis}`,
    `商品名称：${input.productName}`,
    `适用人群：${input.audience}`,
    `标准主痛点：${input.painPoint}`,
    `核心卖点：${input.sellingPoint}`,
    `商品质地：${input.texture}`,
    `客户自有脚本：${customerScript || "未提供"}`,
  ].join("\n");
}

async function parseProductImage(imageUrl) {
  const debugResult = await runCli([
    "agent", "debug", "--id", IMAGE_PARSER_AGENT_ID,
    "--input", JSON.stringify({ imagetest: imageUrl }),
    "--space-id", SPACE_ID, "--format", "json",
    "--wait-timeout", "10m", "--poll-interval", "2s", "--timeout", "1m",
  ]);
  const result = findResult(debugResult);
  if (result) return result;
  if (debugResult.timed_out) throw new Error("商品图解析超过 10 分钟，请稍后重试");
  throw new Error("商品图解析完成，但没有读取到视觉结果");
}

function findResult(payload) {
  const debugNodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  for (const node of debugNodes) {
    const executionResult = node?.execution_result;
    if (typeof executionResult === "string" && executionResult !== "null") {
      try {
        const parsed = JSON.parse(executionResult);
        const prompt = parsed["Seedance2.5完整成片Prompt"] || parsed["Seedance 2.5完整成片Prompt"] || parsed["C4.5完整成片Prompt"] || parsed.result || parsed.output;
        if (prompt) return prompt;
      } catch {
        if (executionResult.trim()) return executionResult;
      }
    }
  }
  const rows = Array.isArray(payload) ? payload : payload.data || payload.result || payload.results || [];
  const row = Array.isArray(rows) ? rows[0] : rows;
  const output = row?.result || row?.output || row?.pre_label_result || row?.PreLabelResult || row?.data;
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      return parsed["Seedance2.5完整成片Prompt"] || parsed["Seedance 2.5完整成片Prompt"] || parsed["C4.5完整成片Prompt"] || parsed.result || parsed.output || output;
    } catch {
      return output;
    }
  }
  return output?.["Seedance2.5完整成片Prompt"] || output?.["Seedance 2.5完整成片Prompt"] || output?.["C4.5完整成片Prompt"] || output?.result || output?.output || null;
}

async function generate(input) {
  for (const key of ["category", "routine", "productName", "audience", "painPoint", "sellingPoint", "texture", "imageDataUrl"]) {
    if (!String(input[key] || "").trim()) throw new Error("请完整填写商品信息并上传商品图");
  }
  const agentId = AGENT_IDS[`${input.category}:${input.routine}`];
  if (!agentId) throw new Error("暂不支持这个类目与成片套路组合");
  const categoryLabels = { shampoo: "洗发水", cream: "面霜", cleanser: "洗面奶" };
  const routineLabels = { scene: "需求场景演绎（口播）＋产品创意吸睛＋产品使用演示", pain: "痛点呈现＋功效机制可视化" };
  input.categoryLabel = categoryLabels[input.category];
  input.routineLabel = routineLabels[input.routine];
  const imageUrl = await uploadImage(input.imageDataUrl, input.imageName);
  input.productImageAnalysis = await parseProductImage(imageUrl);
  const params = JSON.stringify({ userPrompt: buildCustomerInfo(input), imagetest: imageUrl });
  const debugResult = await runCli([
    "agent", "debug", "--id", agentId,
    "--input", params,
    "--space-id", SPACE_ID, "--format", "json",
    "--wait-timeout", "10m", "--poll-interval", "2s", "--timeout", "1m",
  ]);
  const result = findResult(debugResult);
  if (result) return { prompt: result, taskUuid: debugResult.debug_id || null };
  if (debugResult.timed_out) throw new Error("生成时间超过 10 分钟，请稍后重试");
  throw new Error("生成已完成，但没有读取到提示词，请检查 Agent 输出字段");
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC, pathname));
  if (!filePath.startsWith(PUBLIC)) return send(res, 404, "Not found", "text/plain");
  try {
    const body = await readFile(filePath);
    send(res, 200, body, mimeTypes[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}

const server = http.createServer(async (req, res) => {
  if (!hasAccess(req)) return requestAccess(res);
  if (req.method === "POST" && req.url === "/api/generate") {
    try {
      const input = await readJson(req);
      send(res, 200, await generate(input));
    } catch (error) {
      console.error(error);
      send(res, 400, { error: error.message || "生成失败" });
    }
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") return send(res, 200, { ok: true, imageParserAgent: IMAGE_PARSER_AGENT_ID, agents: AGENT_IDS });
  await serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`分类目成片 Prompt 工作台已启动：http://127.0.0.1:${PORT}`);
});

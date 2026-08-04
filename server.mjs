import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4317);
const AGENT_ID = process.env.LABELGPT_AGENT_ID || "7670004447182864427";
const SPACE_ID = process.env.LABELGPT_SPACE_ID || "115";
const LABELGPT_CLI = process.env.LABELGPT_CLI_PATH || path.join(homedir(), ".local/bin/labelgpt-cli");
const LABELGPT_WORKDIR = process.env.LABELGPT_WORKDIR || path.join(homedir(), "Documents/临时任务");
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
  return [
    `商品名称：${input.productName}`,
    `适用人群：${input.audience}`,
    `标准主痛点：${input.painPoint}`,
    `核心卖点：${input.sellingPoint}`,
    `商品质地：${input.texture}`,
  ].join("\n");
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
  for (const key of ["productName", "audience", "painPoint", "sellingPoint", "texture", "imageDataUrl"]) {
    if (!String(input[key] || "").trim()) throw new Error("请完整填写商品信息并上传商品图");
  }
  const imageUrl = await uploadImage(input.imageDataUrl, input.imageName);
  const params = JSON.stringify({ userPrompt: buildCustomerInfo(input), imagetest: imageUrl });
  const debugResult = await runCli([
    "agent", "debug", "--id", AGENT_ID,
    "--input", params,
    "--space-id", SPACE_ID, "--format", "json",
    "--wait-timeout", "5m", "--poll-interval", "2s", "--timeout", "1m",
  ]);
  const result = findResult(debugResult);
  if (result) return { prompt: result, taskUuid: debugResult.debug_id || null };
  if (debugResult.timed_out) throw new Error("生成时间超过 5 分钟，请稍后重试");
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
  if (req.method === "GET" && req.url === "/api/health") return send(res, 200, { ok: true, agentId: AGENT_ID });
  await serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`洗发水成片 Prompt 工作台已启动：http://127.0.0.1:${PORT}`);
});

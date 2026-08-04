import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:4317";
const cases = [
  {
    name: "洗发水痛点机制",
    image: process.env.SHAMPOO_TEST_IMAGE,
    input: {
      category: "shampoo",
      routine: "pain",
      productName: "青少年清爽洗发水",
      audience: "运动后发根容易油塌的青少年",
      painPoint: "头皮出油、异味或发根扁塌",
      sellingPoint: "温和清洁头皮和发丝，洗后清爽；不提供长效控油承诺",
      texture: "浅绿色透明啫喱，遇水形成细密泡沫",
      customerScript: "运动完发根很容易贴住，我更想把头皮和发丝认真洗干净。",
    },
  },
  {
    name: "面霜场景口播",
    expectedPackageText: "FACE CREAM",
    image: process.env.CREAM_TEST_IMAGE,
    input: {
      category: "cream",
      routine: "scene",
      productName: "MIMO 儿童面霜",
      audience: "换季脸颊容易干燥的儿童与家长",
      painPoint: "干燥缺水",
      sellingPoint: "日常保湿，帮助缓解洗脸后的干燥紧绷感",
      texture: "乳白色细腻膏霜，推开后轻薄有光泽",
      customerScript: "洗完脸孩子总说脸有点紧，我习惯取一点，先点在两边脸颊，再轻轻推开。",
    },
  },
  {
    name: "洗面奶痛点机制",
    expectedPackageText: "GENTLE CLEANSER",
    image: process.env.CLEANSER_TEST_IMAGE,
    input: {
      category: "cleanser",
      routine: "pain",
      productName: "MIMO 温和洁面乳",
      audience: "运动后额头鼻翼容易出油的青少年",
      painPoint: "出油或表面污垢",
      sellingPoint: "温和清洁面部表面油脂和污垢，洗后清爽",
      texture: "乳白色乳霜质地，加水形成细密泡沫",
      customerScript: "运动后鼻翼会有油光，加水揉出泡沫，再轻轻打圈冲洗。",
    },
  },
].filter(test => test.image);

if (!cases.length) throw new Error("至少设置一个 *_TEST_IMAGE 环境变量");

async function dataUrl(file) {
  const bytes = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function run(test) {
  const requestBody = JSON.stringify({
      ...test.input,
      imageDataUrl: await dataUrl(test.image),
      imageName: path.basename(test.image),
  });
  const payload = await new Promise((resolve, reject) => {
    const target = new URL("/api/generate", BASE_URL);
    const request = http.request(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(requestBody) },
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if ((response.statusCode || 500) >= 400) return reject(new Error(`${test.name}：${parsed.error || "生成失败"}`));
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(11 * 60 * 1000, () => request.destroy(new Error(`${test.name}：等待超过11分钟`)));
    request.on("error", reject);
    request.end(requestBody);
  });
  const prompt = String(payload.prompt || "");
  const checks = {
    length: prompt.length,
    hasTimeline: /0.{0,2}(到|至|—|-)4秒/.test(prompt),
    hasSeedanceShape: prompt.includes("9:16") && prompt.includes("30秒"),
    noPlaceholder: !prompt.includes("{{") && !prompt.includes("待确认"),
    preservesPackageText: test.expectedPackageText ? prompt.includes(test.expectedPackageText) : true,
    mechanismExplicit: test.input.routine === "pain" ? /原理示意|抽象视觉示意/.test(prompt) && prompt.includes("表层") : true,
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`${test.name}：输出未满足成片格式，${JSON.stringify(checks)}；返回：${prompt.slice(0, 220)}`);
  }
  return { name: test.name, checks, taskUuid: payload.taskUuid, preview: prompt.slice(0, 180) };
}

const settled = await Promise.allSettled(cases.map(run));
console.log(JSON.stringify(settled.map((item, index) => item.status === "fulfilled"
  ? { status: "passed", ...item.value }
  : { status: "failed", name: cases[index].name, error: item.reason.message }), null, 2));
if (settled.some(item => item.status === "rejected")) process.exitCode = 1;

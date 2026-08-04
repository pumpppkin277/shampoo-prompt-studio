const form = document.querySelector("#prompt-form");
const imageInput = document.querySelector("#product-image");
const preview = document.querySelector("#preview");
const removeImage = document.querySelector("#remove-image");
const emptyState = document.querySelector("#empty-state");
const loadingState = document.querySelector("#loading-state");
const loadingTitle = document.querySelector("#loading-title");
const result = document.querySelector("#result");
const errorBox = document.querySelector("#error");
const generateButton = document.querySelector("#generate-button");
const copyButton = document.querySelector("#copy-button");
const categorySelect = document.querySelector("#category-select");
const routineSelect = document.querySelector("#routine-select");
const painPointSelect = document.querySelector("#pain-point");
const routePill = document.querySelector("#route-pill");
const routePreview = document.querySelector("#route-preview");
const productName = document.querySelector("#product-name");
const audience = document.querySelector("#audience");
const texture = document.querySelector("#texture");
let imageDataUrl = "";

const categoryConfig = {
  shampoo: {
    label: "洗发水",
    pains: ["头皮出油、异味或发根扁塌", "头屑、头痒或头皮敏感", "毛躁、打结或易断"],
    product: "例如：青少年清爽洗发水",
    audience: "例如：运动后容易油塌的青少年",
    texture: "例如：浅绿色透明啫喱，遇水形成细密泡沫",
  },
  cream: {
    label: "面霜",
    pains: ["干燥缺水", "干燥起皮或轻度皲裂", "泛红敏感", "痘痘或问题肌护理顾虑"],
    product: "例如：儿童秋冬保湿面霜",
    audience: "例如：换季脸颊容易干燥的儿童与家长",
    texture: "例如：乳白色细腻膏霜，推开后轻薄有光泽",
  },
  cleanser: {
    label: "洗面奶",
    pains: ["出油或表面污垢", "洗后干燥紧绷", "敏感刺激", "痘痘黑头或毛孔污垢"],
    product: "例如：青少年温和洁面乳",
    audience: "例如：运动后额头鼻翼容易出油的青少年",
    texture: "例如：乳白色乳霜质地，加水形成细密泡沫",
  },
};

const routineConfig = {
  scene: {
    pill: "场景口播 × 产品吸睛 × 使用演示",
    preview: "从真实生活场景切入，完成商品创意露出、正确使用和自然结果。",
  },
  pain: {
    pill: "痛点呈现 × 功效机制可视化",
    preview: "聚焦一个可观察痛点，用商品事实支持的一条机制完成解释闭环。",
  },
};

function updateRoute() {
  const category = categoryConfig[categorySelect.value];
  const routine = routineConfig[routineSelect.value];
  painPointSelect.innerHTML = '<option value="">请选择一个核心痛点</option>' + category.pains.map(pain => `<option>${pain}</option>`).join("");
  productName.placeholder = category.product;
  audience.placeholder = category.audience;
  texture.placeholder = category.texture;
  routePill.textContent = `${category.label} · ${routine.pill}`;
  routePreview.textContent = routine.preview;
}

categorySelect.addEventListener("change", updateRoute);
routineSelect.addEventListener("change", updateRoute);
updateRoute();

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("商品图读取失败"));
    reader.readAsDataURL(file);
  });
}

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    imageInput.value = "";
    alert("商品图片不能超过 10MB");
    return;
  }
  imageDataUrl = await readFile(file);
  preview.src = imageDataUrl;
  preview.hidden = false;
  removeImage.hidden = false;
});

removeImage.addEventListener("click", event => {
  event.preventDefault();
  imageInput.value = "";
  imageDataUrl = "";
  preview.src = "";
  preview.hidden = true;
  removeImage.hidden = true;
});

function setView(view) {
  emptyState.hidden = view !== "empty";
  loadingState.hidden = view !== "loading";
  result.hidden = view !== "result";
  errorBox.hidden = view !== "error";
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!imageDataUrl) {
    imageInput.focus();
    alert("请先上传商品图");
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  data.imageDataUrl = imageDataUrl;
  data.imageName = imageInput.files?.[0]?.name || "product.png";
  generateButton.disabled = true;
  copyButton.disabled = true;
  loadingTitle.textContent = "正在解析商品图与包装文字";
  setView("loading");
  const titleTimer = setTimeout(() => (loadingTitle.textContent = data.customerScript?.trim() ? "正在理解并融合客户脚本" : "正在整理商品事实"), 50000);
  const compileTimer = setTimeout(() => (loadingTitle.textContent = data.routine === "pain" ? "正在编排痛点与机制闭环" : "正在编排 30 秒成片"), 110000);
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "生成失败");
    result.textContent = payload.prompt;
    setView("result");
    copyButton.disabled = false;
  } catch (error) {
    errorBox.textContent = `${error.message}。请检查商品信息后重新生成。`;
    setView("error");
  } finally {
    clearTimeout(titleTimer);
    clearTimeout(compileTimer);
    generateButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(result.textContent);
  const original = copyButton.textContent;
  copyButton.textContent = "已复制";
  setTimeout(() => (copyButton.textContent = original), 1600);
});

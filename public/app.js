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
let imageDataUrl = "";

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
  loadingTitle.textContent = "正在解析商品图";
  setView("loading");
  const titleTimer = setTimeout(() => (loadingTitle.textContent = "正在编排 30 秒成片"), 5000);
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
    generateButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(result.textContent);
  const original = copyButton.textContent;
  copyButton.textContent = "已复制";
  setTimeout(() => (copyButton.textContent = original), 1600);
});

const MODELSLAB_BASE = "https://modelslab.com/api/v7/images";
const MODELSLAB_BASE64_TO_URL = "https://modelslab.com/api/v6/base64_to_url";
const MODELSLAB_VIDEO_BASE = "https://modelslab.com/api/v7/video-fusion";
const MODELSLAB_VIDEO_FETCH_ENDPOINTS = [
  { url: "https://modelslab.com/api/v7/video-fusion/fetch/{id}", mode: "path_id" },
  { url: "https://modelslab.com/api/v6/video/fetch/{id}", mode: "path_id" },
];

// Keep an allowlist so the endpoint can't be abused as an open relay.
const ALLOWED_T2I_MODELS = new Set([
  "nano-banana-pro",
  "seedream-4.5",
]);
const ALLOWED_I2V_MODELS = new Set(["grok-imagine-video-i2v"]);
const VIDEO_ASPECT_RATIO_ALLOWED = new Set(["16:9", "4:3", "1:1", "9:16", "3:4", "3:2", "2:3"]);
const VIDEO_RESOLUTION_ALLOWED = new Set(["720p", "480p"]);
const INLINE_VIDEO_RESULT_CACHE = new Map();

const FETCH_ENDPOINTS = [
  "https://modelslab.com/api/v7/images/fetch",
  "https://modelslab.com/api/v6/images/fetch",
];

function extractImageUrls(payload) {
  const candidates = [];
  if (Array.isArray(payload?.output)) candidates.push(...payload.output);
  else if (payload?.output && typeof payload.output === "object") candidates.push(...Object.values(payload.output));

  if (Array.isArray(payload?.proxy_links)) candidates.push(...payload.proxy_links);
  else if (payload?.proxy_links && typeof payload.proxy_links === "object") candidates.push(...Object.values(payload.proxy_links));

  if (payload?.data?.output) {
    if (Array.isArray(payload.data.output)) candidates.push(...payload.data.output);
    else if (typeof payload.data.output === "object") candidates.push(...Object.values(payload.data.output));
  }

  if (payload?.result?.output) {
    if (Array.isArray(payload.result.output)) candidates.push(...payload.result.output);
    else if (typeof payload.result.output === "object") candidates.push(...Object.values(payload.result.output));
  }

  return candidates.filter((u) => typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://")));
}

function extractVideoUrls(payload, { includeFutureLinks = true } = {}) {
  const candidates = [];
  if (Array.isArray(payload?.output)) candidates.push(...payload.output);
  else if (typeof payload?.output === "string") candidates.push(payload.output);
  else if (payload?.output && typeof payload.output === "object") candidates.push(...Object.values(payload.output));

  if (includeFutureLinks) {
    if (Array.isArray(payload?.future_links)) candidates.push(...payload.future_links);
    else if (payload?.future_links && typeof payload.future_links === "object") candidates.push(...Object.values(payload.future_links));
  }

  if (Array.isArray(payload?.proxy_links)) candidates.push(...payload.proxy_links);
  else if (payload?.proxy_links && typeof payload.proxy_links === "object") candidates.push(...Object.values(payload.proxy_links));

  return candidates.filter((u) => typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://")));
}

function isContentBlocked(payload) {
  if (payload?.nsfw_content_detected === true) return true;
  const msg = String(payload?.message || payload?.messege || payload?.tip || "").toLowerCase();
  return msg.includes("policy") || msg.includes("nsfw") || msg.includes("blocked") || msg.includes("moderat");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitizePrompt(prompt) {
  return String(prompt || "").replace(/\0/g, "").trim();
}

// Default init image for models that require an input image (e.g. nano-banana-pro).
// JPEG is used because some providers/models reject/struggle with PNG inputs.
const DEFAULT_INIT_JPEG =
  "data:image/jpeg;base64," +
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAEAAQADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3CiiigC/RRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFAH/2Q==";

function normalizeInitImages(initImage) {
  if (!initImage) return [];
  if (Array.isArray(initImage)) {
    return initImage.filter((v) => typeof v === "string" && v.trim());
  }
  if (typeof initImage === "string" && initImage.trim()) return [initImage];
  return [];
}

async function safeJson(res) {
  const text = await res.text();
  try {
    return { ok: true, data: JSON.parse(text), text };
  } catch {
    return { ok: false, data: null, text };
  }
}

const base64UrlCache = new Map();

async function base64ToUrl(apiKey, base64String) {
  const key = String(apiKey || "");
  const b64 = String(base64String || "");
  if (!key || !b64) throw new Error("Missing key or base64_string.");

  const cached = base64UrlCache.get(b64);
  if (cached) return cached;

  const res = await fetch(MODELSLAB_BASE64_TO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, base64_string: b64 }),
    signal: AbortSignal.timeout?.(60000),
  });

  const parsed = await safeJson(res);
  if (!res.ok || !parsed.ok) {
    throw new Error(`base64_to_url failed (HTTP ${res.status}).`);
  }

  const url = parsed.data?.output?.[0];
  if (!url || typeof url !== "string") {
    throw new Error("base64_to_url returned no URL.");
  }

  base64UrlCache.set(b64, url);
  return url;
}

export async function modelslabBase64ToUrl(base64String) {
  const key = getModelsLabKey();
  if (!key) throw new Error("MODELSLAB_API_KEY is not set.");
  return await base64ToUrl(key, base64String);
}

async function ensureInitImageUrls(apiKey, images) {
  const out = [];
  for (const img of images) {
    const s = String(img || "").trim();
    if (!s) continue;
    if (s.startsWith("data:")) {
      // Convert data URIs (base64) to a temporary URL usable by image-to-image endpoints.
      // Docs: POST /api/v6/base64_to_url (URL expires ~24h).
      // eslint-disable-next-line no-await-in-loop
      out.push(await base64ToUrl(apiKey, s));
    } else {
      out.push(s);
    }
  }
  return out;
}

async function pollByFetchResult(apiKey, fetchUrl, { correlationId = "poll" } = {}) {
  const start = Date.now();
  const maxAttempts = 30;
  let lastPayload = null;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(4000);
    try {
      const res = await fetch(fetchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: apiKey }),
        signal: AbortSignal.timeout?.(30000),
      });

      const parsed = await safeJson(res);
      if (!parsed.ok) continue;
      const payload = parsed.data;
      lastPayload = payload;

      const urls = extractImageUrls(payload);
      if (urls.length > 0) {
        return { success: true, urls, latencyMs: Date.now() - start, lastPayload };
      }

      if (payload?.status === "failed" || payload?.status === "error") {
        const msg = payload?.message || payload?.messege || "Generation failed";
        if (isContentBlocked(payload)) {
          return { success: false, urls: [], errorCode: "CONTENT_BLOCKED", errorMessage: msg, latencyMs: Date.now() - start, lastPayload };
        }
        return { success: false, urls: [], errorCode: "PROVIDER_FAILED", errorMessage: msg, latencyMs: Date.now() - start, lastPayload };
      }
    } catch {
      // ignore and keep polling
    }
  }

  return { success: false, urls: [], errorCode: "PROVIDER_PROCESSING_TIMEOUT", errorMessage: `Timed out (${correlationId})`, latencyMs: Date.now() - start, lastPayload };
}

async function pollById(apiKey, requestId, { correlationId = "id-poll" } = {}) {
  const start = Date.now();
  const maxAttempts = 25;
  let lastPayload = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(2000);

    for (const endpoint of FETCH_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: apiKey, request_id: String(requestId) }),
          signal: AbortSignal.timeout?.(30000),
        });

        const parsed = await safeJson(res);
        if (!parsed.ok) continue;

        const payload = parsed.data;
        lastPayload = payload;

        const urls = extractImageUrls(payload);
        if (urls.length > 0) {
          return { success: true, urls, latencyMs: Date.now() - start, lastPayload };
        }

        if (payload?.status === "failed" || payload?.status === "error") {
          const msg = payload?.message || payload?.messege || "Generation failed";
          if (isContentBlocked(payload)) {
            return { success: false, urls: [], errorCode: "CONTENT_BLOCKED", errorMessage: msg, latencyMs: Date.now() - start, lastPayload };
          }
          return { success: false, urls: [], errorCode: "PROVIDER_FAILED", errorMessage: msg, latencyMs: Date.now() - start, lastPayload };
        }

        break;
      } catch {
        // try next endpoint
      }
    }
  }

  return { success: false, urls: [], errorCode: "PROVIDER_PROCESSING_TIMEOUT", errorMessage: `Timed out (${correlationId})`, latencyMs: Date.now() - start, lastPayload };
}

export async function fetchModelsLabResult(apiKey, initialData, { correlationId = "fetch" } = {}) {
  const start = Date.now();
  const providerRequestId = initialData?.id || initialData?.request_id;

  if (initialData?.status === "error" || initialData?.status === "failed") {
    const msg = initialData?.message || initialData?.messege || "Generation failed";
    if (isContentBlocked(initialData)) {
      return { success: false, urls: [], errorCode: "CONTENT_BLOCKED", errorMessage: msg, latencyMs: Date.now() - start, requestId: providerRequestId, lastPayload: initialData };
    }
    return { success: false, urls: [], errorCode: "PROVIDER_FAILED", errorMessage: msg, latencyMs: Date.now() - start, requestId: providerRequestId, lastPayload: initialData };
  }

  const immediateUrls = extractImageUrls(initialData);
  if (immediateUrls.length > 0) {
    return { success: true, urls: immediateUrls, latencyMs: Date.now() - start, requestId: providerRequestId, lastPayload: initialData };
  }

  if (initialData?.status === "processing" && initialData?.fetch_result) {
    const polled = await pollByFetchResult(apiKey, initialData.fetch_result, { correlationId });
    return { ...polled, requestId: providerRequestId };
  }

  if (providerRequestId && (initialData?.status === "success" || initialData?.status === "processing")) {
    const polled = await pollById(apiKey, providerRequestId, { correlationId });
    return { ...polled, requestId: providerRequestId };
  }

  return { success: false, urls: [], errorCode: "PROVIDER_FAILED", errorMessage: "Unexpected provider response.", latencyMs: Date.now() - start, requestId: providerRequestId, lastPayload: initialData };
}

export function getModelsLabKey() {
  return process.env.MODELSLAB_API_KEY || "";
}

export function getModelsLabModelId() {
  const env = String(process.env.MODELSLAB_IMAGEGEN_MODEL_ID || "").trim();
  if (ALLOWED_T2I_MODELS.has(env)) return env;
  return "nano-banana-pro";
}

export function getModelsLabVideoModelId() {
  const env = String(process.env.MODELSLAB_VIDEO_MODEL_ID || "").trim();
  if (ALLOWED_I2V_MODELS.has(env)) return env;
  return "grok-imagine-video-i2v";
}

function pickI2VModelId(requested) {
  const candidate = String(requested || "").trim();
  if (ALLOWED_I2V_MODELS.has(candidate)) return candidate;
  return getModelsLabVideoModelId();
}

function normalizeVideoDuration(duration) {
  return Math.min(Math.max(Number(duration) || 5, 1), 15);
}

function normalizeVideoResolution(resolution) {
  const raw = String(resolution || "").trim().toLowerCase();
  return VIDEO_RESOLUTION_ALLOWED.has(raw) ? raw : "720p";
}

function normalizeVideoAspectRatio(aspectRatio) {
  const raw = String(aspectRatio || "").trim();
  return VIDEO_ASPECT_RATIO_ALLOWED.has(raw) ? raw : "16:9";
}

function sanitizeVideoPrompt(prompt) {
  const userPrompt = String(prompt || "").replace(/\0/g, "").trim();
  const lockRules = [
    "Use the reference image as the exact same person and base frame.",
    "Keep face, hair, body, outfit, and background identity consistent.",
    "Only animate motion and camera subtly; do not replace the person.",
  ].join(" ");
  return userPrompt ? `${lockRules} ${userPrompt}` : lockRules;
}

export async function modelslabGenerateVideo({
  prompt,
  imageUrl,
  duration = 5,
  aspect_ratio = "16:9",
  resolution = "720p",
  modelId,
}) {
  const key = getModelsLabKey();
  if (!key) {
    return { success: false, error: "MODELSLAB_API_KEY is not set." };
  }

  let initImages = [];
  try {
    initImages = await ensureInitImageUrls(key, normalizeInitImages(imageUrl));
  } catch (e) {
    return {
      success: false,
      error:
        e instanceof Error
          ? e.message
          : "Nao foi possivel preparar a imagem de referencia para video (png/jpg/webp).",
    };
  }

  if (!initImages.length) {
    return { success: false, error: "Imagem de referencia obrigatoria para image-to-video." };
  }

  const requestedDuration = normalizeVideoDuration(duration);

  const body = {
    key,
    model_id: pickI2VModelId(modelId),
    prompt: sanitizeVideoPrompt(prompt),
    init_image: initImages[0],
    duration: requestedDuration,
    aspect_ratio: normalizeVideoAspectRatio(aspect_ratio),
    resolution: normalizeVideoResolution(resolution),
  };

  const sendGenerate = async (payload) => {
    const res = await fetch(`${MODELSLAB_VIDEO_BASE}/image-to-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout?.(120000),
    });
    const parsed = await safeJson(res);
    if (!res.ok || !parsed.ok) {
      return {
        ok: false,
        error: `ModelsLab HTTP ${res.status}`,
        providerStatus: String(res.status),
        parsed,
      };
    }
    return { ok: true, parsed, providerStatus: String(res.status) };
  };

  let generated = await sendGenerate(body);
  if (!generated.ok) {
    return {
      success: false,
      error: generated.error,
      providerStatus: generated.providerStatus,
    };
  }

  const providerStatus = String(generated.parsed.data?.status || generated.parsed.data?.state || "").toLowerCase();

  if (providerStatus === "error" || providerStatus === "failed") {
    const msg =
      String(generated.parsed.data?.message || generated.parsed.data?.messege || "").trim() ||
      (generated.parsed.data?.errors ? JSON.stringify(generated.parsed.data.errors) : "Video generation failed.");
    return { success: false, error: msg };
  }

  const requestId = generated.parsed.data?.id || generated.parsed.data?.request_id || "";
  const immediate = extractVideoUrls(generated.parsed.data, { includeFutureLinks: true });
  if (immediate.length > 0 && !requestId) {
    const inlineId = `modelslab:inline:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    INLINE_VIDEO_RESULT_CACHE.set(inlineId, { url: immediate[0], createdAt: Date.now() });
    return {
      success: true,
      request_id: inlineId,
      video_url: immediate[0],
    };
  }

  if (!requestId) {
    return {
      success: false,
      error: `ModelsLab retornou resposta sem request_id. Keys: ${Object.keys(generated.parsed.data || {}).join(", ")}`,
    };
  }

  return { success: true, request_id: `modelslab:${String(requestId)}` };
}

export async function modelslabVideoStatus({ requestId }) {
  const key = getModelsLabKey();
  if (!key) {
    return { status: "error", error: "MODELSLAB_API_KEY is not set." };
  }

  const raw = String(requestId || "").trim();
  if (!raw) return { status: "error", error: "Missing request id." };
  if (raw.startsWith("modelslab:inline:")) {
    const cached = INLINE_VIDEO_RESULT_CACHE.get(raw);
    if (cached?.url) return { status: "done", video: { url: String(cached.url) } };
    return { status: "error", error: "Inline result not found." };
  }
  const providerRequestId = raw.startsWith("modelslab:") ? raw.slice("modelslab:".length) : raw;
  if (!providerRequestId) return { status: "error", error: "Missing provider request id." };

  let lastError = "";
  for (const endpoint of MODELSLAB_VIDEO_FETCH_ENDPOINTS) {
    try {
      const url =
        endpoint.mode === "path_id"
          ? endpoint.url.replace("{id}", encodeURIComponent(String(providerRequestId)))
          : endpoint.url;
      const body =
        endpoint.mode === "path_id"
          ? { key }
          : { key, request_id: providerRequestId };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout?.(30000),
      });
      const parsed = await safeJson(res);
      if (!res.ok || !parsed.ok) {
        lastError = `ModelsLab fetch HTTP ${res.status}`;
        continue;
      }

      const payload = parsed.data;
      const status = String(payload?.status || payload?.state || "").toLowerCase();
      const readyStatuses = new Set(["done", "success", "succeeded", "completed"]);
      if (readyStatuses.has(status)) {
        const doneUrls = extractVideoUrls(payload, { includeFutureLinks: true });
        if (doneUrls.length > 0) {
          return { status: "done", video: { url: String(doneUrls[0]) } };
        }
        return { status: "error", error: "ModelsLab retornou status pronto sem URL de video." };
      }

      if (!status) {
        const doneUrls = extractVideoUrls(payload, { includeFutureLinks: false });
        if (doneUrls.length > 0) {
          return { status: "done", video: { url: String(doneUrls[0]) } };
        }
      }

      if (status === "failed" || status === "error") {
        return { status: "error", error: String(payload?.message || payload?.messege || "Video generation failed.") };
      }
      if (status === "expired") {
        return { status: "expired", error: String(payload?.message || payload?.messege || "Video request expired.") };
      }

      return { status: "pending" };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "Unknown fetch error";
    }
  }

  return { status: "error", error: lastError || "ModelsLab video status unavailable." };
}

function pickT2IModelId(requested) {
  const candidate = String(requested || "").trim();
  if (ALLOWED_T2I_MODELS.has(candidate)) return candidate;
  return getModelsLabModelId();
}

export async function modelslabTextToImage({ prompt, aspectRatio = "1:1", modelId, initImage }) {
  const key = getModelsLabKey();
  if (!key) {
    return { success: false, urls: [], errorCode: "MISSING_API_KEY", errorMessage: "MODELSLAB_API_KEY is not set.", latencyMs: 0 };
  }

  const pickedModelId = pickT2IModelId(modelId);

  const requestBody = {
    key,
    model_id: pickedModelId,
    prompt: sanitizePrompt(prompt),
    aspect_ratio: aspectRatio || "1:1",
  };

  // ModelsLab docs/examples vary per model. Nano Banana Pro commonly uses image-to-image for pure generation too.
  const endpoint = pickedModelId === "nano-banana-pro"
    ? `${MODELSLAB_BASE}/image-to-image`
    : `${MODELSLAB_BASE}/text-to-image`;

  if (pickedModelId === "nano-banana-pro") {
    const images = normalizeInitImages(initImage);
    const rawImages = images.length > 0 ? images : [DEFAULT_INIT_JPEG];
    try {
      requestBody.init_image = await ensureInitImageUrls(key, rawImages);
    } catch (e) {
      return {
        success: false,
        urls: [],
        errorCode: "BASE64_TO_URL_FAILED",
        errorMessage: e instanceof Error ? e.message : "Failed to prepare init image.",
        latencyMs: 0,
      };
    }
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout?.(120000),
  });

  const parsed = await safeJson(res);
  if (!res.ok || !parsed.ok) {
    return {
      success: false,
      urls: [],
      errorCode: "UPSTREAM_HTTP_ERROR",
      errorMessage: `ModelsLab HTTP ${res.status}`,
      latencyMs: 0,
      providerStatus: String(res.status),
    };
  }

  return await fetchModelsLabResult(key, parsed.data, { correlationId: `t2i:${pickedModelId}` });
}

export async function modelslabImageToImage({ prompt, image, aspectRatio = "1:1" }) {
  const key = getModelsLabKey();
  if (!key) {
    return { success: false, urls: [], errorCode: "MISSING_API_KEY", errorMessage: "MODELSLAB_API_KEY is not set.", latencyMs: 0 };
  }

  let initImages = [];
  try {
    initImages = await ensureInitImageUrls(key, normalizeInitImages(image));
  } catch (e) {
    return {
      success: false,
      urls: [],
      errorCode: "BASE64_TO_URL_FAILED",
      errorMessage: e instanceof Error ? e.message : "Failed to prepare init image.",
      latencyMs: 0,
    };
  }

  if (initImages.length === 0) {
    return { success: false, urls: [], errorCode: "VALIDATION", errorMessage: "Image is required.", latencyMs: 0 };
  }

  const body = {
    key,
    model_id: "grok-imagine-image-i2i",
    prompt: sanitizePrompt(prompt),
    init_image: initImages,
    aspect_ratio: aspectRatio && aspectRatio !== "auto" ? aspectRatio : "1:1",
  };

  const res = await fetch(`${MODELSLAB_BASE}/image-to-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout?.(120000),
  });

  const parsed = await safeJson(res);
  if (!res.ok || !parsed.ok) {
    return {
      success: false,
      urls: [],
      errorCode: "UPSTREAM_HTTP_ERROR",
      errorMessage: `ModelsLab HTTP ${res.status}`,
      latencyMs: 0,
      providerStatus: String(res.status),
    };
  }

  return await fetchModelsLabResult(key, parsed.data, { correlationId: "i2i" });
}

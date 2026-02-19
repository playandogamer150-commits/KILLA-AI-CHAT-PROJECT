import { modelslabBase64ToUrl } from "./modelslab.js";

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const DEFAULT_REPLICATE_MODEL = "stability-ai/sdxl";
const DEFAULT_REPLICATE_VIDEO_MODEL = "xai/grok-imagine-video";
const VIDEO_ASPECT_RATIO_ALLOWED = new Set(["16:9", "4:3", "1:1", "9:16", "3:4", "3:2", "2:3"]);
const VIDEO_RESOLUTION_ALLOWED = new Set(["720p", "480p"]);
const VIDEO_IMAGE_MIME_ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizePrompt(prompt) {
  return String(prompt || "").replace(/\0/g, "").trim();
}

function buildIdentityLockedVideoPrompt(prompt) {
  const userPrompt = sanitizePrompt(prompt);
  const lockRules = [
    "Reference image identity lock:",
    "treat the uploaded reference image as the same person and scene anchor.",
    "Preserve face structure, skin tone, hair, body shape, age impression, and outfit details.",
    "Do not change identity, gender, ethnicity, hairstyle, or clothing unless explicitly requested.",
    "Only animate motion, camera movement, lighting and environment dynamics consistent with the reference.",
    "If any instruction conflicts with identity lock, prioritize identity preservation.",
  ].join(" ");

  return userPrompt ? `${lockRules} ${userPrompt}` : lockRules;
}

function normalizeAspectRatio(aspectRatio) {
  const raw = String(aspectRatio || "1:1").trim();
  if (/^\d+:\d+$/.test(raw)) {
    const [w, h] = raw.split(":").map((n) => Number(n));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { ratio: raw, width: Math.round((1024 * w) / h), height: 1024 };
    }
  }
  return { ratio: "1:1", width: 1024, height: 1024 };
}

function isContentBlockedFromText(text) {
  const msg = String(text || "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("nsfw") ||
    msg.includes("safety") ||
    msg.includes("policy") ||
    msg.includes("moderat") ||
    msg.includes("blocked")
  );
}

function extractUrlsFromOutput(output) {
  if (!output) return [];
  if (Array.isArray(output)) {
    return output.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u));
  }
  if (typeof output === "string" && /^https?:\/\//i.test(output)) return [output];

  if (typeof output === "object") {
    const values = Object.values(output);
    return values.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u));
  }

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

function getReplicateHeaders(token, wait = true) {
  const headers = {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
  };
  if (wait) headers.Prefer = "wait";
  return headers;
}

export function getReplicateToken() {
  return String(process.env.REPLICATE_API_TOKEN || "").trim();
}

export function getReplicateModelId() {
  const env = String(process.env.REPLICATE_IMAGE_MODEL_ID || "").trim();
  return env || DEFAULT_REPLICATE_MODEL;
}

export function getReplicateVideoModelId() {
  const env = String(process.env.REPLICATE_VIDEO_MODEL_ID || "").trim();
  return env || DEFAULT_REPLICATE_VIDEO_MODEL;
}

export async function replicateTextToImage({ prompt, aspectRatio = "1:1", modelId, negativePrompt }) {
  const token = getReplicateToken();
  if (!token) {
    return {
      success: false,
      urls: [],
      errorCode: "MISSING_API_KEY",
      errorMessage: "REPLICATE_API_TOKEN is not set.",
      latencyMs: 0,
    };
  }

  const model = String(modelId || getReplicateModelId()).trim();
  const cleanPrompt = sanitizePrompt(prompt);
  if (!cleanPrompt) {
    return {
      success: false,
      urls: [],
      errorCode: "VALIDATION",
      errorMessage: "Prompt is required.",
      latencyMs: 0,
    };
  }

  const start = Date.now();
  const timeoutAt = start + 120000;

  const ratio = normalizeAspectRatio(aspectRatio);
  const input = {
    prompt: cleanPrompt,
    negative_prompt: String(negativePrompt || "").trim() || undefined,
    width: ratio.width,
    height: ratio.height,
    num_outputs: 1,
  };

  try {
    // Resolve model version dynamically so callers can pass `owner/model`.
    const modelRes = await fetch(`${REPLICATE_API_BASE}/models/${encodeURIComponent(model)}`, {
      method: "GET",
      headers: {
        Authorization: `Token ${token}`,
      },
      signal: AbortSignal.timeout?.(30000),
    });

    const parsedModel = await safeJson(modelRes);
    if (!modelRes.ok || !parsedModel.ok) {
      return {
        success: false,
        urls: [],
        errorCode: "UPSTREAM_HTTP_ERROR",
        errorMessage: `Replicate model lookup failed (HTTP ${modelRes.status}).`,
        latencyMs: Date.now() - start,
      };
    }

    const version = parsedModel.data?.latest_version?.id;
    if (!version || typeof version !== "string") {
      return {
        success: false,
        urls: [],
        errorCode: "PROVIDER_FAILED",
        errorMessage: "Replicate model has no latest_version id.",
        latencyMs: Date.now() - start,
      };
    }

    const createRes = await fetch(`${REPLICATE_API_BASE}/predictions`, {
      method: "POST",
      headers: getReplicateHeaders(token),
      body: JSON.stringify({
        version,
        input,
      }),
      signal: AbortSignal.timeout?.(30000),
    });

    const createParsed = await safeJson(createRes);
    if (!createRes.ok || !createParsed.ok) {
      const errText = createParsed.data?.detail || createParsed.text || `HTTP ${createRes.status}`;
      return {
        success: false,
        urls: [],
        errorCode: isContentBlockedFromText(errText) ? "CONTENT_BLOCKED" : "UPSTREAM_HTTP_ERROR",
        errorMessage: `Replicate create failed: ${String(errText).slice(0, 240)}`,
        latencyMs: Date.now() - start,
      };
    }

    let prediction = createParsed.data;
    let status = String(prediction?.status || "").toLowerCase();
    const predictionId = String(prediction?.id || "");

    if (!predictionId) {
      return {
        success: false,
        urls: [],
        errorCode: "PROVIDER_FAILED",
        errorMessage: "Replicate returned no prediction id.",
        latencyMs: Date.now() - start,
      };
    }

    while (status !== "succeeded") {
      if (Date.now() >= timeoutAt) {
        return {
          success: false,
          urls: [],
          errorCode: "PROVIDER_PROCESSING_TIMEOUT",
          errorMessage: "Replicate prediction timed out after 120s.",
          latencyMs: Date.now() - start,
          requestId: predictionId,
        };
      }

      if (status === "failed" || status === "canceled" || status === "cancelled") {
        const errMsg = prediction?.error || prediction?.detail || "Replicate generation failed.";
        return {
          success: false,
          urls: [],
          errorCode: isContentBlockedFromText(errMsg) ? "CONTENT_BLOCKED" : "PROVIDER_FAILED",
          errorMessage: String(errMsg),
          latencyMs: Date.now() - start,
          requestId: predictionId,
        };
      }

      await sleep(2000);

      const pollRes = await fetch(`${REPLICATE_API_BASE}/predictions/${encodeURIComponent(predictionId)}`, {
        method: "GET",
        headers: {
          Authorization: `Token ${token}`,
        },
        signal: AbortSignal.timeout?.(30000),
      });

      const pollParsed = await safeJson(pollRes);
      if (!pollRes.ok || !pollParsed.ok) {
        return {
          success: false,
          urls: [],
          errorCode: "UPSTREAM_HTTP_ERROR",
          errorMessage: `Replicate poll failed (HTTP ${pollRes.status}).`,
          latencyMs: Date.now() - start,
          requestId: predictionId,
        };
      }

      prediction = pollParsed.data;
      status = String(prediction?.status || "").toLowerCase();
    }

    const urls = extractUrlsFromOutput(prediction?.output);
    if (urls.length === 0) {
      return {
        success: false,
        urls: [],
        errorCode: "PROVIDER_FAILED",
        errorMessage: "Replicate succeeded but returned no image URL.",
        latencyMs: Date.now() - start,
        requestId: predictionId,
      };
    }

    return {
      success: true,
      urls,
      latencyMs: Date.now() - start,
      requestId: predictionId,
    };
  } catch (e) {
    return {
      success: false,
      urls: [],
      errorCode: "PROVIDER_FAILED",
      errorMessage: e instanceof Error ? e.message : "Replicate request failed.",
      latencyMs: Date.now() - start,
    };
  }
}

function extractFirstUriFromOutput(output) {
  if (!output) return "";
  if (typeof output === "string" && /^https?:\/\//i.test(output)) return output;
  if (Array.isArray(output)) {
    const first = output.find((item) => typeof item === "string" && /^https?:\/\//i.test(item));
    return typeof first === "string" ? first : "";
  }
  if (typeof output === "object") {
    const values = Object.values(output);
    const first = values.find((item) => typeof item === "string" && /^https?:\/\//i.test(item));
    return typeof first === "string" ? first : "";
  }
  return "";
}

function normalizeVideoDuration(duration) {
  return Math.min(Math.max(Number(duration) || 10, 1), 15);
}

function normalizeVideoResolution(resolution) {
  const raw = String(resolution || "").trim().toLowerCase();
  return VIDEO_RESOLUTION_ALLOWED.has(raw) ? raw : "720p";
}

function normalizeVideoAspectRatio(aspectRatio) {
  const raw = String(aspectRatio || "").trim();
  return VIDEO_ASPECT_RATIO_ALLOWED.has(raw) ? raw : "16:9";
}

function extensionFromMime(mimeType) {
  const lower = String(mimeType || "").toLowerCase();
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("png")) return "png";
  if (lower.includes("webp")) return "webp";
  return "bin";
}

function isLikelyImageFormatError(text) {
  const msg = String(text || "").toLowerCase();
  return msg.includes("invalid image format") || msg.includes("supported formats") || msg.includes("unsupported image");
}

function isLikelyImageCandidateError(statusCode, text) {
  const msg = String(text || "").toLowerCase();
  if (isLikelyImageFormatError(msg)) return true;
  if (statusCode === 400 || statusCode === 422) return true;
  return (
    msg.includes("invalid image") ||
    msg.includes("unable to fetch") ||
    msg.includes("failed to fetch") ||
    (msg.includes("image") && msg.includes("url"))
  );
}

function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 12) return "";
  // JPEG magic bytes
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // PNG magic bytes
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  // WEBP magic bytes: RIFF....WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }
  return "";
}

function decodeImageDataUri(dataUri) {
  const raw = String(dataUri || "").trim();
  if (!raw.startsWith("data:")) throw new Error("Invalid data URI.");

  const commaIdx = raw.indexOf(",");
  if (commaIdx < 0) throw new Error("Malformed data URI.");

  const meta = raw.slice(5, commaIdx);
  const payload = raw.slice(commaIdx + 1);
  const parts = meta.split(";").filter(Boolean);
  const first = parts[0] || "";
  const declaredMime = first && !first.includes("=") ? first.toLowerCase() : "application/octet-stream";
  const isBase64 = parts.some((part) => part.toLowerCase() === "base64");

  const bytes = isBase64
    ? Buffer.from(payload.replace(/\s+/g, ""), "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");

  if (!bytes || bytes.length === 0) {
    throw new Error("Empty data URI payload.");
  }

  const sniffed = sniffImageMime(bytes);
  let mimeType = sniffed || declaredMime;
  if (mimeType === "image/jpg") mimeType = "image/jpeg";

  return { bytes, mimeType };
}

async function replicateDataUriToFileUrl(dataUri, token) {
  // Decode data URI directly (more robust than fetch(data:...) across Node runtimes).
  const { bytes, mimeType } = decodeImageDataUri(dataUri);
  if (!VIDEO_IMAGE_MIME_ALLOWED.has(mimeType)) {
    throw new Error(`Unsupported image MIME for video: ${mimeType}`);
  }

  const blob = new Blob([bytes], { type: mimeType });
  const ext = extensionFromMime(mimeType);

  const form = new FormData();
  form.append("content", blob, `input.${ext}`);

  const uploadRes = await fetch(`${REPLICATE_API_BASE}/files`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
    },
    body: form,
    signal: AbortSignal.timeout?.(45000),
  });

  const parsed = await safeJson(uploadRes);
  if (!uploadRes.ok || !parsed.ok) {
    throw new Error(`Replicate file upload failed (HTTP ${uploadRes.status}).`);
  }

  const fileUrl =
    parsed.data?.urls?.public ||
    parsed.data?.urls?.download ||
    parsed.data?.urls?.get ||
    parsed.data?.url;
  if (!fileUrl || typeof fileUrl !== "string") {
    throw new Error("Replicate file upload returned no file URL.");
  }
  return fileUrl;
}

export async function replicateGenerateVideo({
  prompt,
  imageUrl,
  duration = 10,
  aspect_ratio = "16:9",
  resolution = "720p",
  modelId,
}) {
  const token = getReplicateToken();
  if (!token) {
    return { success: false, error: "REPLICATE_API_TOKEN is not set." };
  }

  const cleanPrompt = sanitizePrompt(prompt);
  if (!cleanPrompt) {
    return { success: false, error: "Prompt is required." };
  }
  const finalPrompt = buildIdentityLockedVideoPrompt(cleanPrompt);

  const rawImageInput = String(imageUrl || "").trim();
  if (!rawImageInput) {
    return { success: false, error: "Image is required." };
  }

  const model = String(modelId || getReplicateVideoModelId()).trim();
  const modelRes = await fetch(`${REPLICATE_API_BASE}/models/${encodeURIComponent(model)}`, {
    method: "GET",
    headers: {
      Authorization: `Token ${token}`,
    },
    signal: AbortSignal.timeout?.(30000),
  });

  const parsedModel = await safeJson(modelRes);
  if (!modelRes.ok || !parsedModel.ok) {
    return { success: false, error: `Replicate model lookup failed (HTTP ${modelRes.status}).` };
  }

  const version = parsedModel.data?.latest_version?.id;
  if (!version || typeof version !== "string") {
    return { success: false, error: "Replicate model has no latest_version id." };
  }

  const imageCandidates = [];
  if (rawImageInput.startsWith("data:")) {
    // Prefer a public URL first (usually best compatibility for upstream providers).
    try {
      const modelslabUrl = await modelslabBase64ToUrl(rawImageInput);
      if (typeof modelslabUrl === "string" && /^https?:\/\//i.test(modelslabUrl)) {
        imageCandidates.push(modelslabUrl);
      }
    } catch {
      // ignore and try next strategy
    }

    // Replicate file upload fallback for data URIs.
    try {
      const fileUrl = await replicateDataUriToFileUrl(rawImageInput, token);
      if (typeof fileUrl === "string" && /^https?:\/\//i.test(fileUrl)) {
        imageCandidates.push(fileUrl);
      }
    } catch {
      // ignore and try next strategy
    }

    // Last resort: send data URI directly.
    imageCandidates.push(rawImageInput);
  } else {
    imageCandidates.push(rawImageInput);
  }

  const dedupedCandidates = [...new Set(imageCandidates.map((item) => String(item || "").trim()).filter(Boolean))];
  if (!dedupedCandidates.length) {
    return {
      success: false,
      error: "Nao foi possivel preparar a imagem de referencia para video (png/jpg/webp).",
    };
  }

  let lastErr = "";
  for (let idx = 0; idx < dedupedCandidates.length; idx++) {
    const candidate = dedupedCandidates[idx];
    const input = {
      prompt: finalPrompt,
      image: candidate,
      duration: normalizeVideoDuration(duration),
      aspect_ratio: normalizeVideoAspectRatio(aspect_ratio),
      resolution: normalizeVideoResolution(resolution),
    };

    const createRes = await fetch(`${REPLICATE_API_BASE}/predictions`, {
      method: "POST",
      headers: getReplicateHeaders(token, false),
      body: JSON.stringify({
        version,
        input,
      }),
      signal: AbortSignal.timeout?.(120000),
    });

    const createParsed = await safeJson(createRes);
    if (!createRes.ok || !createParsed.ok) {
      const statusCode = Number(createRes.status) || 0;
      const errText = createParsed.data?.detail || createParsed.text || `HTTP ${createRes.status}`;
      lastErr = String(errText).slice(0, 240);

      // Try the next image candidate when failure is likely candidate-specific.
      if (idx < dedupedCandidates.length - 1 && isLikelyImageCandidateError(statusCode, lastErr)) {
        continue;
      }

      return { success: false, error: `Replicate create failed: ${lastErr}` };
    }

    const prediction = createParsed.data || {};
    const predictionId = String(prediction?.id || "").trim();
    if (!predictionId) {
      lastErr = "Replicate returned no prediction id.";
      if (idx < dedupedCandidates.length - 1) continue;
      return { success: false, error: lastErr };
    }

    const immediateVideo = extractFirstUriFromOutput(prediction?.output);
    return {
      success: true,
      request_id: `replicate:${predictionId}`,
      video_url: immediateVideo || undefined,
    };
  }

  return { success: false, error: `Replicate create failed: ${lastErr || "unknown error"}` };
}

export async function replicateVideoStatus({ requestId }) {
  const token = getReplicateToken();
  if (!token) {
    return { status: "error", error: "REPLICATE_API_TOKEN is not set." };
  }

  const raw = String(requestId || "").trim();
  const predictionId = raw.startsWith("replicate:") ? raw.slice("replicate:".length) : raw;
  if (!predictionId) return { status: "error", error: "Missing request id." };

  const pollRes = await fetch(`${REPLICATE_API_BASE}/predictions/${encodeURIComponent(predictionId)}`, {
    method: "GET",
    headers: {
      Authorization: `Token ${token}`,
    },
    signal: AbortSignal.timeout?.(30000),
  });

  const pollParsed = await safeJson(pollRes);
  if (!pollRes.ok || !pollParsed.ok) {
    return { status: "error", error: `Replicate status failed (HTTP ${pollRes.status}).` };
  }

  const prediction = pollParsed.data || {};
  const status = String(prediction?.status || "").toLowerCase();

  if (status === "succeeded") {
    const url = extractFirstUriFromOutput(prediction?.output);
    if (!url) return { status: "error", error: "Replicate succeeded but returned no video URL." };
    return { status: "done", video: { url } };
  }

  if (status === "failed" || status === "canceled" || status === "cancelled") {
    const err = prediction?.error || prediction?.detail || "Replicate generation failed.";
    return { status: "error", error: String(err) };
  }

  return { status: "pending" };
}

const REPLICATE_API_BASE = "https://api.replicate.com/v1";
const DEFAULT_REPLICATE_MODEL = "stability-ai/sdxl";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizePrompt(prompt) {
  return String(prompt || "").replace(/\0/g, "").trim();
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

function getReplicateHeaders(token) {
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
    Prefer: "wait",
  };
}

export function getReplicateToken() {
  return String(process.env.REPLICATE_API_TOKEN || "").trim();
}

export function getReplicateModelId() {
  const env = String(process.env.REPLICATE_IMAGE_MODEL_ID || "").trim();
  return env || DEFAULT_REPLICATE_MODEL;
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


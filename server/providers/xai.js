import { modelslabBase64ToUrl } from "./modelslab.js";

const XAI_BASE = "https://api.x.ai/v1";

export function getXaiKey() {
  return process.env.XAI_API_KEY || "";
}

function buildIdentityLockedVideoPrompt(prompt) {
  const userPrompt = String(prompt || "").trim();
  const lockRules = [
    "Reference image identity lock:",
    "use the provided reference image as frame zero and keep the same person.",
    "Preserve face structure, skin tone, hair, body shape, age impression, and outfit details.",
    "Do not change identity, gender, ethnicity, hairstyle, or clothing unless explicitly requested.",
    "Only animate motion, camera movement, lighting and environment dynamics consistent with the reference.",
    "If any instruction conflicts with identity lock, prioritize identity preservation.",
  ].join(" ");

  return userPrompt ? `${lockRules} ${userPrompt}` : lockRules;
}

export async function xaiGenerateVideo({ prompt, imageUrl, duration = 10, aspect_ratio = "16:9", resolution = "720p" }) {
  const key = getXaiKey();
  if (!key) {
    return { success: false, error: "XAI_API_KEY is not set." };
  }

  const videoDuration = Math.min(Math.max(Number(duration) || 10, 1), 15);
  const videoResolution = resolution === "480p" ? "480p" : "720p";

  let resolvedImageUrl = String(imageUrl || "").trim();
  // The video API is more reliable with a public URL. If the client sends a data URI,
  // convert it into a temporary HTTPS URL via ModelsLab's base64_to_url.
  if (resolvedImageUrl.startsWith("data:")) {
    try {
      resolvedImageUrl = await modelslabBase64ToUrl(resolvedImageUrl);
    } catch {
      // Fallback: keep the original data URI (some xAI deployments accept it).
    }
  }

  const finalPrompt = buildIdentityLockedVideoPrompt(prompt);

  const body = {
    model: "grok-imagine-video",
    prompt: finalPrompt,
    image_url: resolvedImageUrl,
    duration: videoDuration,
    aspect_ratio: aspect_ratio || "16:9",
    resolution: videoResolution,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const res = await fetch(`${XAI_BASE}/videos/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const text = await res.text();
    if (!res.ok) {
      return { success: false, error: `xAI HTTP ${res.status}: ${text.substring(0, 200)}` };
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { success: false, error: "Invalid JSON from xAI." };
    }

    const requestId = data?.request_id || data?.id || data?.generation_id;
    if (!requestId) {
      return { success: false, error: `No request id in response. Keys: ${Object.keys(data || {}).join(", ")}` };
    }

    return { success: true, request_id: String(requestId) };
  } catch (e) {
    clearTimeout(timeout);
    if (e?.name === "AbortError") return { success: false, error: "Request timed out." };
    return { success: false, error: "Video generation failed." };
  }
}

export async function xaiVideoStatus({ requestId }) {
  const key = getXaiKey();
  if (!key) {
    return { status: "error", error: "XAI_API_KEY is not set." };
  }

  const res = await fetch(`${XAI_BASE}/videos/${encodeURIComponent(String(requestId))}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout?.(15000),
  });

  const text = await res.text();
  if (!res.ok) {
    return { status: "error", error: `xAI HTTP ${res.status}` };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: "error", error: "Invalid JSON from xAI." };
  }

  // xAI responses observed in the wild:
  // 1) { status: "pending"|"done"|"expired", video?: { url, duration, ... } }
  // 2) { video: { url, duration, ... }, model: "grok-imagine-video", ... }  (no status field)

  const videoUrl = data?.video?.url;
  if (videoUrl) {
    return { status: "done", video: { url: String(videoUrl), duration: data?.video?.duration } };
  }

  const status = String(data?.status || data?.state || "").toLowerCase();
  if (status === "done" || status === "succeeded" || status === "success") {
    return { status: "error", error: "Missing video URL in done response." };
  }

  if (status === "expired") {
    return { status: "expired", error: data?.error || data?.message || "Request expired." };
  }

  if (status === "error" || status === "failed" || status === "canceled" || status === "cancelled") {
    return { status: "error", error: data?.error || data?.message || "Request failed." };
  }

  return { status: "pending" };
}

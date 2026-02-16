import "dotenv/config";
import cors from "cors";
import express from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";

import { modelslabImageToImage, modelslabTextToImage } from "./providers/modelslab.js";
import { getXaiKey, xaiGenerateVideo, xaiVideoStatus } from "./providers/xai.js";

const PORT = Number(process.env.PORT || 8787);

const app = express();

// Clerk must be registered before any other middleware.
app.use(clerkMiddleware());

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "15mb" }));

function requireClerkAuth(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  next();
}

function getSerpApiKey() {
  return process.env.SERPAPI_API_KEY || "";
}

async function serpApiMcpSearch(query, maxResults = 5, { mode = "compact", params = {} } = {}) {
  const apiKey = getSerpApiKey();
  if (!apiKey) throw new Error("SERPAPI_API_KEY is not set.");

  const q = String(query || "").trim();
  if (!q) return [];

  const max = Math.min(Math.max(Number(maxResults) || 5, 1), 10);

  const rawParams = params && typeof params === "object" ? { ...params } : {};
  // Prevent clients from overriding these.
  delete rawParams.q;
  delete rawParams.query;
  delete rawParams.num;
  delete rawParams.api_key;
  delete rawParams.key;

  const requestedEngine = typeof rawParams.engine === "string" ? rawParams.engine.trim() : "";
  delete rawParams.engine;

  const allowedEngines = new Set([
    "google",
    "google_news",
    "bing",
    "duckduckgo",
  ]);

  const engine = allowedEngines.has(requestedEngine) ? requestedEngine : "google";

  // SerpAPI MCP uses JSON-RPC (tools/call).
  const rpc = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name: "search",
      arguments: {
        params: {
          engine,
          q,
          num: max,
          // Better defaults for PT-BR users.
          hl: "pt",
          gl: "br",
          google_domain: "google.com.br",
          ...rawParams,
        },
        mode: mode === "complete" ? "complete" : "compact",
      },
    },
  };

  const res = await fetch("https://mcp.serpapi.com/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(rpc),
    signal: AbortSignal.timeout?.(25000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SerpAPI MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from SerpAPI MCP.");
  }

  const content0 = json?.result?.content?.[0];
  const payloadText = typeof content0?.text === "string" ? content0.text : "";
  if (!payloadText) throw new Error("SerpAPI MCP returned no content.");

  let payload;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    // Some engines may return plain text.
    payload = { organic_results: [] };
  }

  const organic = Array.isArray(payload?.organic_results) ? payload.organic_results : [];
  const results = organic
    .map((r) => ({
      title: String(r?.title || "").trim(),
      url: String(r?.link || r?.url || "").trim(),
      snippet: String(r?.snippet || "").trim(),
    }))
    .filter((r) => r.title && r.url && r.url.startsWith("http"))
    .slice(0, max);

  return results;
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    apis: {
      modelslab: !!process.env.MODELSLAB_API_KEY,
      xai: !!getXaiKey(),
      serpapi: !!getSerpApiKey(),
    },
  });
});

app.post("/api/web/search", requireClerkAuth, async (req, res) => {
  try {
    const { query, max_results, params, mode } = req.body || {};
    const q = String(query || "").trim();
    if (!q) {
      res.status(400).json({ success: false, error: "query is required." });
      return;
    }

    const max = Math.min(Math.max(Number(max_results) || 5, 1), 8);
    const results = await serpApiMcpSearch(q, max, { params, mode });
    res.json({ success: true, results });
  } catch (e) {
    res.status(502).json({ success: false, error: e instanceof Error ? e.message : "Web search failed." });
  }
});

app.post("/api/image/generate", requireClerkAuth, async (req, res) => {
  try {
    const { prompt, aspectRatio, model_id, init_image, image } = req.body || {};
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json({ success: false, error: "Prompt is required." });
      return;
    }

    const initImage = init_image || image;
    const result = await modelslabTextToImage({
      prompt,
      aspectRatio: aspectRatio || "1:1",
      modelId: model_id,
      initImage,
    });
    if (!result.success) {
      const status = result.errorCode === "CONTENT_BLOCKED" ? 422 : 502;
      res.status(status).json({ success: false, ...result });
      return;
    }

    const firstUrl = Array.isArray(result.urls)
      ? result.urls.find((u) => typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://")))
      : null;

    res.json({ success: true, urls: firstUrl ? [firstUrl] : [], requestId: result.requestId });
  } catch (e) {
    res.status(500).json({ success: false, error: "Image generation failed." });
  }
});

app.post("/api/image/edit", requireClerkAuth, async (req, res) => {
  try {
    const { prompt, image, aspectRatio } = req.body || {};
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json({ success: false, error: "Prompt is required." });
      return;
    }
    if (!image || typeof image !== "string") {
      res.status(400).json({ success: false, error: "Image is required (data URI or URL)." });
      return;
    }

    const result = await modelslabImageToImage({ prompt, image, aspectRatio: aspectRatio || "1:1" });
    if (!result.success) {
      const status = result.errorCode === "CONTENT_BLOCKED" ? 422 : 502;
      res.status(status).json({ success: false, ...result });
      return;
    }

    const firstUrl = Array.isArray(result.urls)
      ? result.urls.find((u) => typeof u === "string" && (u.startsWith("http://") || u.startsWith("https://")))
      : null;

    res.json({ success: true, urls: firstUrl ? [firstUrl] : [], requestId: result.requestId });
  } catch (e) {
    res.status(500).json({ success: false, error: "Image edit failed." });
  }
});

app.post("/api/video/generate", requireClerkAuth, async (req, res) => {
  try {
    const { prompt, image_url, image, duration, aspect_ratio, resolution } = req.body || {};
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json({ success: false, error: "Prompt is required." });
      return;
    }
    const imageSource = image_url || image;
    if (!imageSource || typeof imageSource !== "string") {
      res.status(400).json({ success: false, error: "image_url is required." });
      return;
    }

    const result = await xaiGenerateVideo({
      prompt,
      imageUrl: imageSource,
      duration,
      aspect_ratio,
      resolution,
    });

    if (!result.success) {
      res.status(502).json(result);
      return;
    }

    res.json(result);
  } catch {
    res.status(500).json({ success: false, error: "Video generation failed." });
  }
});

app.get("/api/video/status/:requestId", requireClerkAuth, async (req, res) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "Surrogate-Control": "no-store",
  });

  try {
    const { requestId } = req.params;
    if (!requestId) {
      res.status(400).json({ status: "error", error: "Request ID is required." });
      return;
    }

    const status = await xaiVideoStatus({ requestId });
    res.json(status);
  } catch {
    res.status(500).json({ status: "error", error: "Failed to check status." });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
});

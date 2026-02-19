import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getModelsLabVideoModelId,
  modelslabGenerateVideo,
  modelslabImageToImage,
  modelslabTextToImage,
  modelslabVideoStatus,
} from "./providers/modelslab.js";
import {
  BetaAccessError,
  chargeBetaCreditsForUser,
  generateBetaLicenseKeys,
  getBetaAccessForUser,
  getBetaPublicCheckoutConfig,
  listBetaLicenseKeys,
  redeemBetaLicenseForUser,
  refundBetaChargeForUser,
} from "./providers/beta-access.js";
import { getLlamaIndexStatus, searchKnowledgeWithLlamaIndex } from "./providers/llamaindex.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load env from project root and also from server/.env (if present).
dotenv.config();
dotenv.config({ path: path.join(__dirname, ".env") });

const PORT = process.env.PORT || 8787;
const KNOWLEDGE_DATA_DIR = path.join(__dirname, "data");
const KNOWLEDGE_STORE_FILE = path.join(KNOWLEDGE_DATA_DIR, "knowledge-store.json");
const KNOWLEDGE_ITEM_TYPES = new Set(["note", "code", "web", "api", "file", "image", "video"]);

const app = express();
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:5173"];

// Clerk must be registered before any other middleware.
app.use(clerkMiddleware());

app.use(cors({ origin: allowedOrigins, credentials: true }));
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

function parseKnowledgeAdminIds() {
  const raw = String(process.env.KNOWLEDGE_ADMIN_USER_IDS || "").trim();
  if (!raw) return new Set();
  const ids = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set(ids);
}

function parseBetaAdminIds() {
  const raw = String(process.env.BETA_ADMIN_USER_IDS || "").trim();
  if (!raw) return parseKnowledgeAdminIds();
  const ids = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set(ids);
}

function canManageBeta(userId) {
  const admins = parseBetaAdminIds();
  if (admins.size === 0) return false;
  return !!userId && admins.has(userId);
}

function canManageKnowledge(userId) {
  const admins = parseKnowledgeAdminIds();
  if (admins.size === 0) return false;
  return !!userId && admins.has(userId);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenizeSearch(value) {
  const tokens = normalizeText(value).match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
  const seen = new Set();
  const out = [];
  for (const token of tokens) {
    if (!token || token.length < 2) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function sanitizeKnowledgeTags(input) {
  const source = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const seen = new Set();
  const out = [];
  for (const raw of source) {
    const tag = String(raw || "").trim().toLowerCase();
    if (!tag) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 18) break;
  }
  return out;
}

function coerceKnowledgeType(input) {
  const normalized = String(input || "")
    .trim()
    .toLowerCase();
  if (KNOWLEDGE_ITEM_TYPES.has(normalized)) return normalized;
  return "note";
}

function createKnowledgeStoreSnapshot(raw) {
  const base = raw && typeof raw === "object" ? raw : {};
  const itemsRaw = Array.isArray(base.items) ? base.items : [];
  const items = itemsRaw
    .map((item) => {
      const createdAt = Number(item?.createdAt) || Date.now();
      const updatedAt = Number(item?.updatedAt) || createdAt;
      return {
        id: String(item?.id || randomUUID()),
        title: String(item?.title || "").trim().slice(0, 180),
        type: coerceKnowledgeType(item?.type),
        summary: String(item?.summary || "").trim().slice(0, 1600),
        content: String(item?.content || "").trim().slice(0, 48000),
        url: String(item?.url || "").trim(),
        tags: sanitizeKnowledgeTags(item?.tags),
        createdBy: String(item?.createdBy || "").trim(),
        createdAt,
        updatedAt,
      };
    })
    .filter((item) => item.title && (item.summary || item.content || item.url))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    version: 1,
    updatedAt: Number(base.updatedAt) || Date.now(),
    items,
  };
}

async function readKnowledgeStore() {
  await fs.mkdir(KNOWLEDGE_DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(KNOWLEDGE_STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return createKnowledgeStoreSnapshot(parsed);
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : "";
    if (code !== "ENOENT") throw error;
    const empty = createKnowledgeStoreSnapshot({ items: [] });
    await writeKnowledgeStore(empty);
    return empty;
  }
}

async function writeKnowledgeStore(nextStore) {
  const snapshot = createKnowledgeStoreSnapshot({
    ...nextStore,
    updatedAt: Date.now(),
  });
  await fs.mkdir(KNOWLEDGE_DATA_DIR, { recursive: true });
  const tempFile = path.join(KNOWLEDGE_DATA_DIR, `knowledge-store.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  await fs.writeFile(tempFile, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.rename(tempFile, KNOWLEDGE_STORE_FILE);
  return snapshot;
}

function pickKnowledgeSnippet(item) {
  const primary = String(item.summary || "").trim() || String(item.content || "").trim();
  if (!primary) return "";
  return primary.length > 260 ? `${primary.slice(0, 260)}...` : primary;
}

function scoreKnowledgeItem(item, searchPhrases, keywordHints) {
  const title = normalizeText(item.title);
  const summary = normalizeText(item.summary);
  const content = normalizeText(item.content);
  const tags = (item.tags || []).map((tag) => normalizeText(tag));
  const full = `${title}\n${summary}\n${content}\n${tags.join(" ")}`;

  let score = 0;
  let matchedTokens = 0;

  for (const phrase of searchPhrases) {
    const normalizedPhrase = normalizeText(phrase).trim();
    if (!normalizedPhrase) continue;
    if (full.includes(normalizedPhrase)) score += normalizedPhrase.length > 12 ? 3.6 : 2.4;
  }

  const allTokens = [...searchPhrases.flatMap((phrase) => tokenizeSearch(phrase)), ...keywordHints.flatMap((k) => tokenizeSearch(k))];
  const seen = new Set();
  for (const token of allTokens) {
    if (seen.has(token)) continue;
    seen.add(token);

    let hit = false;
    if (title.includes(token)) {
      score += 3.1;
      hit = true;
    }
    if (tags.some((tag) => tag === token || tag.includes(token))) {
      score += 2.5;
      hit = true;
    }
    if (summary.includes(token)) {
      score += 1.8;
      hit = true;
    } else if (content.includes(token)) {
      score += 1.2;
      hit = true;
    }
    if (hit) matchedTokens += 1;
  }

  const ageDays = Math.max(0, (Date.now() - Number(item.updatedAt || item.createdAt || Date.now())) / 86_400_000);
  if (ageDays <= 7) score += 0.45;
  else if (ageDays <= 30) score += 0.25;

  score += Math.min(matchedTokens, 10) * 0.09;
  return { score, matchedTokens };
}

function summarizeKnowledgeTypes(items) {
  const counts = {};
  for (const item of items) {
    const t = coerceKnowledgeType(item.type);
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
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

app.get("/api/health", async (_req, res) => {
  let knowledgeTotal = 0;
  try {
    const store = await readKnowledgeStore();
    knowledgeTotal = store.items.length;
  } catch {
    knowledgeTotal = 0;
  }

  res.json({
    status: "ok",
    apis: {
      modelslab: !!process.env.MODELSLAB_API_KEY,
      serpapi: !!getSerpApiKey(),
      llamaindex: getLlamaIndexStatus(),
      beta_access: true,
    },
    knowledge: {
      total_items: knowledgeTotal,
    },
  });
});

app.get("/api/knowledge/status", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const store = await readKnowledgeStore();
    const adminConfigured = parseKnowledgeAdminIds().size > 0;
    const typeCounts = summarizeKnowledgeTypes(store.items);

    res.json({
      success: true,
      is_admin: canManageKnowledge(userId),
      admin_configured: adminConfigured,
      stats: {
        total_items: store.items.length,
        updated_at: store.updatedAt,
        by_type: typeCounts,
        retrieval_engine: getLlamaIndexStatus().enabled ? "llamaindex+fallback" : "heuristic",
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Knowledge status failed." });
  }
});

app.get("/api/knowledge/items", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!canManageKnowledge(userId)) {
      res.status(403).json({ success: false, error: "Forbidden." });
      return;
    }

    const store = await readKnowledgeStore();
    const q = String(req.query.q || "").trim();
    const rawType = String(req.query.type || "")
      .trim()
      .toLowerCase();
    const useTypeFilter = rawType.length > 0 && KNOWLEDGE_ITEM_TYPES.has(rawType);
    const type = useTypeFilter ? rawType : "";
    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);

    const normalizedQuery = normalizeText(q);
    const filtered = store.items.filter((item) => {
      if (useTypeFilter && item.type !== type) return false;
      if (!normalizedQuery) return true;
      const haystack = normalizeText(`${item.title}\n${item.summary}\n${item.content}\n${(item.tags || []).join(" ")}`);
      return haystack.includes(normalizedQuery);
    });

    const items = filtered.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);

    res.json({
      success: true,
      items,
      total: filtered.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Knowledge list failed." });
  }
});

app.post("/api/knowledge/items", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!canManageKnowledge(userId)) {
      res.status(403).json({ success: false, error: "Forbidden." });
      return;
    }

    const body = req.body || {};
    const title = String(body.title || "").trim().slice(0, 180);
    const type = coerceKnowledgeType(body.type);
    const summary = String(body.summary || "").trim().slice(0, 1600);
    const content = String(body.content || "").trim().slice(0, 48000);
    const rawUrl = String(body.url || "").trim();
    const url = rawUrl.startsWith("http://") || rawUrl.startsWith("https://") ? rawUrl : "";
    const tags = sanitizeKnowledgeTags(body.tags);

    if (!title) {
      res.status(400).json({ success: false, error: "title is required." });
      return;
    }
    if (!summary && !content && !url) {
      res.status(400).json({ success: false, error: "summary/content/url is required." });
      return;
    }

    const now = Date.now();
    const item = {
      id: randomUUID(),
      title,
      type,
      summary,
      content,
      url,
      tags,
      createdBy: String(userId || ""),
      createdAt: now,
      updatedAt: now,
    };

    const store = await readKnowledgeStore();
    const nextStore = await writeKnowledgeStore({
      ...store,
      items: [item, ...store.items].slice(0, 5000),
    });

    res.status(201).json({
      success: true,
      item,
      stats: {
        total_items: nextStore.items.length,
        by_type: summarizeKnowledgeTypes(nextStore.items),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Knowledge insert failed." });
  }
});

app.delete("/api/knowledge/items/:id", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!canManageKnowledge(userId)) {
      res.status(403).json({ success: false, error: "Forbidden." });
      return;
    }

    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ success: false, error: "id is required." });
      return;
    }

    const store = await readKnowledgeStore();
    const nextItems = store.items.filter((item) => item.id !== id);
    if (nextItems.length === store.items.length) {
      res.status(404).json({ success: false, error: "Item not found." });
      return;
    }

    const nextStore = await writeKnowledgeStore({
      ...store,
      items: nextItems,
    });

    res.json({
      success: true,
      deleted_id: id,
      stats: {
        total_items: nextStore.items.length,
        by_type: summarizeKnowledgeTypes(nextStore.items),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Knowledge delete failed." });
  }
});

app.post("/api/knowledge/search", requireClerkAuth, async (req, res) => {
  try {
    const { query, queries, keywords, max_results } = req.body || {};
    const q = String(query || "").trim();
    const queryList = Array.isArray(queries)
      ? queries
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];
    if (q && !queryList.includes(q)) queryList.unshift(q);
    const keywordHints = Array.isArray(keywords)
      ? keywords
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, 12)
      : [];

    if (!queryList.length && !keywordHints.length) {
      res.status(400).json({ success: false, error: "query/queries/keywords is required." });
      return;
    }

    const max = Math.min(Math.max(Number(max_results) || 6, 1), 12);
    const store = await readKnowledgeStore();
    let engine = "heuristic";
    let llamaindexFallbackError = null;

    const llamaAttempt = await searchKnowledgeWithLlamaIndex({
      items: store.items,
      queries: queryList,
      keywords: keywordHints,
      maxResults: max,
    }).catch((error) => ({
      enabled: true,
      reason: "error",
      results: [],
      trace: { engine: "llamaindex", enabled: true, error: error instanceof Error ? error.message : "unknown_error" },
    }));

    if (llamaAttempt?.enabled && Array.isArray(llamaAttempt.results) && llamaAttempt.results.length > 0) {
      engine = "llamaindex";
      res.json({
        success: true,
        results: llamaAttempt.results,
        trace: {
          queries: queryList,
          keywords: keywordHints,
          total_items: store.items.length,
          matched_items: llamaAttempt.results.length,
          engine,
          llamaindex: llamaAttempt.trace || undefined,
        },
      });
      return;
    }

    if (llamaAttempt?.enabled) {
      engine = "heuristic_fallback";
      llamaindexFallbackError =
        (llamaAttempt?.trace && typeof llamaAttempt.trace.error === "string" && llamaAttempt.trace.error) ||
        (typeof llamaAttempt?.reason === "string" && llamaAttempt.reason) ||
        null;
    }

    const ranked = store.items
      .map((item) => {
        const scored = scoreKnowledgeItem(item, queryList, keywordHints);
        return {
          item,
          score: scored.score,
          matchedTokens: scored.matchedTokens,
        };
      })
      .filter((entry) => entry.score > 0.65)
      .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
      .slice(0, max);

    const results = ranked.map((entry) => ({
      id: entry.item.id,
      title: entry.item.title,
      url: entry.item.url || undefined,
      snippet: pickKnowledgeSnippet(entry.item),
      type: entry.item.type,
      tags: entry.item.tags,
      source: "knowledge",
      score: Number(entry.score.toFixed(3)),
      matched_tokens: entry.matchedTokens,
      updated_at: entry.item.updatedAt,
    }));

    res.json({
      success: true,
      results,
      trace: {
        queries: queryList,
        keywords: keywordHints,
        total_items: store.items.length,
        matched_items: results.length,
        engine,
        llamaindex_fallback_reason: llamaindexFallbackError || undefined,
      },
    });
  } catch (error) {
    res.status(502).json({ success: false, error: error instanceof Error ? error.message : "Knowledge search failed." });
  }
});

app.get("/api/beta/access", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const access = await getBetaAccessForUser(userId);
    res.json({
      success: true,
      access,
      checkout: getBetaPublicCheckoutConfig(),
    });
  } catch (error) {
    const status = error instanceof BetaAccessError ? error.status : 500;
    const code = error instanceof BetaAccessError ? error.code : "BETA_ACCESS_FAILED";
    res.status(status).json({ success: false, code, error: error instanceof Error ? error.message : "Beta access failed." });
  }
});

app.post("/api/beta/redeem", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { license_key } = req.body || {};
    const result = await redeemBetaLicenseForUser(userId, license_key);
    res.json({
      success: true,
      ...result,
      checkout: getBetaPublicCheckoutConfig(),
    });
  } catch (error) {
    const status = error instanceof BetaAccessError ? error.status : 500;
    const code = error instanceof BetaAccessError ? error.code : "BETA_REDEEM_FAILED";
    res.status(status).json({ success: false, code, error: error instanceof Error ? error.message : "Beta redeem failed." });
  }
});

app.post("/api/beta/charge", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { action, operation_id, note } = req.body || {};
    const result = await chargeBetaCreditsForUser(userId, {
      action,
      operationId: operation_id,
      note,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    const status = error instanceof BetaAccessError ? error.status : 500;
    const code = error instanceof BetaAccessError ? error.code : "BETA_CHARGE_FAILED";
    res.status(status).json({ success: false, code, error: error instanceof Error ? error.message : "Beta charge failed." });
  }
});

app.post("/api/beta/refund", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    const { charge_id, reason } = req.body || {};
    const result = await refundBetaChargeForUser(userId, {
      chargeId: charge_id,
      reason,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    const status = error instanceof BetaAccessError ? error.status : 500;
    const code = error instanceof BetaAccessError ? error.code : "BETA_REFUND_FAILED";
    res.status(status).json({ success: false, code, error: error instanceof Error ? error.message : "Beta refund failed." });
  }
});

app.get("/api/beta/admin/keys", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!canManageBeta(userId)) {
      res.status(403).json({ success: false, code: "FORBIDDEN", error: "Forbidden." });
      return;
    }
    const result = await listBetaLicenseKeys({
      status: req.query.status,
      limit: req.query.limit,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, code: "BETA_KEYS_LIST_FAILED", error: error instanceof Error ? error.message : "List failed." });
  }
});

app.post("/api/beta/admin/keys/generate", requireClerkAuth, async (req, res) => {
  try {
    const { userId } = getAuth(req);
    if (!canManageBeta(userId)) {
      res.status(403).json({ success: false, code: "FORBIDDEN", error: "Forbidden." });
      return;
    }
    const { quantity, notes } = req.body || {};
    const result = await generateBetaLicenseKeys({ quantity, notes });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    const status = error instanceof BetaAccessError ? error.status : 500;
    const code = error instanceof BetaAccessError ? error.code : "BETA_KEYS_GENERATE_FAILED";
    res.status(status).json({ success: false, code, error: error instanceof Error ? error.message : "Generate keys failed." });
  }
});

app.post("/api/web/search", requireClerkAuth, async (req, res) => {
  try {
    const { query, queries, max_results, params, mode } = req.body || {};
    const q = String(query || "").trim();
    const list = Array.isArray(queries)
      ? queries
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];

    if (q && !list.includes(q)) list.unshift(q);
    const queryList = list.filter(Boolean);

    if (!queryList.length) {
      res.status(400).json({ success: false, error: "query is required." });
      return;
    }

    const max = Math.min(Math.max(Number(max_results) || 5, 1), 8);
    const merged = [];
    const seen = new Set();
    const perQuery = [];

    for (const item of queryList) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const results = await serpApiMcpSearch(item, max, { params, mode });
        perQuery.push({ query: item, count: results.length });
        for (const result of results) {
          const key = String(result.url || "");
          if (!key || seen.has(key)) continue;
          seen.add(key);
          merged.push(result);
        }
      } catch (error) {
        perQuery.push({
          query: item,
          count: 0,
          error: error instanceof Error ? error.message : "search failed",
        });
      }
    }

    // Respect max_results from caller after dedupe.
    const limited = merged.slice(0, max);

    res.json({
      success: true,
      results: limited,
      trace: {
        queries: queryList,
        perQuery,
        total_sources: limited.length,
      },
    });
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

    res.json({
      success: true,
      urls: firstUrl ? [firstUrl] : [],
      requestId: result.requestId,
      provider: "modelslab",
    });
  } catch (e) {
    res.status(500).json({ success: false, error: "Image generation failed." });
  }
});

app.post("/api/image/generate-alt", requireClerkAuth, async (req, res) => {
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

    res.json({ success: true, urls: firstUrl ? [firstUrl] : [], requestId: result.requestId, provider: "modelslab" });
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
    const imageInputs = Array.isArray(image)
      ? image.filter((item) => typeof item === "string" && item.trim()).slice(0, 2)
      : typeof image === "string" && image.trim()
        ? [image]
        : [];

    if (imageInputs.length === 0) {
      res.status(400).json({ success: false, error: "Image is required (data URI/URL ou array)." });
      return;
    }

    const result = await modelslabImageToImage({
      prompt,
      image: imageInputs.length === 1 ? imageInputs[0] : imageInputs,
      aspectRatio: aspectRatio || "1:1",
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
    res.status(500).json({ success: false, error: "Image edit failed." });
  }
});

app.post("/api/video/generate", requireClerkAuth, async (req, res) => {
  try {
    const { prompt, image_url, image, duration, aspect_ratio, resolution, video_model_id } = req.body || {};
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json({ success: false, error: "Prompt is required." });
      return;
    }
    const imageSource = image_url || image;
    if (!imageSource || typeof imageSource !== "string") {
      res.status(400).json({ success: false, error: "image_url (ou image) is required." });
      return;
    }

    const result = await modelslabGenerateVideo({
      prompt,
      imageUrl: imageSource,
      duration,
      aspect_ratio,
      resolution,
      modelId: video_model_id || getModelsLabVideoModelId(),
    });

    if (!result.success) {
      const msg = String(result.error || "").toLowerCase();
      const isValidationError =
        msg.includes("must be") ||
        msg.includes("required") ||
        msg.includes("unsupported") ||
        msg.includes("invalid");
      res.status(isValidationError ? 422 : 502).json(result);
      return;
    }

    res.json({ ...result, provider: "modelslab" });
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

    const status = await modelslabVideoStatus({ requestId });
    res.json(status);
  } catch {
    res.status(500).json({ status: "error", error: "Failed to check status." });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${PORT}`);
});

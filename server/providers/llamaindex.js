const TRUE_PATTERN = /^(1|true|yes|on)$/i;

let cachedRetriever = null;
let cachedItemsById = new Map();
let cachedSignature = "";
let retrieverBuildPromise = null;
let embedConfigured = false;
let cachedEmbedModel = "";
let cachedEmbedProvider = "";

function isTruthy(value) {
  return TRUE_PATTERN.test(String(value || "").trim());
}

function normalizeQueryList(queries, keywords) {
  const source = [
    ...(Array.isArray(queries) ? queries : []),
    ...(Array.isArray(keywords) ? keywords : []),
  ];
  const seen = new Set();
  const out = [];
  for (const raw of source) {
    const q = String(raw || "").trim().replace(/\s+/g, " ");
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= 12) break;
  }
  return out;
}

function buildKnowledgeSignature(items) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return "0:0";
  const maxUpdatedAt = safeItems.reduce((max, item) => Math.max(max, Number(item?.updatedAt || 0)), 0);
  const firstIds = safeItems
    .slice(0, 24)
    .map((item) => String(item?.id || ""))
    .join("|");
  return `${safeItems.length}:${maxUpdatedAt}:${firstIds}`;
}

function buildDocumentText(item) {
  const parts = [
    `title: ${String(item?.title || "").trim()}`,
    `type: ${String(item?.type || "").trim()}`,
    `tags: ${Array.isArray(item?.tags) ? item.tags.join(", ") : ""}`,
    `summary: ${String(item?.summary || "").trim()}`,
    `content: ${String(item?.content || "").trim()}`,
    `url: ${String(item?.url || "").trim()}`,
  ];
  return parts.filter(Boolean).join("\n");
}

function pickSnippet(item) {
  const text = String(item?.summary || "").trim() || String(item?.content || "").trim();
  if (!text) return "";
  return text.length > 320 ? `${text.slice(0, 320)}...` : text;
}

function isLlamaIndexEnabled() {
  const explicit = String(process.env.KNOWLEDGE_SEARCH_ENGINE || "")
    .trim()
    .toLowerCase();
  if (explicit === "llamaindex") return true;
  return isTruthy(process.env.LLAMAINDEX_ENABLED);
}

function getEmbedModelName() {
  const provider = getEmbedProvider();
  const defaultModel = provider === "ollama" ? "nomic-embed-text" : "text-embedding-3-small";
  return String(process.env.LLAMAINDEX_EMBED_MODEL || defaultModel).trim() || defaultModel;
}

function getEmbedProvider() {
  const provider = String(process.env.LLAMAINDEX_EMBED_PROVIDER || "ollama")
    .trim()
    .toLowerCase();
  return provider === "openai" ? "openai" : "ollama";
}

function getOllamaBaseUrl() {
  return String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").trim() || "http://127.0.0.1:11434";
}

async function configureLlamaIndexEmbeddings() {
  const embedProvider = getEmbedProvider();
  const embedModel = getEmbedModelName();
  if (embedConfigured && cachedEmbedProvider === embedProvider && cachedEmbedModel === embedModel) return;

  const { Settings } = await import("llamaindex");

  if (embedProvider === "openai") {
    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when LLAMAINDEX_EMBED_PROVIDER=openai.");
    }
    const { OpenAIEmbedding } = await import("@llamaindex/openai");
    Settings.embedModel = new OpenAIEmbedding({
      model: embedModel,
      apiKey,
    });
  } else {
    const { OllamaEmbedding } = await import("@llamaindex/ollama");
    Settings.embedModel = new OllamaEmbedding({
      model: embedModel,
      config: {
        host: getOllamaBaseUrl(),
      },
    });
  }

  cachedEmbedProvider = embedProvider;
  cachedEmbedModel = embedModel;
  embedConfigured = true;
}

async function ensureRetriever(items) {
  const signature = buildKnowledgeSignature(items);
  if (cachedRetriever && cachedSignature === signature) {
    return { retriever: cachedRetriever, itemsById: cachedItemsById };
  }

  if (retrieverBuildPromise) {
    return retrieverBuildPromise;
  }

  retrieverBuildPromise = (async () => {
    await configureLlamaIndexEmbeddings();
    const { Document, VectorStoreIndex } = await import("llamaindex");

    const itemsById = new Map();
    const docs = [];
    for (const item of items) {
      if (!item || !item.id) continue;
      const id = String(item.id);
      itemsById.set(id, item);
      docs.push(
        new Document({
          id_: `knowledge:${id}`,
          text: buildDocumentText(item),
          metadata: {
            itemId: id,
            type: item.type,
            title: item.title,
            url: item.url || "",
            tags: Array.isArray(item.tags) ? item.tags : [],
            updatedAt: Number(item.updatedAt || 0),
          },
        })
      );
    }

    if (!docs.length) {
      cachedRetriever = null;
      cachedItemsById = new Map();
      cachedSignature = signature;
      return { retriever: null, itemsById: cachedItemsById };
    }

    const index = await VectorStoreIndex.fromDocuments(docs);
    const retriever = index.asRetriever({
      similarityTopK: Math.min(Math.max(Number(process.env.LLAMAINDEX_TOP_K) || 16, 4), 64),
    });

    cachedRetriever = retriever;
    cachedItemsById = itemsById;
    cachedSignature = signature;
    return { retriever, itemsById };
  })();

  try {
    return await retrieverBuildPromise;
  } finally {
    retrieverBuildPromise = null;
  }
}

function scoreBySourceMatch(baseScore, matchCount, queryHits) {
  const score = Number(baseScore || 0) + Math.min(0.55, matchCount * 0.08) + Math.min(0.4, queryHits * 0.06);
  return Number(score.toFixed(5));
}

export async function searchKnowledgeWithLlamaIndex({ items, queries, keywords, maxResults = 6 }) {
  if (!isLlamaIndexEnabled()) {
    return {
      enabled: false,
      reason: "disabled",
      results: [],
      trace: { engine: "llamaindex", enabled: false },
    };
  }

  const normalizedQueries = normalizeQueryList(queries, keywords);
  if (!normalizedQueries.length) {
    return {
      enabled: true,
      reason: "empty_query",
      results: [],
      trace: { engine: "llamaindex", enabled: true, queries: [] },
    };
  }

  const { retriever, itemsById } = await ensureRetriever(Array.isArray(items) ? items : []);
  if (!retriever) {
    return {
      enabled: true,
      reason: "empty_store",
      results: [],
      trace: { engine: "llamaindex", enabled: true, queries: normalizedQueries, total_items: 0 },
    };
  }

  const merged = new Map();
  for (const query of normalizedQueries) {
    // eslint-disable-next-line no-await-in-loop
    const nodes = await retriever.retrieve(query);
    for (const entry of Array.isArray(nodes) ? nodes : []) {
      const node = entry?.node;
      const metadata = node?.metadata || {};
      const itemId = String(metadata?.itemId || "").trim();
      if (!itemId) continue;
      const item = itemsById.get(itemId);
      if (!item) continue;
      const prev = merged.get(itemId);
      const baseScore = Number(entry?.score || 0);
      if (!prev) {
        merged.set(itemId, {
          item,
          baseScore,
          matchCount: 1,
          queryHits: new Set([query]),
        });
      } else {
        prev.baseScore = Math.max(prev.baseScore, baseScore);
        prev.matchCount += 1;
        prev.queryHits.add(query);
      }
    }
  }

  const ranked = [...merged.values()]
    .map((entry) => ({
      ...entry,
      score: scoreBySourceMatch(entry.baseScore, entry.matchCount, entry.queryHits.size),
    }))
    .sort((a, b) => b.score - a.score || Number(b.item.updatedAt || 0) - Number(a.item.updatedAt || 0))
    .slice(0, Math.min(Math.max(Number(maxResults) || 6, 1), 12));

  const results = ranked.map((entry) => ({
    id: entry.item.id,
    title: entry.item.title,
    url: entry.item.url || undefined,
    snippet: pickSnippet(entry.item),
    type: entry.item.type,
    tags: entry.item.tags,
    source: "knowledge",
    score: Number(entry.score.toFixed(3)),
    matched_tokens: entry.queryHits.size,
    updated_at: entry.item.updatedAt,
  }));

  return {
    enabled: true,
    reason: null,
    results,
    trace: {
      engine: "llamaindex",
      enabled: true,
      embed_provider: cachedEmbedProvider || getEmbedProvider(),
      embed_model: cachedEmbedModel || getEmbedModelName(),
      total_items: Array.isArray(items) ? items.length : 0,
      queried: normalizedQueries.length,
    },
  };
}

export function getLlamaIndexStatus() {
  const enabled = isLlamaIndexEnabled();
  const provider = getEmbedProvider();
  const hasOpenAIKey = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
  const ready = !enabled
    ? true
    : provider === "openai"
      ? hasOpenAIKey
      : true;
  return {
    enabled,
    embed_provider: provider,
    embed_model: getEmbedModelName(),
    ollama_base_url: provider === "ollama" ? getOllamaBaseUrl() : undefined,
    ready,
  };
}

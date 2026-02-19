import { useEffect, useMemo, useRef, useState } from "react";
import { SignedIn, SignedOut, useAuth, useClerk } from "@clerk/clerk-react";
import AuthLanding from "./components/AuthLanding";
import AppSettingsModal from "./components/AppSettingsModal";
import BetaAccessGate from "./components/BetaAccessGate";
import Composer from "./components/Composer";
import KnowledgeStudioModal from "./components/KnowledgeStudioModal";
import Lightbox from "./components/Lightbox";
import MessageBubble from "./components/MessageBubble";
import ProfileModal from "./components/ProfileModal";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import type { ChatAttachment, ChatMessage, ChatThread, ModelOption, ReasoningTrace, ThreadKind } from "./types";

const DEFAULT_MODEL_ID = "claude-opus-4-6";
const UNTITLED_CHAT_TITLE = "Novo chat";
const UNTITLED_MEDIA_TITLE = "Novo midia";
const LEGACY_UNTITLED_CHAT_TITLE = "New chat";
const LEGACY_UNTITLED_MEDIA_TITLE = "New media";
const EDIT_IMAGE_MAX_ATTACHMENTS = 2;
const TEXT_TOOL_IDS = new Set(["deepsearch", "think"]);
const MEDIA_TOOL_IDS = new Set(["create-images", "edit-image", "create-video"]);
const VIDEO_ASPECT_RATIOS = ["16:9", "4:3", "1:1", "9:16", "3:4", "3:2", "2:3"] as const;
const VIDEO_RESOLUTIONS = ["720p", "480p"] as const;
type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];
type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

type PendingImageAttachment = {
  id: string;
  name: string;
  dataUrl: string;
};

type BetaAction =
  | "text_basic"
  | "text_think"
  | "text_deepsearch"
  | "text_think_deepsearch"
  | "image_generate"
  | "image_edit"
  | "video_generate";

type BetaAccessState = {
  licensed: boolean;
  plan_id: string;
  plan_name: string;
  credits: number;
  total_granted: number;
  total_spent: number;
  license_key_masked?: string;
  early_access?: {
    enabled?: boolean;
    title?: string;
    included_credits?: number;
    video_editing_enabled?: boolean;
    video_warning_badge?: string;
  };
  action_costs?: Record<string, number>;
};

type BetaCheckoutState = {
  purchase_url?: string;
  support_email?: string;
  delivery_mode?: string;
  plan_id?: string;
  plan_name?: string;
  initial_credits?: number;
};

function videoAspectRatioToNumber(ratio: VideoAspectRatio): number {
  const [w, h] = ratio.split(":").map((n) => Number(n));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 16 / 9;
  return w / h;
}

const ALLOWED_TOOL_IDS = new Set(["deepsearch", "think", "create-images", "edit-image", "create-video"]);
function coerceActiveTool(tool: unknown): string | null {
  if (typeof tool !== "string") return null;
  return ALLOWED_TOOL_IDS.has(tool) ? tool : null;
}

function coerceActiveTools(raw: unknown): string[] {
  if (typeof raw === "string") {
    const t = coerceActiveTool(raw);
    return t ? [t] : [];
  }
  if (!Array.isArray(raw)) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const t = coerceActiveTool(item);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function normalizeToolSelection(raw: string[]): string[] {
  const tools = coerceActiveTools(raw);
  if (!tools.length) return [];

  const media = tools.filter((t) => MEDIA_TOOL_IDS.has(t));
  if (media.length > 0) return [media[0]];

  // Text modes can run together as a deliberate combo: DeepSearch + Think.
  const ordered = ["deepsearch", "think"].filter((t) => tools.includes(t));
  return ordered.slice(0, 2);
}

const KEYWORD_TOKEN_REGEX = /[a-zA-ZÀ-ÿ0-9]+(?:-[a-zA-ZÀ-ÿ0-9]+)*/g;

const SHORT_KEYWORD_ALLOWLIST = new Set(["ia", "ai", "ux", "ui", "vr", "ar", "3d", "2d", "4g", "5g", "6g"]);

const SEARCH_STOPWORDS = new Set([
  "a",
  "agora",
  "algum",
  "alguma",
  "algumas",
  "alguns",
  "ante",
  "ao",
  "aos",
  "apos",
  "as",
  "ate",
  "bem",
  "by",
  "com",
  "como",
  "conversamos",
  "contra",
  "da",
  "das",
  "de",
  "delas",
  "deles",
  "depois",
  "desse",
  "desta",
  "do",
  "dos",
  "e",
  "ela",
  "elas",
  "ele",
  "eles",
  "em",
  "entao",
  "entre",
  "era",
  "essa",
  "essas",
  "esse",
  "esses",
  "esta",
  "estao",
  "este",
  "etc",
  "eu",
  "fala",
  "falam",
  "falar",
  "faz",
  "fazem",
  "fazer",
  "for",
  "forma",
  "foi",
  "gente",
  "get",
  "ha",
  "isso",
  "isto",
  "ja",
  "la",
  "lhe",
  "lhes",
  "mais",
  "mas",
  "me",
  "med",
  "menos",
  "meu",
  "minha",
  "na",
  "nao",
  "nas",
  "nem",
  "no",
  "nos",
  "nossa",
  "nosso",
  "num",
  "numa",
  "o",
  "of",
  "on",
  "os",
  "ou",
  "para",
  "pela",
  "pelas",
  "pelo",
  "pelos",
  "por",
  "pode",
  "podem",
  "poder",
  "pra",
  "pro",
  "pros",
  "que",
  "quero",
  "recomenda",
  "recomendar",
  "sabe",
  "saber",
  "se",
  "sem",
  "ser",
  "sobre",
  "so",
  "sua",
  "suas",
  "tal",
  "tao",
  "te",
  "tem",
  "tenho",
  "tipo",
  "this",
  "to",
  "tu",
  "tudo",
  "uma",
  "um",
  "uns",
  "vou",
  "you",
]);

const PT_TO_EN_KEYWORD_MAP: Record<string, string> = {
  "academia": "academy",
  "analise": "analysis",
  "analises": "analyses",
  "arquitetura": "architecture",
  "arte": "art",
  "artigo": "article",
  "artigos": "articles",
  "atualizado": "updated",
  "benchmark": "benchmark",
  "comparacao": "comparison",
  "comparativo": "comparative",
  "contexto": "context",
  "controle": "control",
  "corrupcao": "corruption",
  "crescimento": "growth",
  "dados": "data",
  "desempenho": "performance",
  "desenvolvimento": "development",
  "dica": "tip",
  "dicas": "tips",
  "economia": "economy",
  "educacao": "education",
  "egito": "egypt",
  "empresa": "company",
  "empresas": "companies",
  "espionagem": "espionage",
  "estrategia": "strategy",
  "estrategias": "strategies",
  "estudo": "study",
  "estudos": "studies",
  "filme": "movie",
  "filmes": "movies",
  "fonte": "source",
  "fontes": "sources",
  "governo": "government",
  "guia": "guide",
  "historico": "historical",
  "impacto": "impact",
  "implementacao": "implementation",
  "industria": "industry",
  "inovacao": "innovation",
  "insights": "insights",
  "investimento": "investment",
  "limitacao": "limitation",
  "limitacoes": "limitations",
  "mercado": "market",
  "metodo": "method",
  "metodos": "methods",
  "modelo": "model",
  "modelos": "models",
  "noticia": "news",
  "noticias": "news",
  "oficial": "official",
  "pais": "country",
  "paises": "countries",
  "pesquisa": "research",
  "podre": "scandal",
  "podres": "scandals",
  "politica": "politics",
  "pratica": "practice",
  "praticas": "practices",
  "preco": "price",
  "precos": "prices",
  "produto": "product",
  "produtos": "products",
  "qualidade": "quality",
  "recente": "recent",
  "recomendacao": "recommendation",
  "recomendacoes": "recommendations",
  "relacao": "relationship",
  "relatorio": "report",
  "relatorios": "reports",
  "resultado": "result",
  "resultados": "results",
  "revisao": "review",
  "risco": "risk",
  "riscos": "risks",
  "saude": "health",
  "seguranca": "security",
  "servico": "service",
  "servicos": "services",
  "sistema": "system",
  "sistemas": "systems",
  "sociedade": "society",
  "tecnico": "technical",
  "tecnologia": "technology",
  "tendencia": "trend",
  "tendencias": "trends",
};

function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeKeywordToken(input: string): string {
  return stripDiacritics(String(input || "").toLowerCase()).replace(/[^a-z0-9-]/g, "");
}

function translateKeywordTokenToEnglish(keyword: string): string {
  const normalized = normalizeKeywordToken(keyword);
  if (!normalized) return "";

  const mapped = PT_TO_EN_KEYWORD_MAP[normalized];
  if (mapped) return mapped;

  if (normalized.includes("-")) {
    const translatedParts = normalized
      .split("-")
      .map((part) => PT_TO_EN_KEYWORD_MAP[part] || part)
      .filter(Boolean);
    const composite = translatedParts.join("-");
    if (composite) return composite;
  }

  if (normalized.endsWith("s") && normalized.length > 4) {
    const singular = normalized.slice(0, -1);
    const singularMapped = PT_TO_EN_KEYWORD_MAP[singular];
    if (singularMapped) {
      return singularMapped.endsWith("s") ? singularMapped : `${singularMapped}s`;
    }
  }

  return normalized;
}

function translateKeywordsToEnglish(keywords: string[], limit = 7): string[] {
  const seen = new Set<string>();
  const translated: string[] = [];

  for (const keyword of keywords) {
    const en = translateKeywordTokenToEnglish(keyword);
    if (!en) continue;
    if (SEARCH_STOPWORDS.has(en)) continue;
    if (seen.has(en)) continue;
    seen.add(en);
    translated.push(en);
    if (translated.length >= Math.max(1, limit)) break;
  }

  return translated;
}

function extractSearchKeywords(prompt: string, limit = 6): string[] {
  const rawTokens = String(prompt || "").toLowerCase().match(KEYWORD_TOKEN_REGEX) || [];
  const map = new Map<string, { token: string; count: number; firstIndex: number }>();

  rawTokens.forEach((raw, index) => {
    const token = String(raw || "").trim();
    if (!token) return;

    const normalized = normalizeKeywordToken(token);
    if (!normalized) return;
    if (SEARCH_STOPWORDS.has(normalized)) return;

    const isYear = /^\d{4}$/.test(normalized);
    if (!isYear && normalized.length < 3 && !SHORT_KEYWORD_ALLOWLIST.has(normalized)) return;
    if (/^\d+$/.test(normalized) && !isYear && normalized.length < 4) return;

    const prev = map.get(normalized);
    if (prev) {
      prev.count += 1;
      return;
    }

    map.set(normalized, {
      token,
      count: 1,
      firstIndex: index,
    });
  });

  const ranked = [...map.entries()]
    .map(([normalized, item]) => {
      let score = item.count * 2;
      if (item.token.length >= 8) score += 1.1;
      if (/^\d{4}$/.test(normalized)) score += 0.7;
      if (SHORT_KEYWORD_ALLOWLIST.has(normalized)) score += 0.4;
      score += Math.max(0, 1 - item.firstIndex * 0.03);

      return {
        token: item.token,
        firstIndex: item.firstIndex,
        score,
      };
    })
    .sort((a, b) => b.score - a.score || a.firstIndex - b.firstIndex || b.token.length - a.token.length);

  return ranked.slice(0, Math.max(limit, 1)).map((item) => item.token);
}

function createReasoningTrace(thinkEnabled: boolean, deepSearchEnabled: boolean): ReasoningTrace | null {
  if (!thinkEnabled && !deepSearchEnabled) return null;

  const mode: ReasoningTrace["mode"] = deepSearchEnabled && thinkEnabled ? "hybrid" : deepSearchEnabled ? "deepsearch" : "think";
  const optimizerEnabled = deepSearchEnabled && thinkEnabled;
  const title =
    mode === "hybrid"
      ? "KILLA esta usando THINK + DEEP SEARCH para pensar e buscar no dataset/web..."
      : mode === "deepsearch"
        ? "KILLA esta usando DEEP SEARCH para pesquisar no dataset e na internet..."
        : "KILLA esta usando THINK para pensar profundamente...";

  const steps: ReasoningTrace["steps"] = [
    { id: "analyze", label: "Entendendo o contexto do pedido", status: "active" },
    ...(optimizerEnabled ? [{ id: "optimize", label: "Optimizer Enhanced Research", status: "pending" as const }] : []),
    ...(deepSearchEnabled ? [{ id: "search", label: "Pesquisando fontes (dataset + web)", status: "pending" as const }] : []),
    ...(deepSearchEnabled ? [{ id: "review", label: "Revisando fontes relevantes", status: "pending" as const }] : []),
    ...(thinkEnabled ? [{ id: "plan", label: "Estruturando o raciocinio", status: "pending" as const }] : []),
    { id: "answer", label: "Montando resposta final", status: "pending" },
  ];

  return {
    mode,
    title,
    steps,
    optimizer: optimizerEnabled ? { label: "Optimizer Enhanced Research ativo", strategy: "Keyword-first (PT -> EN)" } : undefined,
    optimizedQueries: [],
    queries: [],
    sources: [],
  };
}

function resolveTextCreditAction(thinkEnabled: boolean, deepSearchEnabled: boolean): BetaAction {
  if (thinkEnabled && deepSearchEnabled) return "text_think_deepsearch";
  if (deepSearchEnabled) return "text_deepsearch";
  if (thinkEnabled) return "text_think";
  return "text_basic";
}

function createMediaReasoningTrace(
  activeTools: string[],
  ctx?: { imageModelLabel?: string; durationSeconds?: number }
): ReasoningTrace | null {
  const wantsCreateImages = activeTools.includes("create-images");
  const wantsEditImage = activeTools.includes("edit-image");
  const wantsCreateVideo = activeTools.includes("create-video");

  if (!wantsCreateImages && !wantsEditImage && !wantsCreateVideo) return null;

  if (wantsCreateVideo) {
    const d = ctx?.durationSeconds ? ` de ${ctx.durationSeconds}s` : "";
    return {
      mode: "media",
      title: `KILLA esta usando CREATE VIDEO para gerar um video${d}...`,
      steps: [
        { id: "analyze", label: "Preparando imagem de referencia", status: "active" },
        { id: "render", label: "Gerando frames do video", status: "pending" },
        { id: "deliver", label: "Finalizando clipe", status: "pending" },
      ],
      queries: [],
      sources: [],
    };
  }

  if (wantsCreateImages && wantsEditImage) {
    return {
      mode: "media",
      title: "KILLA esta usando CREATE IMAGES + EDIT IMAGE para gerar e refinar a imagem...",
      steps: [
        { id: "analyze", label: "Interpretando direcao visual", status: "active" },
        { id: "render", label: "Gerando imagem base", status: "pending" },
        { id: "edit", label: "Aplicando refinamentos", status: "pending" },
        { id: "deliver", label: "Finalizando entrega", status: "pending" },
      ],
      queries: [],
      sources: [],
    };
  }

  if (wantsEditImage) {
    return {
      mode: "media",
      title: "KILLA esta usando EDIT IMAGE para editar sua imagem...",
      steps: [
        { id: "analyze", label: "Analisando imagem de referencia", status: "active" },
        { id: "edit", label: "Aplicando edicao solicitada", status: "pending" },
        { id: "deliver", label: "Finalizando imagem editada", status: "pending" },
      ],
      queries: [],
      sources: [],
    };
  }

  const suffix = ctx?.imageModelLabel ? ` (${ctx.imageModelLabel})` : "";
  return {
    mode: "media",
    title: `KILLA esta usando CREATE IMAGES para gerar uma imagem${suffix}...`,
    steps: [
      { id: "analyze", label: "Interpretando prompt visual", status: "active" },
      { id: "render", label: "Renderizando imagem", status: "pending" },
      { id: "deliver", label: "Preparando entrega final", status: "pending" },
    ],
    queries: [],
    sources: [],
  };
}

function dedupeQueries(queries: string[], limit: number): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of queries) {
    const q = String(item || "").trim().replace(/\s+/g, " ");
    if (!q || seen.has(q)) continue;
    seen.add(q);
    unique.push(q);
    if (unique.length >= limit) break;
  }
  return unique;
}

function buildDeepSearchQueries(
  prompt: string,
  thinkEnabled: boolean
): {
  searchQueries: string[];
  optimizedQueries: string[];
  keywords: string[];
} {
  const base = String(prompt || "").trim().replace(/\s+/g, " ");
  if (!base) return { searchQueries: [], optimizedQueries: [], keywords: [] };

  const year = new Date().getFullYear();
  const ptKeywords = extractSearchKeywords(base, thinkEnabled ? 7 : 6);
  const translatedKeywords = thinkEnabled ? translateKeywordsToEnglish(ptKeywords, 7) : [];
  const effectiveKeywords = thinkEnabled && translatedKeywords.length > 0 ? translatedKeywords : ptKeywords;
  const keywordCluster = effectiveKeywords.slice(0, 5);
  const primaryCluster = keywordCluster.slice(0, 3).join(" ").trim();
  const broadCluster = keywordCluster.join(" ").trim();
  const exactPrimary = keywordCluster
    .slice(0, 3)
    .map((word) => `"${word}"`)
    .join(" ")
    .trim();
  const querySeed = primaryCluster || broadCluster || base;

  const baselineQueries = thinkEnabled
    ? [
        querySeed,
        `${broadCluster || querySeed} reliable sources`,
        `${querySeed} official data`,
        `${querySeed} latest ${year}`,
      ]
    : [
        querySeed,
        `${broadCluster || querySeed} fontes confiaveis`,
        `${querySeed} dados oficiais`,
        `${querySeed} atualizado ${year}`,
      ];

  if (!thinkEnabled) {
    return {
      searchQueries: dedupeQueries(baselineQueries, 4),
      optimizedQueries: [],
      keywords: ptKeywords,
    };
  }

  // Think + DeepSearch: keyword-first strategy with PT -> EN translation for higher recall.
  const optimizedQueries = dedupeQueries(
    [
      exactPrimary ? `${exactPrimary} official source` : `${querySeed} official source`,
      `${querySeed} technical comparison ${year}`,
      `${querySeed} benchmark results ${year}`,
      `${querySeed} best practices implementation`,
      `${querySeed} risks and limitations`,
    ],
    5
  );

  const searchQueries = dedupeQueries([...optimizedQueries, ...baselineQueries], 5);
  return { searchQueries, optimizedQueries, keywords: effectiveKeywords };
}

function coerceThreadKind(kind: unknown): ThreadKind {
  return kind === "media" ? "media" : "chat";
}

function isUntitledTitle(title: string): boolean {
  return (
    title === UNTITLED_CHAT_TITLE ||
    title === UNTITLED_MEDIA_TITLE ||
    title === LEGACY_UNTITLED_CHAT_TITLE ||
    title === LEGACY_UNTITLED_MEDIA_TITLE
  );
}

function buildToolLoadingLabel(toolId: string | null, ctx?: { imageModelLabel?: string; durationSeconds?: number }): string {
  const tool = toolId || "";
  if (tool === "deepsearch+think" || tool === "think+deepsearch") {
    return "KILLA esta usando THINK + DEEP SEARCH para pesquisar no dataset e na web...";
  }
  if (tool === "think") return "KILLA esta usando THINK para pensar profundamente...";
  if (tool === "deepsearch") return "KILLA esta usando DEEP SEARCH para pesquisar no dataset e na internet...";
  if (tool === "create-images") {
    const suffix = ctx?.imageModelLabel ? ` (${ctx.imageModelLabel})` : "";
    return `KILLA esta usando CREATE IMAGES para gerar uma imagem${suffix}...`;
  }
  if (tool === "edit-image") return "KILLA esta usando EDIT IMAGE para editar sua imagem...";
  if (tool === "create-video") {
    const d = ctx?.durationSeconds ? ` de ${ctx.durationSeconds}s` : "";
    return `KILLA esta usando CREATE VIDEO para gerar um video${d}...`;
  }
  return "KILLA esta pensando...";
}

function isAssistantPlaceholderText(text: unknown): boolean {
  const normalized = String(text || "")
    .trim()
    .toLowerCase();

  if (!normalized) return true;
  if (normalized === "..." || normalized === "…" || normalized === "â€¦") return true;
  if (normalized === "pronto.") return true;
  if (normalized.startsWith("killa esta usando")) return true;
  if (normalized.startsWith("killa esta pensando")) return true;
  if (normalized.startsWith("gerando imagem")) return true;
  if (normalized.startsWith("editando imagem")) return true;
  if (normalized.startsWith("gerando video")) return true;
  if (normalized.startsWith("gerando vídeo")) return true;
  if (normalized.startsWith("gerando vÃ­deo")) return true;

  return false;
}

const SYSTEM_PROMPT = `
Voce e o assistente do KILLA CHAT.

Regras:
- Responda sempre em portugues do Brasil.
- Formate a resposta em Markdown com hierarquia clara (H1, H2, H3), listas curtas e divisorias (---).
- Seja direto e util, mas com profundidade.
- Entregue em 3 camadas quando fizer sentido: (1) resumo executivo, (2) analise tecnica, (3) plano pratico acionavel.
- Quando houver escolha, traga recomendacao principal + trade-offs (custo, risco, velocidade, manutencao).
- Use codigo e comandos sempre em blocos fenced com a linguagem.
- Quando comparar 2+ opcoes, use tabela Markdown.
- Nao invente fontes. Se usar informacao externa, deixe claro o que e suposicao.
- Termine com proximos passos objetivos quando o pedido for tecnico ou estrategico.`;

type RawPuterModel = {
  id: string;
  name?: string;
  provider?: string;
};

const STORAGE_THREADS = "killa_chat_threads_v1";
const STORAGE_ACTIVE_THREAD = "killa_chat_active_thread_v1";
const STORAGE_IMAGE_MODEL = "killa_chat_image_model_v1";
const STORAGE_VIDEO_MODEL = "killa_chat_video_model_v1";
const STORAGE_MODEL_TOGGLE_COMPAT = "killa_model_toggle_compat_v1";

type ModelToggleCompat = {
  deepsearch: boolean;
  think: boolean;
  combo: boolean;
  verifiedAt: number;
};

function normalizeModelName(model: RawPuterModel): string {
  return model.name || model.id;
}

function normalizeModel(raw: RawPuterModel): ModelOption {
  return {
    id: raw.id,
    name: normalizeModelName(raw),
    provider: raw.provider,
  };
}

function pickDefaultModelId(models: ModelOption[]): string {
  if (!models.length) return DEFAULT_MODEL_ID;

  const normalizedHint = "claudeopus46";

  const found = models.find((item) => {
    const id = item.id.toLowerCase().replace(/[^a-z0-9]/g, "");
    const name = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return id.includes(normalizedHint) || name.includes(normalizedHint);
  });

  return found?.id || models[0].id;
}

function findEconomyModel(models: ModelOption[]): ModelOption | null {
  if (!models.length) return null;

  const scored = models
    .map((item) => {
      const raw = `${item.name} ${item.id} ${item.provider || ""}`.toLowerCase();
      let score = 0;

      if (raw.includes("free")) score += 10;
      if (raw.includes("mini")) score += 4;
      if (raw.includes("nano")) score += 4;
      if (raw.includes("flash")) score += 3;
      if (raw.includes("haiku")) score += 3;
      if (raw.includes("small")) score += 2;

      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.item || null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      message?: string;
      error?: { message?: string };
    };
    if (candidate.message) return candidate.message;
    if (candidate.error?.message) return candidate.error.message;
  }

  return "Unknown error";
}

function isLowBalanceError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("low balance") ||
    message.includes("not enough funding") ||
    message.includes("insufficient") ||
    message.includes("saldo") ||
    message.includes("funding")
  );
}

function isModerationError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("moderation") ||
    msg.includes("content moderation") ||
    msg.includes("policy") ||
    msg.includes("safety") ||
    msg.includes("blocked") ||
    msg.includes("refused")
  );
}

function isLikelyOpenAIModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes("openai") || lower.includes("gpt");
}

function buildToolInstruction(
  activeTools: string[],
  ctx?: {
    deepSearchAvailable?: boolean;
  }
): string {
  const instructions: string[] = [];

  if (activeTools.includes("deepsearch")) {
    if (ctx?.deepSearchAvailable === false) {
      instructions.push(
        "DeepSearch solicitado, mas a busca (dataset interno + web) falhou/esta indisponivel nesta tentativa. Nao invente fontes/links; responda apenas com conhecimento geral e deixe limites claros."
      );
    } else {
      instructions.push(
        "Modo DeepSearch ativo: use os resultados de busca fornecidos (Resultados de busca (DeepSearch)) para validar fatos com prioridade para o dataset interno. Inclua uma secao final 'Fontes' com links usados e, quando houver, identifique fontes do dataset interno. Nao invente links. Estruture com sintese, analise comparativa e conclusao objetiva."
      );
    }
  }

  if (activeTools.includes("think")) {
    instructions.push(
      "Modo Think ativo: faca raciocinio aprofundado antes de responder e destaque premissas, limites, trade-offs e riscos. Entregue resposta final com clareza executiva."
    );
  }

  if (activeTools.includes("create-images")) {
    instructions.push(
      "Create Images ativo: nao diga que voce nao consegue gerar imagens. Confirme em 1-2 linhas o que sera gerado com direcao visual profissional (estilo, luz, enquadramento, atmosfera)."
    );
  }

  if (activeTools.includes("edit-image")) {
    instructions.push(
      "Edit Image ativo: nao diga que voce nao consegue editar imagens. Confirme em 1-2 linhas a edicao solicitada com foco em fidelidade, consistencia visual e qualidade final."
    );
  }

  if (activeTools.includes("create-video")) {
    instructions.push(
      "Create Video ativo: nao diga que voce nao consegue gerar videos. Confirme em 1-2 linhas o video solicitado com direcao cinematografica (movimento de camera, ritmo, atmosfera)."
    );
  }

  return instructions.join("\n");
}

const streamTextDecoder = new TextDecoder();

function coerceContentToText(content: unknown, depth = 0): string {
  if (!content || depth > 6) return "";
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    // Common in OpenAI-style APIs: content can be an array of blocks.
    let out = "";
    for (const part of content) out += coerceContentToText(part, depth + 1);
    return out;
  }

  if (typeof content === "object") {
    const obj = content as Record<string, unknown>;

    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;

    // OpenAI Responses API blocks: { type: "...", text: "..." } or nested content arrays.
    if (Array.isArray(obj.content)) return coerceContentToText(obj.content, depth + 1);

    // Fallback for unknown block shapes: try a few common keys.
    for (const k of ["value", "output_text", "outputText"]) {
      if (typeof obj[k] === "string") return String(obj[k]);
    }
  }

  return "";
}

function coerceModelResponseToText(response: unknown, depth = 0): string {
  if (!response || depth > 6) return "";
  if (typeof response === "string") return response;

  if (typeof response === "object") {
    // Sometimes streaming yields Uint8Array chunks (ReadableStream async iterator).
    if (response instanceof Uint8Array) return streamTextDecoder.decode(response);
    if (response instanceof ArrayBuffer) return streamTextDecoder.decode(new Uint8Array(response));

    const obj = response as Record<string, unknown>;

    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.output_text === "string") return obj.output_text;
    if (typeof obj.content === "string") return obj.content;

    // Common wrappers.
    if (obj.message) {
      const msg = obj.message as Record<string, unknown>;
      const inner = coerceContentToText(msg.content, depth + 1) || coerceModelResponseToText(msg, depth + 1);
      if (inner) return inner;
    }

    // OpenAI-style: choices[0].message.content or choices[0].delta.content
    if (Array.isArray(obj.choices) && obj.choices.length > 0) {
      const c0 = obj.choices[0] as Record<string, unknown>;
      const delta = c0.delta as Record<string, unknown> | undefined;
      const msg = c0.message as Record<string, unknown> | undefined;

      const picked =
        coerceContentToText(delta?.content, depth + 1) ||
        coerceContentToText(delta?.text, depth + 1) ||
        coerceContentToText(msg?.content, depth + 1) ||
        (typeof c0.text === "string" ? c0.text : "") ||
        (typeof c0.content === "string" ? c0.content : "");

      if (picked) return picked;
    }

    // OpenAI Responses API: output: [{ content: [...] }]
    if (Array.isArray(obj.output) && obj.output.length > 0) {
      let out = "";
      for (const item of obj.output) {
        const it = item as Record<string, unknown>;
        out += coerceContentToText(it.content, depth + 1) || coerceModelResponseToText(it, depth + 1);
      }
      if (out) return out;
    }

    if (obj.data) {
      const inner = coerceModelResponseToText(obj.data, depth + 1);
      if (inner) return inner;
    }

    if (obj.result) {
      const inner = coerceModelResponseToText(obj.result, depth + 1);
      if (inner) return inner;
    }
  }

  return "";
}

function extractStreamText(part: unknown): string {
  if (!part) return "";
  if (typeof part === "string") return part;

  return coerceModelResponseToText(part);
}

function parseNonStreamResponse(response: unknown): string {
  return coerceModelResponseToText(response);
}

function isAbortError(error: unknown): boolean {
  // fetch() aborts with a DOMException named "AbortError" in browsers.
  // Some libs may throw a plain Error with "aborted" message instead.
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes("abort") || msg.includes("aborted");
}

function createInitialThread(kind: ThreadKind = "chat"): ChatThread {
  const now = Date.now();
  const k = coerceThreadKind(kind);
  const defaultTools = k === "media" ? ["create-images"] : [];
  return {
    id: crypto.randomUUID(),
    title: k === "media" ? UNTITLED_MEDIA_TITLE : UNTITLED_CHAT_TITLE,
    kind: k,
    activeTool: defaultTools[0] || null,
    activeTools: defaultTools,
    archived: false,
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text:
          k === "media"
            ? "Modo Midia: gere imagens e videos aqui. Ative Create Images / Edit Image / Create Video e envie seu prompt."
            : "O que voce precisa? Codigo, automacao, estrategia ou debug? KKKK.. Manda ai.",
        createdAt: now,
      },
    ],
  };
}

function loadThreadsFromStorage(): { threads: ChatThread[]; activeId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_THREADS);
    const activeRaw = localStorage.getItem(STORAGE_ACTIVE_THREAD);
    if (!raw) {
      const t = createInitialThread("chat");
      return { threads: [t], activeId: t.id };
    }

    const parsed = JSON.parse(raw) as ChatThread[];
    const threads = (Array.isArray(parsed) ? parsed : []).map((t) => {
      const normalizedTools = normalizeToolSelection(
        coerceActiveTools(
          (t as {
            activeTools?: unknown;
            activeTool?: unknown;
          }).activeTools ?? (t as { activeTool?: unknown }).activeTool
        )
      );

      return {
        ...t,
        kind: coerceThreadKind((t as { kind?: unknown }).kind),
        activeTools: normalizedTools,
        activeTool: normalizedTools[0] || null,
      };
    });
    const activeId = activeRaw && threads.some((t) => t.id === activeRaw) ? activeRaw : (threads[0]?.id || "");

    if (!threads.length) {
      const t = createInitialThread("chat");
      return { threads: [t], activeId: t.id };
    }

    return { threads, activeId };
  } catch {
    const t = createInitialThread("chat");
    return { threads: [t], activeId: t.id };
  }
}

function deriveTitleFromText(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return UNTITLED_CHAT_TITLE;
  return t.length > 38 ? `${t.slice(0, 38)}...` : t;
}

function extractImageModelHint(text: string): { prompt: string; modelId: string | null } {
  // Minimal, no-UI model picker for Create Images:
  // - Use `--seedream` to force Seedream 4.5
  // - Use `--nano` to force Nano Banana Pro
  // The tag is removed from the visible user message + prompt sent to providers.
  let prompt = String(text || "");
  let modelId: string | null = null;

  if (/(^|\\s)--seedream(?:45)?(\\s|$)/i.test(prompt)) {
    modelId = "seedream-4.5";
    prompt = prompt.replace(/(^|\\s)--seedream(?:45)?(\\s|$)/gi, " ");
  } else if (/(^|\\s)--nano(\\s|$)/i.test(prompt)) {
    modelId = "nano-banana-pro";
    prompt = prompt.replace(/(^|\\s)--nano(\\s|$)/gi, " ");
  }

  prompt = prompt.replace(/\\s+/g, " ").trim();
  return { prompt, modelId };
}

function parseRequestedVideoDurationSeconds(text: string): number | null {
  const t = String(text || "").toLowerCase();

  // Common PT-BR patterns:
  // - "5 segundos", "5s", "5 seg"
  // - "ate 5 segundos"
  // - "de 5 segundos"
  const m =
    t.match(/\b(\d{1,3})\s*(?:s\b|seg\b|segs\b|segundo\b|segundos\b)/i) ||
    t.match(/\bate\s*(\d{1,3})\s*(?:s\b|seg\b|segs\b|segundo\b|segundos\b)/i) ||
    t.match(/\bde\s*(\d{1,3})\s*(?:s\b|seg\b|segs\b|segundo\b|segundos\b)/i);

  if (!m) return null;

  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function parseRequestedVideoAspectRatio(text: string): {
  value: VideoAspectRatio | null;
  requested: string | null;
} {
  const t = String(text || "").toLowerCase();

  const direct = t.match(/\b(16:9|4:3|1:1|9:16|3:4|3:2|2:3)\b/);
  if (direct?.[1]) {
    return { value: direct[1] as VideoAspectRatio, requested: direct[1] };
  }

  const generic = t.match(/\b(\d{1,2})\s*[:x/]\s*(\d{1,2})\b/);
  if (generic?.[1] && generic?.[2]) {
    const candidate = `${Number(generic[1])}:${Number(generic[2])}`;
    if ((VIDEO_ASPECT_RATIOS as readonly string[]).includes(candidate)) {
      return { value: candidate as VideoAspectRatio, requested: candidate };
    }
    return { value: null, requested: candidate };
  }

  if (/\b(vertical|portrait|retrato|verticalmente)\b/.test(t)) return { value: "9:16", requested: "9:16" };
  if (/\b(horizontal|landscape|paisagem|widescreen)\b/.test(t)) return { value: "16:9", requested: "16:9" };
  if (/\b(square|quadrado)\b/.test(t)) return { value: "1:1", requested: "1:1" };

  return { value: null, requested: null };
}

function parseRequestedVideoResolution(text: string): {
  value: VideoResolution | null;
  requested: string | null;
} {
  const t = String(text || "").toLowerCase();

  const direct = t.match(/\b(720p|480p)\b/);
  if (direct?.[1]) return { value: direct[1] as VideoResolution, requested: direct[1] };

  const generic = t.match(/\b(\d{3,4})p\b/);
  if (generic?.[1]) {
    const candidate = `${Number(generic[1])}p`;
    if ((VIDEO_RESOLUTIONS as readonly string[]).includes(candidate)) {
      return { value: candidate as VideoResolution, requested: candidate };
    }
    return { value: null, requested: candidate };
  }

  if (/\b(hd)\b/.test(t)) return { value: "720p", requested: "720p" };
  if (/\b(sd)\b/.test(t)) return { value: "480p", requested: "480p" };

  return { value: null, requested: null };
}

function isYes(text: string): boolean {
  const t = stripDiacritics(String(text || "")).trim().toLowerCase();
  return /^(sim|confirmar|confirmo|ok|bora)\b/.test(t);
}

function isNo(text: string): boolean {
  const t = stripDiacritics(String(text || "")).trim().toLowerCase();
  return /^(nao|cancelar|cancela|pare|stop)\b/.test(t);
}
function getLatestImageUrl(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const att = m.attachments || [];
    for (let j = att.length - 1; j >= 0; j--) {
      if (att[j].kind === "image") return att[j].url;
    }
  }
  return null;
}

async function fileToDataUrl(file: File): Promise<string> {
  const maxInputMb = 20;
  if (file.size > maxInputMb * 1024 * 1024) {
    throw new Error(`Imagem muito grande. Max ${maxInputMb}MB.`);
  }

  const readAsDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    });

  // ModelsLab image-to-image endpoints have been failing with PNG inputs in practice.
  // To keep Edit Image / Create Video reliable for common uploads, we normalize
  // attachments to a compressed JPEG data URL in the browser.
  if (!file.type.startsWith("image/")) {
    return await readAsDataUrl(file);
  }

  const maxBytes = 4.5 * 1024 * 1024; // keep below ModelsLab base64_to_url limits (~5MB)
  if (file.type === "image/jpeg" && file.size <= maxBytes) {
    return await readAsDataUrl(file);
  }

  const loadImage = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Falha ao decodificar a imagem."));
      img.src = url;
    });

  const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error("Falha ao converter a imagem."));
          else resolve(blob);
        },
        "image/jpeg",
        quality
      );
    });

  const qualities = [0.92, 0.86, 0.8, 0.74, 0.68, 0.62];
  const maxDimension = 1536;

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const srcW = img.naturalWidth || img.width || 0;
    const srcH = img.naturalHeight || img.height || 0;
    if (!srcW || !srcH) {
      // Fallback to the original, if the browser can't decode the image.
      return await readAsDataUrl(file);
    }

    let targetW = srcW;
    let targetH = srcH;
    const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
    targetW = Math.max(1, Math.round(srcW * scale));
    targetH = Math.max(1, Math.round(srcH * scale));

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas nao suportado neste navegador.");

    const render = (w: number, h: number) => {
      canvas.width = w;
      canvas.height = h;
      // JPEG has no alpha. Fill with black to avoid transparent->black surprises being undefined.
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
    };

    render(targetW, targetH);

    const tryEncode = async (): Promise<Blob | null> => {
      for (const q of qualities) {
        // eslint-disable-next-line no-await-in-loop
        const blob = await canvasToBlob(canvas, q);
        if (blob.size <= maxBytes) return blob;
      }
      return null;
    };

    let encoded = await tryEncode();
    if (!encoded) {
      // Downscale further if we still exceed size.
      let w = targetW;
      let h = targetH;
      for (let i = 0; i < 4; i++) {
        w = Math.max(256, Math.round(w * 0.75));
        h = Math.max(256, Math.round(h * 0.75));
        render(w, h);
        // eslint-disable-next-line no-await-in-loop
        encoded = await tryEncode();
        if (encoded) break;
      }
    }

    if (!encoded) {
      throw new Error("Imagem muito grande para enviar (mesmo apos compressao). Tente uma imagem menor.");
    }

    return await readAsDataUrl(encoded);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function reframeImageForVideoAspect(dataUrl: string, aspectRatio: VideoAspectRatio): Promise<string> {
  const src = String(dataUrl || "").trim();
  if (!src) return src;

  const targetRatio = videoAspectRatioToNumber(aspectRatio);
  if (!Number.isFinite(targetRatio) || targetRatio <= 0) return src;

  const loadImage = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Falha ao preparar imagem de referencia para video."));
      img.src = url;
    });

  const readAsDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Falha ao ler a imagem convertida."));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    });

  const img = await loadImage(src);
  const srcW = img.naturalWidth || img.width || 0;
  const srcH = img.naturalHeight || img.height || 0;
  if (!srcW || !srcH) return src;

  const currentRatio = srcW / srcH;
  if (Math.abs(currentRatio - targetRatio) <= 0.012) return src;

  const maxLong = 1536;
  const longBase = Math.min(maxLong, Math.max(srcW, srcH));
  let outW = targetRatio >= 1 ? longBase : Math.round(longBase * targetRatio);
  let outH = targetRatio >= 1 ? Math.round(longBase / targetRatio) : longBase;

  outW = Math.max(256, outW);
  outH = Math.max(256, outH);

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);

  const scale = Math.min(outW / srcW, outH / srcH);
  const drawW = Math.max(1, Math.round(srcW * scale));
  const drawH = Math.max(1, Math.round(srcH * scale));
  const dx = Math.round((outW - drawW) / 2);
  const dy = Math.round((outH - drawH) / 2);
  ctx.drawImage(img, dx, dy, drawW, drawH);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9);
  });
  if (!blob) return src;
  return await readAsDataUrl(blob);
}

async function probeVideoMetadata(
  url: string,
  timeoutMs = 15000
): Promise<{ duration: number; width: number; height: number } | null> {
  const src = String(url || "").trim();
  if (!src) return null;

  return await new Promise((resolve) => {
    const video = document.createElement("video");
    let done = false;
    const settle = (value: { duration: number; width: number; height: number } | null) => {
      if (done) return;
      done = true;
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };

    const t = window.setTimeout(() => settle(null), timeoutMs);
    const clear = () => window.clearTimeout(t);

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.onloadedmetadata = () => {
      clear();
      const duration = Number(video.duration);
      const width = Number(video.videoWidth);
      const height = Number(video.videoHeight);
      if (!Number.isFinite(duration) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        settle(null);
        return;
      }
      settle({ duration, width, height });
    };
    video.onerror = () => {
      clear();
      settle(null);
    };
    video.src = src;
  });
}

async function apiJson<T>(url: string, body: unknown, token?: string | null, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { success: false, error: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.errorMessage || data?.message || `HTTP ${res.status}`);
    (err as any).payload = data;
    throw err;
  }
  return data as T;
}

async function apiGetJson<T>(url: string, token?: string | null, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: "GET",
    headers: Object.keys(headers).length ? headers : undefined,
    signal,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { success: false, error: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
    (err as any).payload = data;
    throw err;
  }
  return data as T;
}

function readApiErrorPayload(error: unknown): any {
  if (!error || typeof error !== "object") return null;
  return (error as any).payload || null;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((r) => setTimeout(r, ms));
    return;
  }

  if (signal.aborted) {
    const e = new Error("Aborted");
    (e as any).name = "AbortError";
    throw e;
  }

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      const e = new Error("Aborted");
      (e as any).name = "AbortError";
      reject(e);
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function pollVideo(
  requestId: string,
  token?: string | null | (() => Promise<string | null>),
  signal?: AbortSignal
): Promise<{ url: string; duration?: number }> {
  const resolveToken = async (): Promise<string | null> => {
    if (typeof token === "function") {
      try {
        return (await token()) || null;
      } catch {
        return null;
      }
    }
    return token || null;
  };

  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(3000, signal);
    if (signal?.aborted) {
      const e = new Error("Aborted");
      (e as any).name = "AbortError";
      throw e;
    }
    let currentToken = await resolveToken();
    const headers: Record<string, string> = {};
    if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
    const res = await fetch(`/api/video/status/${encodeURIComponent(requestId)}`, {
      method: "GET",
      headers: Object.keys(headers).length ? headers : undefined,
      signal,
    });

    if (res.status === 401 && typeof token === "function") {
      // Session tokens can expire while polling long video jobs; retry once with a refreshed token.
      currentToken = await resolveToken();
      if (!currentToken) {
        throw new Error("Sessao expirada durante a geracao do video. Faca login novamente e tente de novo.");
      }
      const retryRes = await fetch(`/api/video/status/${encodeURIComponent(requestId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${currentToken}` },
        signal,
      });
      if (!retryRes.ok) {
        if (retryRes.status === 401) {
          throw new Error("Sessao expirada durante a geracao do video. Faca login novamente e tente de novo.");
        }
        throw new Error(`Falha ao consultar status do video (HTTP ${retryRes.status}).`);
      }
      const retryData = await retryRes.json();
      if (retryData.status === "done" && retryData.video?.url) {
        return { url: String(retryData.video.url), duration: retryData.video.duration };
      }
      if (retryData.status === "expired" || retryData.status === "error") {
        throw new Error(retryData.error || "Video falhou/expirou.");
      }
      continue;
    }

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("Sessao expirada durante a geracao do video. Faca login novamente e tente de novo.");
      }
      throw new Error(`Falha ao consultar status do video (HTTP ${res.status}).`);
    }

    const data = await res.json();

    if (data.status === "done" && data.video?.url) {
      return { url: String(data.video.url), duration: data.video.duration };
    }
    if (data.status === "expired" || data.status === "error") {
      throw new Error(data.error || "Video falhou/expirou.");
    }
  }
  throw new Error("Timeout ao gerar video.");
}

export default function App() {
  const { getToken, isLoaded: authLoaded } = useAuth();
  const clerk = useClerk();
  const initial = useMemo(() => loadThreadsFromStorage(), []);

  const [threads, setThreads] = useState<ChatThread[]>(initial.threads);
  const [activeThreadId, setActiveThreadId] = useState<string>(initial.activeId);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Desktop defaults to open; mobile defaults to closed.
    try {
      return window.matchMedia && window.matchMedia("(min-width: 981px)").matches;
    } catch {
      return false;
    }
  });

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || threads[0],
    [threads, activeThreadId]
  );

  const messages = activeThread?.messages || [];

  const threadsRef = useRef<ChatThread[]>(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [typingAssistantId, setTypingAssistantId] = useState<string | null>(null);
  const [model, setModel] = useState(DEFAULT_MODEL_ID);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [reasoningByAssistantId, setReasoningByAssistantId] = useState<Record<string, ReasoningTrace>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [betaAccess, setBetaAccess] = useState<BetaAccessState | null>(null);
  const [betaCheckout, setBetaCheckout] = useState<BetaCheckoutState | null>(null);
  const [betaLoading, setBetaLoading] = useState(true);
  const [betaGateError, setBetaGateError] = useState("");
  const [betaRedeeming, setBetaRedeeming] = useState(false);

  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>([]);
  type PendingVideoConfirm = {
    prompt: string;
    sourceImageDataUrl: string;
    imageDataUrl: string;
    duration: number;
    aspect_ratio: VideoAspectRatio;
    resolution: VideoResolution;
    model_id?: string;
  };
  const [pendingVideoConfirms, setPendingVideoConfirms] = useState<Record<string, PendingVideoConfirm>>({});
  const [imageModel, setImageModel] = useState<"seedream-4.5" | "nano-banana-pro">(() => {
    try {
      const raw = String(localStorage.getItem(STORAGE_IMAGE_MODEL) || "").trim();
      if (raw === "seedream-4.5" || raw === "nano-banana-pro") return raw;
    } catch {
      // ignore
    }
    return "seedream-4.5";
  });
  const [videoModel, setVideoModel] = useState<"modelslab-grok-imagine-video-i2v">(() => {
    try {
      const raw = String(localStorage.getItem(STORAGE_VIDEO_MODEL) || "").trim();
      if (raw === "modelslab-grok-imagine-video-i2v") return raw;
      if (raw === "xai-grok-imagine-video" || raw === "replicate-grok-imagine-video") return "modelslab-grok-imagine-video-i2v";
    } catch {
      // ignore
    }
    return "modelslab-grok-imagine-video-i2v";
  });

  const refreshBetaAccess = async (tokenOverride?: string | null, signal?: AbortSignal) => {
    const token = tokenOverride ?? (await getToken().catch(() => null));
    if (!token) {
      setBetaAccess(null);
      setBetaCheckout(null);
      setBetaLoading(false);
      return null;
    }

    const response = await apiGetJson<{ success: boolean; access: BetaAccessState; checkout: BetaCheckoutState }>(
      "/api/beta/access",
      token,
      signal
    );
    setBetaAccess(response.access);
    setBetaCheckout(response.checkout || null);
    setBetaLoading(false);
    return response.access;
  };

  const postBetaCharge = async (
    action: BetaAction,
    operationId: string,
    token: string,
    signal?: AbortSignal
  ): Promise<{ charge_id: string; access: BetaAccessState }> => {
    const response = await apiJson<{ success: boolean; charge_id: string; access: BetaAccessState }>(
      "/api/beta/charge",
      { action, operation_id: operationId },
      token,
      signal
    );
    if (response.access) setBetaAccess(response.access);
    return { charge_id: response.charge_id, access: response.access };
  };

  const postBetaRefund = async (chargeId: string, reason: string, token: string): Promise<void> => {
    if (!chargeId) return;
    try {
      const response = await apiJson<{ success: boolean; access: BetaAccessState }>(
        "/api/beta/refund",
        { charge_id: chargeId, reason },
        token
      );
      if (response.access) setBetaAccess(response.access);
    } catch {
      // Refund failure should not break the UX flow.
    }
  };
  const [modelToggleCompatById, setModelToggleCompatById] = useState<Record<string, ModelToggleCompat>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_MODEL_TOGGLE_COMPAT);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, Partial<ModelToggleCompat>>;
      if (!parsed || typeof parsed !== "object") return {};

      const normalized: Record<string, ModelToggleCompat> = {};
      for (const [id, value] of Object.entries(parsed)) {
        if (!id || !value || typeof value !== "object") continue;
        normalized[id] = {
          deepsearch: Boolean(value.deepsearch),
          think: Boolean(value.think),
          combo: Boolean(value.combo),
          verifiedAt: Number(value.verifiedAt) || Date.now(),
        };
      }
      return normalized;
    } catch {
      return {};
    }
  });
  const [modelCompatCheckingById, setModelCompatCheckingById] = useState<Record<string, boolean>>({});
  const modelCompatInFlightRef = useRef<Set<string>>(new Set());

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const inflightRef = useRef<{
    threadId: string;
    assistantId: string;
    prompt: string;
    pendingImages?: PendingImageAttachment[];
    controller: AbortController;
  } | null>(null);
  const thinkingAssistantRef = useRef<string | null>(null);

  const trimmed = input.trim();

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Persist tool selection per-thread (so "Chat" and "Midia" threads don't fight over toggles).
  useEffect(() => {
    const tools = normalizeToolSelection(
      coerceActiveTools(
        activeThread?.activeTools && activeThread.activeTools.length > 0 ? activeThread.activeTools : activeThread?.activeTool
      )
    );
    setActiveTools((prev) => {
      if (prev.length === tools.length && prev.every((item, idx) => item === tools[idx])) return prev;
      return tools;
    });
  }, [activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const max = activeTools.includes("edit-image") ? EDIT_IMAGE_MAX_ATTACHMENTS : 1;
    setPendingImages((prev) => (prev.length <= max ? prev : prev.slice(0, max)));
  }, [activeTools]);

  useEffect(() => {
    try {
      // Never persist data/blob URLs into localStorage (can easily exceed quota).
      // We only persist remote URLs so chat history stays lightweight and stable.
      const sanitized = threads.map((t) => ({
        ...t,
        messages: t.messages.map((m) => {
          const atts = (m.attachments || []).filter((a) => /^https?:\/\//i.test(a.url));
          return { ...m, attachments: atts.length ? atts : undefined };
        }),
      }));

      localStorage.setItem(STORAGE_THREADS, JSON.stringify(sanitized));
      localStorage.setItem(STORAGE_ACTIVE_THREAD, String(activeThreadId));
    } catch {
      // ignore storage failures
    }
  }, [threads, activeThreadId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_IMAGE_MODEL, imageModel);
    } catch {
      // ignore
    }
  }, [imageModel]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_VIDEO_MODEL, videoModel);
    } catch {
      // ignore
    }
  }, [videoModel]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MODEL_TOGGLE_COMPAT, JSON.stringify(modelToggleCompatById));
    } catch {
      // ignore
    }
  }, [modelToggleCompatById]);

  useEffect(() => {
    if (!activeThreadId && threads[0]) setActiveThreadId(threads[0].id);
  }, [activeThreadId, threads]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, activeThreadId]);

  const fetchModelsFromPuter = async (isCancelled?: () => boolean) => {
    if (!window.puter) return;

    if (isCancelled?.()) return;
    setModelsLoading(true);

    try {
      const rawModels = await window.puter.ai.listModels();
      const allModels = (Array.isArray(rawModels) ? rawModels : [])
        .filter((item): item is RawPuterModel => Boolean(item?.id))
        .map(normalizeModel)
        .sort((a, b) => {
          const left = `${a.name} ${a.provider || ""}`.toLowerCase();
          const right = `${b.name} ${b.provider || ""}`.toLowerCase();
          return left.localeCompare(right);
        });

      if (isCancelled?.()) return;

      if (allModels.length) {
        setModels(allModels);
        // Keep the current selection if it still exists, otherwise pick a sensible default.
        setModel((prev) => (allModels.some((m) => m.id === prev) ? prev : pickDefaultModelId(allModels)));
      } else {
        setModels([{ id: DEFAULT_MODEL_ID, name: "Claude Opus 4.6", provider: "anthropic" }]);
        setModel(DEFAULT_MODEL_ID);
      }
    } catch {
      if (isCancelled?.()) return;
      setModels([{ id: DEFAULT_MODEL_ID, name: "Claude Opus 4.6", provider: "anthropic" }]);
      setModel(DEFAULT_MODEL_ID);
    } finally {
      if (isCancelled?.()) return;
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function bootstrapPuter() {
      if (!window.puter) {
        if (!cancelled) {
          setModels([{ id: DEFAULT_MODEL_ID, name: "Claude Opus 4.6", provider: "anthropic" }]);
          setModelsLoading(false);
          // keep UI working even without Puter
        }
        return;
      }

      setConnected(window.puter.auth.isSignedIn());

      try {
        await fetchModelsFromPuter(() => cancelled);
      } catch {
        if (!cancelled) {
          setModels([{ id: DEFAULT_MODEL_ID, name: "Claude Opus 4.6", provider: "anthropic" }]);
          setModel(DEFAULT_MODEL_ID);
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }

    void bootstrapPuter();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!connected || modelsLoading) return;
    if (!model) return;
    if (modelToggleCompatById[model]) return;
    if (modelCompatInFlightRef.current.has(model)) return;
    void runModelToggleCompatibilityCheck(model);
  }, [connected, modelsLoading, model, modelToggleCompatById]);

  useEffect(() => {
    if (!authLoaded) return;
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      try {
        setBetaLoading(true);
        await refreshBetaAccess(undefined, controller.signal);
      } catch {
        if (!cancelled) {
          setBetaLoading(false);
          setBetaGateError("Falha ao carregar status da licenca. Tente atualizar a pagina.");
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSend = useMemo(() => trimmed.length > 0 && !thinking, [trimmed, thinking]);

  const updateThread = (id: string, updater: (t: ChatThread) => ChatThread) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
  };

  const appendToThread = (threadId: string, items: ChatMessage[], maybeTitle?: string) => {
    updateThread(threadId, (t) => {
      const now = Date.now();
      return {
        ...t,
        title: maybeTitle || t.title,
        updatedAt: now,
        messages: [...t.messages, ...items],
      };
    });
  };

  const updateMessageInThread = (threadId: string, messageId: string, patch: Partial<ChatMessage>) => {
    updateThread(threadId, (t) => ({
      ...t,
      updatedAt: Date.now(),
      messages: t.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
    }));
  };

  const appendTextToMessageInThread = (threadId: string, messageId: string, extra: string) => {
    const addition = String(extra || "").trim();
    if (!addition) return;

    updateThread(threadId, (t) => ({
      ...t,
      updatedAt: Date.now(),
      messages: t.messages.map((m) => {
        if (m.id !== messageId) return m;
        const prev = String(m.text || "").trim();
        const next = prev ? `${prev}\n\n${addition}` : addition;
        return { ...m, text: next };
      }),
    }));
  };

  const addAttachmentsToMessageInThread = (threadId: string, messageId: string, attachments: ChatAttachment[]) => {
    setTypingAssistantId((cur) => (cur === messageId ? null : cur));
    updateThread(threadId, (t) => ({
      ...t,
      updatedAt: Date.now(),
      messages: t.messages.map((m) => {
        if (m.id !== messageId) return m;
        const prev = m.attachments || [];
        const seen = new Set(prev.map((a) => `${a.kind}:${a.url}`));
        const next: ChatAttachment[] = [...prev];
        for (const item of attachments) {
          const key = `${item.kind}:${item.url}`;
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(item);
        }

        const currentText = String(m.text || "");
        const nextText = isAssistantPlaceholderText(currentText) ? "Pronto." : currentText;

        return { ...m, text: nextText, attachments: next };
      }),
    }));
  };

  const upsertReasoningTrace = (assistantId: string, trace: ReasoningTrace) => {
    setReasoningByAssistantId((prev) => ({ ...prev, [assistantId]: trace }));
  };

  const patchReasoningTrace = (assistantId: string, updater: (trace: ReasoningTrace) => ReasoningTrace) => {
    setReasoningByAssistantId((prev) => {
      const current = prev[assistantId];
      if (!current) return prev;
      return { ...prev, [assistantId]: updater(current) };
    });
  };

  const markReasoningStep = (
    assistantId: string,
    stepId: string,
    status: "pending" | "active" | "done",
    note?: string
  ) => {
    patchReasoningTrace(assistantId, (trace) => ({
      ...trace,
      steps: trace.steps.map((step) => (step.id === stepId ? { ...step, status, note } : step)),
    }));
  };

  const setReasoningQueries = (assistantId: string, queries: string[]) => {
    patchReasoningTrace(assistantId, (trace) => ({ ...trace, queries: queries.slice(0, 5) }));
  };

  const setReasoningOptimizedQueries = (assistantId: string, queries: string[]) => {
    patchReasoningTrace(assistantId, (trace) => ({ ...trace, optimizedQueries: queries.slice(0, 5) }));
  };

  const setReasoningOptimizerKeywords = (assistantId: string, keywords: string[]) => {
    patchReasoningTrace(assistantId, (trace) => ({
      ...trace,
      optimizer: trace.optimizer
        ? {
            ...trace.optimizer,
            keywords: dedupeQueries(keywords, 8),
          }
        : trace.optimizer,
    }));
  };

  const setReasoningSources = (assistantId: string, sources: Array<{ title: string; url?: string }>) => {
    patchReasoningTrace(assistantId, (trace) => ({ ...trace, sources: sources.slice(0, 8) }));
  };

  const clearReasoningTrace = (assistantId: string) => {
    setReasoningByAssistantId((prev) => {
      if (!prev[assistantId]) return prev;
      const { [assistantId]: _drop, ...rest } = prev;
      return rest;
    });
  };

  const withTimeout = async <T,>(promise: Promise<T>, ms = 20000): Promise<T> => {
    return await new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error("timeout"));
      }, ms);

      promise
        .then((value) => {
          window.clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          window.clearTimeout(timer);
          reject(error);
        });
    });
  };

  const readChatResponseText = async (response: unknown): Promise<string> => {
    if (response && typeof (response as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
      let full = "";
      for await (const part of response as AsyncIterable<unknown>) {
        full += extractStreamText(part);
      }
      return full.trim();
    }
    return parseNonStreamResponse(response).trim();
  };

  const runModelToggleCompatibilityCheck = async (modelId: string) => {
    if (!window.puter || !window.puter.auth.isSignedIn()) return;
    if (!modelId || modelCompatInFlightRef.current.has(modelId)) return;

    modelCompatInFlightRef.current.add(modelId);
    setModelCompatCheckingById((prev) => ({ ...prev, [modelId]: true }));

    const sys = (content: string) => ({ role: "system" as const, content });
    const user = (content: string) => ({ role: "user" as const, content });

    let deepsearchOk = false;
    let thinkOk = false;

    try {
      const deepPayload = [
        sys(SYSTEM_PROMPT.trim()),
        sys("Teste tecnico interno: DeepSearch."),
        sys(
          "Resultados de busca (DeepSearch):\n\n[#1] Exemplo\nURL: https://example.com\nResumo: teste de compatibilidade."
        ),
        user("Responda somente: OK"),
      ];

      const deepRes = await withTimeout(window.puter.ai.chat(deepPayload, { model: modelId, stream: false }), 22000);
      deepsearchOk = (await readChatResponseText(deepRes)).length > 0;
    } catch {
      deepsearchOk = false;
    }

    try {
      const planPayload = [
        sys(SYSTEM_PROMPT.trim()),
        sys("Teste tecnico interno: THINK 2-pass. Gere apenas um plano curto com 3 itens."),
        user("Como melhorar foco no estudo?"),
      ];
      const planRes = await withTimeout(window.puter.ai.chat(planPayload, { model: modelId, stream: false }), 22000);
      const planText = (await readChatResponseText(planRes)).slice(0, 800);

      const finalPayload = [
        sys(SYSTEM_PROMPT.trim()),
        sys(
          planText
            ? `MODO THINK (2-PASS): use o plano interno e responda de forma final sem mostrar cadeia de pensamento.\n\nPLANO:\n${planText}`
            : "MODO THINK: responda de forma curta e objetiva sem mostrar cadeia de pensamento."
        ),
        user("Como melhorar foco no estudo?"),
      ];

      const finalRes = await withTimeout(window.puter.ai.chat(finalPayload, { model: modelId, stream: false }), 22000);
      thinkOk = (await readChatResponseText(finalRes)).length > 0;
    } catch {
      thinkOk = false;
    }

    setModelToggleCompatById((prev) => ({
      ...prev,
      [modelId]: {
        deepsearch: deepsearchOk,
        think: thinkOk,
        combo: deepsearchOk && thinkOk,
        verifiedAt: Date.now(),
      },
    }));

    setModelCompatCheckingById((prev) => {
      if (!prev[modelId]) return prev;
      const { [modelId]: _drop, ...rest } = prev;
      return rest;
    });
    modelCompatInFlightRef.current.delete(modelId);
  };

  const appendToActive = (items: ChatMessage[], maybeTitle?: string) => {
    if (!activeThread) return;
    appendToThread(activeThread.id, items, maybeTitle);
  };

  const ensureSignedIn = async (): Promise<boolean> => {
    if (!window.puter) return false;

    if (window.puter.auth.isSignedIn()) {
      setConnected(true);
      // Ensure we have the freshest model list for the current account.
      if (!modelsLoading && models.length === 0) void fetchModelsFromPuter();
      return true;
    }

    try {
      await window.puter.auth.signIn();
      const logged = window.puter.auth.isSignedIn();
      setConnected(logged);
      if (logged) void fetchModelsFromPuter();
      return logged;
    } catch {
      setConnected(false);
      return false;
    }
  };

  const handleConnectClick = async () => {
    const ok = await ensureSignedIn();
    if (!ok) {
      appendToActive([
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Sign-in nao concluido. Conecte sua conta Puter para conversar.",
          createdAt: Date.now(),
        },
      ]);
      return;
    }

    // Different Puter accounts can have different model availability.
    void fetchModelsFromPuter();
  };

  const handleDisconnectClick = () => {
    const puter = window.puter;
    try {
      puter?.auth.signOut?.();
    } finally {
      // Keep chat history/messages; only detach the session.
      setConnected(false);
    }
  };

  const toggleTool = (toolId: string) => {
    setActiveTools((prev) => {
      const current = normalizeToolSelection(prev);
      const isActive = current.includes(toolId);
      let next: string[];

      if (isActive) {
        next = current.filter((item) => item !== toolId);
      } else if (MEDIA_TOOL_IDS.has(toolId)) {
        // Media tools are exclusive.
        next = [toolId];
      } else if (TEXT_TOOL_IDS.has(toolId)) {
        // Text tools can run together as DeepSearch + Think.
        const withoutMedia = current.filter((item) => !MEDIA_TOOL_IDS.has(item));
        next = normalizeToolSelection([...withoutMedia, toolId]);
      } else {
        next = normalizeToolSelection(current);
      }

      if (activeThread) {
        updateThread(activeThread.id, (t) => ({
          ...t,
          activeTools: next,
          activeTool: next[0] || null,
          updatedAt: Date.now(),
        }));
      }

      return next;
    });
  };

  const closeSidebarOverlay = () => {
    // Sidebar is an overlay only on mobile widths. On desktop it is a collapsible column,
    // so we should not auto-close it when creating/selecting chats.
    try {
      if (window.matchMedia && window.matchMedia("(max-width: 980px)").matches) {
        setSidebarOpen(false);
      }
    } catch {
      // ignore
    }
  };

  const createNewChat = (kind: ThreadKind = "chat") => {
    const t = createInitialThread(kind);
    setThreads((prev) => [t, ...prev]);
    setActiveThreadId(t.id);
    closeSidebarOverlay();
    setInput("");
    setPendingImages([]);
  };

  const renameChat = (id: string, title: string) => {
    updateThread(id, (t) => ({ ...t, title: title.trim() || t.title, updatedAt: Date.now() }));
  };

  const toggleArchiveChat = (id: string) => {
    updateThread(id, (t) => ({ ...t, archived: !t.archived, updatedAt: Date.now() }));
  };

  const deleteChat = (id: string) => {
    setThreads((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveThreadId((cur) => (cur === id ? next[0]?.id || "" : cur));
      return next;
    });
  };

  const selectChat = (id: string) => {
    setActiveThreadId(id);
    closeSidebarOverlay();
  };

  const cancelGeneration = () => {
    const inflight = inflightRef.current;
    if (!inflight) return;

    try {
      inflight.controller.abort();
    } catch {
      // ignore
    }

    inflightRef.current = null;
    thinkingAssistantRef.current = null;

    // Restore the prompt so the user can quickly adjust and re-send.
    setInput((cur) => (cur.trim().length > 0 ? cur : inflight.prompt));

    if (inflight.pendingImages?.length) {
      setPendingImages((cur) => (cur.length > 0 ? cur : inflight.pendingImages || []));
    }

    // If we were in the middle of a video flow, clear the pending confirmation for this thread.
    setPendingVideoConfirms((prev) => {
      if (!prev[inflight.threadId]) return prev;
      const { [inflight.threadId]: _d, ...rest } = prev;
      return rest;
    });

    const thread = threadsRef.current.find((t) => t.id === inflight.threadId);
    const msg = thread?.messages.find((m) => m.id === inflight.assistantId);
    const hasAttachments = Boolean(msg?.attachments && msg.attachments.length > 0);
    const currentText = String(msg?.text || "");

    const nextText = hasAttachments
      ? currentText.trim()
        ? currentText
        : "Pronto."
      : isAssistantPlaceholderText(currentText)
        ? "Cancelado."
        : `${currentText}\n\n---\n\n> Geracao cancelada.`;

    updateMessageInThread(inflight.threadId, inflight.assistantId, { text: nextText });
    clearReasoningTrace(inflight.assistantId);

    setThinking(false);
    setTypingAssistantId((cur) => (cur === inflight.assistantId ? null : cur));
  };

  const sendMessage = async () => {
    if (!canSend || !activeThread) return;

    if (betaLoading) return;
    let accessSnapshot = betaAccess;
    if (accessSnapshot && !accessSnapshot.licensed) {
      setBetaGateError("Ative sua chave de licenca para usar o KILLA AI.");
      return;
    }

    const clerkToken = await getToken().catch(() => null);
    if (!clerkToken) {
      appendToActive([
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Voce precisa estar logado para usar o KILLA CHAT.",
          createdAt: Date.now(),
        },
      ]);
      return;
    }

    if (!accessSnapshot) {
      try {
        accessSnapshot = await refreshBetaAccess(clerkToken);
      } catch {
        appendToActive([
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: "Nao foi possivel validar sua licenca agora. Tente novamente em alguns segundos.",
            createdAt: Date.now(),
          },
        ]);
        return;
      }
    }

    if (accessSnapshot && !accessSnapshot.licensed) {
      setBetaGateError("Ative sua chave de licenca para continuar.");
      return;
    }

    const threadId = activeThread.id;
    const threadMessagesSnapshot = [...activeThread.messages];
    const pendingConfirm = pendingVideoConfirms[threadId];

    const attachedImageDataUrls = pendingImages.map((img) => img.dataUrl).filter(Boolean);
    const attachedImageDataUrl = attachedImageDataUrls[0] || null;

    const userAttachment: ChatAttachment[] = attachedImageDataUrls.map((url) => ({
      id: crypto.randomUUID(),
      kind: "image",
      url,
      createdAt: Date.now(),
    }));
    const videoAspectOptions = VIDEO_ASPECT_RATIOS.join(", ");
    const videoResolutionOptions = VIDEO_RESOLUTIONS.join(", ");

    // If we are waiting for a video confirmation, interpret the next message as the confirmation step.
    if (pendingConfirm) {
      const assistantId = crypto.randomUUID();

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: trimmed,
        createdAt: Date.now(),
        attachments: userAttachment.length ? userAttachment : undefined,
      };

      // "sim" shouldn't become the chat title; keep the original prompt as the first title.
      const nextTitle = isUntitledTitle(activeThread.title) ? deriveTitleFromText(pendingConfirm.prompt) : undefined;

      appendToThread(
        threadId,
        [
          userMessage,
          {
            id: assistantId,
            role: "assistant",
            text: "...",
            createdAt: Date.now(),
            attachments: [],
          },
        ],
        nextTitle
      );

      setInput("");

      if (isNo(trimmed)) {
        updateMessageInThread(threadId, assistantId, { text: "Ok. Video cancelado." });
        setPendingVideoConfirms((prev) => {
          const { [threadId]: _d, ...rest } = prev;
          return rest;
        });
        if (pendingImages.length) setPendingImages([]);
        return;
      }

      const requestedDuration = parseRequestedVideoDurationSeconds(trimmed);
      const requestedAspect = parseRequestedVideoAspectRatio(trimmed);
      const requestedResolution = parseRequestedVideoResolution(trimmed);

      const durationToUse = Math.min(Math.max(requestedDuration ?? pendingConfirm.duration, 1), 15);
      const aspectToUse = requestedAspect.value ?? pendingConfirm.aspect_ratio;
      const resolutionToUse = requestedResolution.value ?? pendingConfirm.resolution;
      const sourceImageToUse = attachedImageDataUrl || pendingConfirm.sourceImageDataUrl || pendingConfirm.imageDataUrl;
      let imageToUse = pendingConfirm.imageDataUrl;
      const mustReframe = Boolean(sourceImageToUse) && (Boolean(attachedImageDataUrl) || requestedAspect.value !== null || !imageToUse);
      if (mustReframe && sourceImageToUse) {
        try {
          imageToUse = await reframeImageForVideoAspect(sourceImageToUse, aspectToUse);
        } catch {
          imageToUse = sourceImageToUse;
        }
      }
      const didUpdate =
        Boolean(attachedImageDataUrl) ||
        requestedDuration !== null ||
        requestedAspect.value !== null ||
        requestedResolution.value !== null;

      if (didUpdate) {
        setPendingVideoConfirms((prev) => ({
          ...prev,
          [threadId]: {
            ...prev[threadId],
            duration: durationToUse,
            aspect_ratio: aspectToUse,
            resolution: resolutionToUse,
            sourceImageDataUrl: sourceImageToUse || prev[threadId].sourceImageDataUrl,
            imageDataUrl: imageToUse,
          },
        }));

        // We captured the updated image already; drop it from the composer to avoid holding large data URIs.
        if (pendingImages.length) setPendingImages([]);
      }

      if (!isYes(trimmed)) {
        const unsupportedNotes: string[] = [];
        if (requestedAspect.requested && !requestedAspect.value) {
          unsupportedNotes.push(`Proporcao \`${requestedAspect.requested}\` nao suportada. Usando \`${aspectToUse}\`.`);
        }
        if (requestedResolution.requested && !requestedResolution.value) {
          unsupportedNotes.push(`Resolucao \`${requestedResolution.requested}\` nao suportada. Usando \`${resolutionToUse}\`.`);
        }

        const durationLine =
          requestedDuration && requestedDuration > 15
            ? `Voce pediu ${requestedDuration}s, mas o maximo e 15s. Posso gerar com 15s.`
              : didUpdate
                ? `Vou gerar um video de ${durationToUse}s em ${aspectToUse} (${resolutionToUse}).`
                : "";

        updateMessageInThread(threadId, assistantId, {
          text:
            `${durationLine ? `${durationLine}\n\n` : ""}` +
            `${unsupportedNotes.length ? `${unsupportedNotes.join("\n")}\n\n` : ""}` +
            "Imagem de referencia: vou usar a imagem anexada neste chat.\n" +
            `Configuracao atual: \`${durationToUse}s\` | \`${aspectToUse}\` | \`${resolutionToUse}\`.\n\n` +
            `Proporcoes disponiveis: ${videoAspectOptions}.\n` +
            `Resolucoes disponiveis: ${videoResolutionOptions}.\n\n` +
            "Para confirmar o video, responda `sim`. Para abortar, responda `cancelar`.",
        });
        return;
      }

      let videoChargeId = "";
      try {
        const charge = await postBetaCharge(
          "video_generate",
          `video:${threadId}:${assistantId}:${Date.now()}`,
          clerkToken
        );
        videoChargeId = charge.charge_id;
      } catch (error) {
        const payload = readApiErrorPayload(error);
        const code = String(payload?.code || "");
        const msg =
          code === "INSUFFICIENT_CREDITS"
            ? "Creditos insuficientes para gerar video. Necessario: 10 creditos."
            : getErrorMessage(error);
        updateMessageInThread(threadId, assistantId, {
          text: `Aviso: ${msg}`,
        });
        return;
      }

      const controller = new AbortController();
      const signal = controller.signal;
      inflightRef.current = {
        threadId,
        assistantId,
        prompt: pendingConfirm.prompt,
        pendingImages: pendingImages.length
          ? pendingImages
          : [{ id: crypto.randomUUID(), name: "video-ref.jpg", dataUrl: imageToUse }],
        controller,
      };
      thinkingAssistantRef.current = assistantId;

      setThinking(true);
      setTypingAssistantId(assistantId);
      updateMessageInThread(threadId, assistantId, {
        text: buildToolLoadingLabel("create-video", { durationSeconds: durationToUse }),
      });
      const videoTrace = createMediaReasoningTrace(["create-video"], { durationSeconds: durationToUse });
      if (videoTrace) upsertReasoningTrace(assistantId, videoTrace);

      try {
        const gen = await apiJson<{ success: boolean; request_id: string }>(
          "/api/video/generate",
          {
            prompt: pendingConfirm.prompt,
            image_url: imageToUse,
            duration: durationToUse,
            aspect_ratio: aspectToUse,
            resolution: resolutionToUse,
            video_model_id: pendingConfirm.model_id || undefined,
          },
          clerkToken,
          signal
        );

        if (signal.aborted) return;
        if (!gen.request_id) throw new Error("Sem request_id retornado pelo backend.");
        markReasoningStep(assistantId, "analyze", "done", "Referencia validada");
        markReasoningStep(assistantId, "render", "active");

        const done = await pollVideo(
          gen.request_id,
          async () => await getToken().catch(() => null),
          signal
        );
        if (signal.aborted) return;

        const meta = await probeVideoMetadata(done.url);
        const reportedDuration = Number(done.duration);
        const actualDuration = Number.isFinite(reportedDuration) && reportedDuration > 0 ? reportedDuration : meta?.duration;
        if (typeof actualDuration === "number" && Number.isFinite(actualDuration)) {
          const durationDiff = Math.abs(actualDuration - durationToUse);
          if (durationDiff > 0.75) {
            throw new Error(
              `Duracao divergente: solicitado ${durationToUse}s, retornado ${actualDuration.toFixed(2)}s.`
            );
          }
        }
        if (meta) {
          const expectedRatio = videoAspectRatioToNumber(aspectToUse);
          const actualRatio = meta.width / meta.height;
          const relDiff = Math.abs(actualRatio - expectedRatio) / expectedRatio;
          if (relDiff > 0.08) {
            throw new Error(
              `Proporcao divergente: solicitado ${aspectToUse}, retornado ${meta.width}x${meta.height}.`
            );
          }
        }

        markReasoningStep(assistantId, "render", "done", "Frames concluidos");
        markReasoningStep(assistantId, "deliver", "active");

        addAttachmentsToMessageInThread(threadId, assistantId, [
          {
            id: crypto.randomUUID(),
            kind: "video",
            url: done.url,
            createdAt: Date.now(),
          },
        ]);
        markReasoningStep(assistantId, "deliver", "done", "Video pronto");

        setPendingVideoConfirms((prev) => {
          const { [threadId]: _d, ...rest } = prev;
          return rest;
        });
      } catch (e) {
        if (isAbortError(e) || signal.aborted) {
          if (videoChargeId) {
            await postBetaRefund(videoChargeId, "video_generation_cancelled", clerkToken);
          }
          return;
        }
        if (videoChargeId) {
          await postBetaRefund(videoChargeId, "video_generation_failed", clerkToken);
        }
        markReasoningStep(assistantId, "render", "done", "Falha na geracao");
        markReasoningStep(assistantId, "deliver", "done", "Erro no processamento");
        updateMessageInThread(threadId, assistantId, {
          text: `Aviso: Falha ao gerar video: ${e instanceof Error ? e.message : "erro desconhecido"}`,
        });
      } finally {
        if (thinkingAssistantRef.current === assistantId) {
          inflightRef.current = null;
          thinkingAssistantRef.current = null;
          setThinking(false);
          setTypingAssistantId((cur) => (cur === assistantId ? null : cur));
        }
        clearReasoningTrace(assistantId);
      }

      return;
    }

    const modelHint = extractImageModelHint(trimmed);
    const promptText = modelHint.prompt || trimmed;

    if (!promptText.trim()) return;

    const wantsCreateImages = activeTools.includes("create-images");
    const wantsEditImage = activeTools.includes("edit-image");
    const wantsCreateVideo = activeTools.includes("create-video");
    const selectedVideoModelId = videoModel === "modelslab-grok-imagine-video-i2v" ? "grok-imagine-video-i2v" : undefined;

    // Create Video always asks for confirmation before consuming credits/time.
    if (wantsCreateVideo) {
      const assistantId = crypto.randomUUID();
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: promptText,
        createdAt: Date.now(),
        attachments: userAttachment.length ? userAttachment : undefined,
      };

      const nextTitle = isUntitledTitle(activeThread.title) ? deriveTitleFromText(promptText) : undefined;

      if (!attachedImageDataUrl) {
        appendToThread(
          threadId,
          [
            userMessage,
            {
              id: assistantId,
              role: "assistant",
              text: "Aviso: Para usar Create Video, anexe uma imagem (clipe) e envie o prompt com o toggle ativo.",
              createdAt: Date.now(),
            },
          ],
          nextTitle
        );
        setInput("");
        return;
      }

      const requestedDuration = parseRequestedVideoDurationSeconds(promptText);
      const requestedAspect = parseRequestedVideoAspectRatio(promptText);
      const requestedResolution = parseRequestedVideoResolution(promptText);

      const desired = requestedDuration ?? 5;
      const duration = Math.min(Math.max(desired, 1), 15);
      const aspectRatio: VideoAspectRatio = requestedAspect.value ?? "16:9";
      const resolution: VideoResolution = requestedResolution.value ?? "720p";
      let preparedVideoRef = attachedImageDataUrl;
      try {
        preparedVideoRef = await reframeImageForVideoAspect(attachedImageDataUrl, aspectRatio);
      } catch {
        preparedVideoRef = attachedImageDataUrl;
      }

      const unsupportedNotes: string[] = [];
      if (requestedAspect.requested && !requestedAspect.value) {
        unsupportedNotes.push(
          `Proporcao \`${requestedAspect.requested}\` nao suportada. Usando \`${aspectRatio}\`.`
        );
      }
      if (requestedResolution.requested && !requestedResolution.value) {
        unsupportedNotes.push(
          `Resolucao \`${requestedResolution.requested}\` nao suportada. Usando \`${resolution}\`.`
        );
      }

      const durationLine =
        requestedDuration && requestedDuration > 15
          ? `Voce pediu ${requestedDuration}s, mas o maximo e 15s. Posso gerar com 15s.`
          : `Vou gerar um video de ${duration}s em ${aspectRatio} (${resolution}).`;

      appendToThread(
        threadId,
        [
          userMessage,
          {
            id: assistantId,
            role: "assistant",
            text:
              `${durationLine}\n\n` +
              `${unsupportedNotes.length ? `${unsupportedNotes.join("\n")}\n\n` : ""}` +
              "Imagem de referencia: vou usar a imagem anexada neste chat.\n" +
              `Proporcoes disponiveis: ${videoAspectOptions}.\n` +
              `Resolucoes disponiveis: ${videoResolutionOptions}.\n\n` +
              "Confirma? Responda `sim` para gerar ou `cancelar` para abortar.",
            createdAt: Date.now(),
          },
        ],
        nextTitle
      );

      setPendingVideoConfirms((prev) => ({
        ...prev,
        [threadId]: {
          prompt: promptText,
          sourceImageDataUrl: attachedImageDataUrl,
          imageDataUrl: preparedVideoRef,
          duration,
          aspect_ratio: aspectRatio,
          resolution,
          model_id: selectedVideoModelId,
        },
      }));

      setInput("");
      if (pendingImages.length) setPendingImages([]);
      return;
    }

    const usedImageModelId = modelHint.modelId || imageModel;
    const usedImageModelLabel = usedImageModelId === "seedream-4.5" ? "Seedream 4.5" : "Nano Banana Pro";

    const activeToolId =
      activeTools.includes("deepsearch") && activeTools.includes("think")
        ? "deepsearch+think"
        : activeTools[0] || null;
    const assistantPlaceholderText = buildToolLoadingLabel(activeToolId, {
      imageModelLabel: usedImageModelLabel,
    });

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: promptText,
      createdAt: Date.now(),
      attachments: userAttachment.length ? userAttachment : undefined,
    };

    const assistantId = crypto.randomUUID();

    const nextTitle = isUntitledTitle(activeThread.title) ? deriveTitleFromText(promptText) : undefined;

    appendToThread(
      threadId,
      [
        userMessage,
        {
          id: assistantId,
          role: "assistant",
          text: assistantPlaceholderText,
          createdAt: Date.now(),
          attachments: [],
        },
      ],
      nextTitle
    );

    setInput("");
    setThinking(true);
    setTypingAssistantId(assistantId);
    thinkingAssistantRef.current = assistantId;

    const controller = new AbortController();
    const signal = controller.signal;
    inflightRef.current = { threadId, assistantId, prompt: promptText, pendingImages, controller };
    const deepSearchEnabled = activeTools.includes("deepsearch");
    const thinkEnabled = activeTools.includes("think");
    const textReasoningTrace = createReasoningTrace(thinkEnabled, deepSearchEnabled);
    const mediaReasoningTrace = textReasoningTrace
      ? null
      : createMediaReasoningTrace(activeTools, { imageModelLabel: usedImageModelLabel });
    const initialReasoningTrace = textReasoningTrace || mediaReasoningTrace;
    if (initialReasoningTrace) upsertReasoningTrace(assistantId, initialReasoningTrace);

    const mediaJobs: Promise<void>[] = [];

    // If multiple media tools are enabled together, we chain them so video/edit can use freshly generated images.
    let createImagesPromise: Promise<string | null> | null = null;

    if (wantsCreateImages) {
      createImagesPromise = (async () => {
        let createImageChargeId = "";
        try {
          const charge = await postBetaCharge(
            "image_generate",
            `img_gen:${threadId}:${assistantId}:${Date.now()}`,
            clerkToken,
            signal
          );
          createImageChargeId = charge.charge_id;

          markReasoningStep(assistantId, "analyze", "done");
          markReasoningStep(assistantId, "render", "active");

          const data = await apiJson<{ success: boolean; urls: string[] }>(
            "/api/image/generate",
            {
              prompt: promptText,
              aspectRatio: "1:1",
              model_id: modelHint.modelId || imageModel,
            },
            clerkToken,
            signal
          );

          if (signal.aborted) return null;

          const firstUrl = Array.isArray(data.urls) ? data.urls.find((u) => typeof u === "string" && u.startsWith("http")) : null;
          const attachments: ChatAttachment[] = firstUrl
            ? [
                {
                id: crypto.randomUUID(),
                kind: "image",
                url: firstUrl,
                createdAt: Date.now(),
              },
              ]
            : [];

          if (attachments.length > 0) addAttachmentsToMessageInThread(threadId, assistantId, attachments);
          markReasoningStep(assistantId, "render", "done", attachments.length ? "Imagem gerada" : "Sem imagem retornada");
          if (wantsEditImage) {
            markReasoningStep(assistantId, "edit", "active");
          } else {
            markReasoningStep(assistantId, "deliver", "active");
            markReasoningStep(assistantId, "deliver", "done", attachments.length ? "Imagem pronta" : "Sem resultado");
          }

          return attachments[0]?.url || null;
        } catch (e) {
          if (isAbortError(e) || signal.aborted) {
            if (createImageChargeId) {
              await postBetaRefund(createImageChargeId, "image_generation_cancelled", clerkToken);
            }
            return null;
          }
          if (createImageChargeId) {
            await postBetaRefund(createImageChargeId, "image_generation_failed", clerkToken);
          }
          markReasoningStep(assistantId, "render", "done", "Falha na geracao");
          markReasoningStep(assistantId, "deliver", "done", "Erro no processamento");
          throw e;
        }
      })();

      mediaJobs.push(createImagesPromise.then(() => undefined));
    }

    if (wantsEditImage) {
      mediaJobs.push(
        (async () => {
          let editChargeId = "";
          try {
            if (!wantsCreateImages) {
              markReasoningStep(assistantId, "analyze", "active");
            }
            const generated = createImagesPromise ? await createImagesPromise : null;
            if (signal.aborted) return;

            const latestImage = getLatestImageUrl(threadMessagesSnapshot);
            const imageSources =
              attachedImageDataUrls.length > 0
                ? attachedImageDataUrls.slice(0, EDIT_IMAGE_MAX_ATTACHMENTS)
                : generated
                  ? [generated]
                  : latestImage
                    ? [latestImage]
                    : [];

            if (imageSources.length === 0) {
              markReasoningStep(assistantId, "analyze", "done", "Sem imagem de referencia");
              markReasoningStep(assistantId, "edit", "done", "Edicao nao iniciada");
              markReasoningStep(assistantId, "deliver", "done", "Aguardando imagem");
              appendTextToMessageInThread(
                threadId,
                assistantId,
                "Aviso: Para usar Edit Image, anexe uma imagem (clipe) ou gere uma imagem antes."
              );
              return;
            }
            markReasoningStep(assistantId, "analyze", "done", `${imageSources.length} referencia(s) carregada(s)`);
            markReasoningStep(assistantId, "edit", "active");

            const charge = await postBetaCharge(
              "image_edit",
              `img_edit:${threadId}:${assistantId}:${Date.now()}`,
              clerkToken,
              signal
            );
            editChargeId = charge.charge_id;

            const imagePayload = imageSources.length === 1 ? imageSources[0] : imageSources;

            const data = await apiJson<{ success: boolean; urls: string[] }>(
              "/api/image/edit",
              {
                prompt: promptText,
                image: imagePayload,
                aspectRatio: "1:1",
              },
              clerkToken,
              signal
            );

            if (signal.aborted) return;

            const firstUrl = Array.isArray(data.urls)
              ? data.urls.find((u) => typeof u === "string" && u.startsWith("http"))
              : null;
            const attachments: ChatAttachment[] = firstUrl
              ? [
                  {
                    id: crypto.randomUUID(),
                    kind: "image",
                    url: firstUrl,
                    createdAt: Date.now(),
                  },
                ]
              : [];

            if (attachments.length > 0) addAttachmentsToMessageInThread(threadId, assistantId, attachments);
            markReasoningStep(assistantId, "edit", "done", attachments.length ? "Edicao concluida" : "Sem imagem retornada");
            markReasoningStep(assistantId, "deliver", "active");
            markReasoningStep(assistantId, "deliver", "done", attachments.length ? "Imagem editada pronta" : "Sem resultado");
          } catch (e) {
            if (isAbortError(e) || signal.aborted) {
              if (editChargeId) {
                await postBetaRefund(editChargeId, "image_edit_cancelled", clerkToken);
              }
              return;
            }
            if (editChargeId) {
              await postBetaRefund(editChargeId, "image_edit_failed", clerkToken);
            }
            markReasoningStep(assistantId, "edit", "done", "Falha na edicao");
            markReasoningStep(assistantId, "deliver", "done", "Erro no processamento");
            throw e;
          }
        })()
      );
    }

    // Clear pending image(s) after enqueueing jobs (we captured data URL already).
    if (pendingImages.length) setPendingImages([]);

    const modelForText = models.some((m) => m.id === model) ? model : pickDefaultModelId(models);
    if (modelForText !== model) setModel(modelForText);

    const runTextJob = async () => {
      if (signal.aborted) return;

      if (!window.puter) {
        updateMessageInThread(threadId, assistantId, {
          text: "Puter.js nao esta disponivel no navegador. As funcoes de texto precisam do Puter.",
        });
        return;
      }

      const signed = await ensureSignedIn();
      if (signal.aborted) return;
      if (!signed) {
        updateMessageInThread(threadId, assistantId, {
          text: "Conecte sua conta Puter para gerar respostas de texto. (As funcoes de imagem/video podem continuar se o backend estiver configurado.)",
        });
        return;
      }

      const textAction = resolveTextCreditAction(thinkEnabled, deepSearchEnabled);
      let textChargeId = "";
      const refundTextCharge = async (reason: string) => {
        if (!textChargeId) return;
        const current = textChargeId;
        textChargeId = "";
        await postBetaRefund(current, reason, clerkToken);
      };
      try {
        const charge = await postBetaCharge(
          textAction,
          `text:${threadId}:${assistantId}:${Date.now()}`,
          clerkToken,
          signal
        );
        textChargeId = charge.charge_id;
      } catch (error) {
        const payload = readApiErrorPayload(error);
        const code = String(payload?.code || "");
        const msg =
          code === "INSUFFICIENT_CREDITS"
            ? "Creditos insuficientes para enviar esta mensagem."
            : getErrorMessage(error);
        updateMessageInThread(threadId, assistantId, { text: `Aviso: ${msg}` });
        return;
      }

      const openAIModel = isLikelyOpenAIModel(modelForText);

      const preludeNotes: string[] = [];

      type WebSearchResult = { title: string; url: string; snippet?: string };
      type WebSearchTrace = {
        queries?: string[];
        perQuery?: Array<{ query: string; count: number; error?: string }>;
        total_sources?: number;
      };
      type WebSearchResponse = { success: boolean; results?: WebSearchResult[]; trace?: WebSearchTrace; error?: string };
      type KnowledgeSearchResult = {
        id?: string;
        title?: string;
        url?: string;
        snippet?: string;
        type?: string;
      };
      type KnowledgeSearchTrace = {
        engine?: string;
        queries?: string[];
        keywords?: string[];
        total_items?: number;
        matched_items?: number;
      };
      type KnowledgeSearchResponse = {
        success: boolean;
        results?: KnowledgeSearchResult[];
        trace?: KnowledgeSearchTrace;
        error?: string;
      };
      type DeepSource = {
        origin: "knowledge" | "web";
        title: string;
        url?: string;
        snippet?: string;
        typeLabel?: string;
      };

      let deepSearchAvailable = !deepSearchEnabled;
      let searchContext = "";

      if (deepSearchEnabled) {
        markReasoningStep(assistantId, "analyze", "done");
        updateMessageInThread(threadId, assistantId, {
          text: thinkEnabled ? buildToolLoadingLabel("deepsearch+think") : buildToolLoadingLabel("deepsearch"),
        });
        try {
          const { searchQueries, optimizedQueries, keywords } = buildDeepSearchQueries(promptText, thinkEnabled);

          if (thinkEnabled && keywords.length > 0) {
            setReasoningOptimizerKeywords(assistantId, keywords);
          }

          if (thinkEnabled && optimizedQueries.length > 0) {
            markReasoningStep(assistantId, "optimize", "active");
            setReasoningOptimizedQueries(assistantId, optimizedQueries);
            markReasoningStep(assistantId, "optimize", "done", `${optimizedQueries.length} estrategias keyword-first`);
          }

          markReasoningStep(assistantId, "search", "active");
          setReasoningQueries(assistantId, searchQueries);

          const mergedSources: DeepSource[] = [];
          const seenSourceKeys = new Set<string>();
          const addSource = (candidate: DeepSource) => {
            const normalizedTitle = String(candidate.title || "").trim();
            if (!normalizedTitle) return;
            const normalizedUrl = String(candidate.url || "").trim();
            const key = normalizedUrl
              ? normalizedUrl.toLowerCase()
              : `${candidate.origin}:${normalizedTitle.toLowerCase()}:${String(candidate.typeLabel || "").toLowerCase()}`;
            if (seenSourceKeys.has(key)) return;
            seenSourceKeys.add(key);
            mergedSources.push({
              ...candidate,
              title: normalizedTitle,
              url: normalizedUrl || undefined,
              snippet: String(candidate.snippet || "").trim() || undefined,
            });
          };

          let knowledgeCount = 0;
          let webCount = 0;
          let knowledgeFailed = false;
          let webFailed = false;
          let knowledgeEngine = "";

          try {
            const knowledgeData = await apiJson<KnowledgeSearchResponse>(
              "/api/knowledge/search",
              {
                query: searchQueries[0] || promptText,
                queries: searchQueries,
                keywords,
                max_results: 6,
              },
              clerkToken,
              signal
            );

            if (Array.isArray(knowledgeData.trace?.queries) && knowledgeData.trace.queries.length > 0) {
              setReasoningQueries(assistantId, knowledgeData.trace.queries);
            }
            knowledgeEngine = typeof knowledgeData.trace?.engine === "string" ? knowledgeData.trace.engine : "";

            const knowledgeResults = Array.isArray(knowledgeData.results) ? knowledgeData.results : [];
            const before = mergedSources.length;
            for (const item of knowledgeResults) {
              if (!item || typeof item.title !== "string") continue;
              addSource({
                origin: "knowledge",
                title: item.title,
                url: typeof item.url === "string" ? item.url : undefined,
                snippet: typeof item.snippet === "string" ? item.snippet : undefined,
                typeLabel: typeof item.type === "string" ? item.type : undefined,
              });
            }
            knowledgeCount = mergedSources.length - before;
          } catch (error) {
            if (isAbortError(error) || signal.aborted) return;
            knowledgeFailed = true;
          }

          const shouldUseWebFallback = mergedSources.length < 4;
          if (shouldUseWebFallback) {
            try {
              const data = await apiJson<WebSearchResponse>(
                "/api/web/search",
                {
                  query: searchQueries[0] || promptText,
                  queries: searchQueries,
                  max_results: 4,
                },
                clerkToken,
                signal
              );

              if (Array.isArray(data.trace?.queries) && data.trace?.queries.length > 0) {
                setReasoningQueries(assistantId, data.trace.queries);
              }

              const results = Array.isArray(data.results) ? data.results : [];
              const before = mergedSources.length;
              for (const result of results) {
                if (!result || typeof result.title !== "string") continue;
                if (typeof result.url !== "string" || !result.url.startsWith("http")) continue;
                addSource({
                  origin: "web",
                  title: result.title,
                  url: result.url,
                  snippet: typeof result.snippet === "string" ? result.snippet : undefined,
                });
              }
              webCount = mergedSources.length - before;
            } catch (error) {
              if (isAbortError(error) || signal.aborted) return;
              webFailed = true;
            }
          }

          const usable = mergedSources.slice(0, 8);

          if (usable.length > 0) {
            deepSearchAvailable = true;
            const sourceMix: string[] = [];
            if (knowledgeCount > 0) sourceMix.push(`${knowledgeCount} fonte(s) internas`);
            if (webCount > 0) sourceMix.push(`${webCount} fonte(s) web`);
            markReasoningStep(assistantId, "search", "done", sourceMix.join(" + ") || `${usable.length} fontes`);
            markReasoningStep(assistantId, "review", "active");
            setReasoningSources(
              assistantId,
              usable.map((item) => ({
                title:
                  item.origin === "knowledge"
                    ? `[Dataset${item.typeLabel ? `/${item.typeLabel}` : ""}] ${item.title}`
                    : item.title,
                url: item.url,
              }))
            );
            if (knowledgeCount > 0) {
              updateMessageInThread(threadId, assistantId, {
                meta: {
                  knowledge: {
                    used: true,
                    sourceCount: knowledgeCount,
                    engine: knowledgeEngine || undefined,
                  },
                },
              });
            }

            searchContext = usable
              .map((r, i) => {
                const snip = r.snippet ? String(r.snippet).trim() : "";
                const short = snip.length > 260 ? `${snip.slice(0, 260)}...` : snip;
                const sourceLabel =
                  r.origin === "knowledge" ? `Dataset interno${r.typeLabel ? `/${r.typeLabel}` : ""}` : "Web";
                return `[#${i + 1}] [${sourceLabel}] ${r.title}${r.url ? `\nURL: ${r.url}` : ""}${short ? `\nResumo: ${short}` : ""}`;
              })
              .join("\n\n");

            markReasoningStep(assistantId, "review", "done", `${usable.length} fontes relevantes`);
          } else {
            deepSearchAvailable = false;
            const failureNote =
              knowledgeFailed || webFailed
                ? "Busca interna/web indisponivel"
                : "Nenhuma fonte encontrada";
            markReasoningStep(assistantId, "search", "done", failureNote);
            markReasoningStep(assistantId, "review", "done", "Sem fontes para revisar");
            preludeNotes.push("Aviso: DeepSearch nao retornou fontes validas nesta tentativa. Respondendo sem fontes.");
          }
        } catch (e) {
          if (isAbortError(e) || signal.aborted) return;
          deepSearchAvailable = false;
          if (thinkEnabled) {
            markReasoningStep(assistantId, "optimize", "done", "Fallback de pesquisa");
          }
          markReasoningStep(assistantId, "search", "done", "Falha na busca");
          markReasoningStep(assistantId, "review", "done", "Busca indisponivel");
          preludeNotes.push("Aviso: DeepSearch (dataset/web) falhou nesta tentativa. Respondendo sem fontes.");
        }
      } else {
        markReasoningStep(assistantId, "analyze", "done");
      }

      const prelude = preludeNotes.length > 0 ? `${preludeNotes.join("\n\n")}\n\n---\n\n` : "";
      const instruction = buildToolInstruction(activeTools, { deepSearchAvailable });

      const puter = window.puter;

      type PuterChatMessage = { role: "system" | "user" | "assistant"; content: string };
      const sys = (content: string): PuterChatMessage => ({ role: "system", content });

      // Build a safe conversation for text models:
      // - Drop messages with attachments (often tool/media prompts that can trigger moderation)
      // - Drop the user prompt that immediately preceded an attachment message (likely a media prompt)
      // - Drop placeholders like "Pronto." to reduce noise
      const rawForText = [...threadMessagesSnapshot, userMessage].filter((m) => m.role === "assistant" || m.role === "user");
      const drop = new Set<string>();
      for (let i = 0; i < rawForText.length; i++) {
        const m = rawForText[i];
        const hasAtt = (m.attachments || []).length > 0;
        if (!hasAtt) continue;
        drop.add(m.id);
        // Also drop the immediately previous user prompt (usually the prompt that triggered the media).
        const prev = rawForText[i - 1];
        if (prev && prev.role === "user") drop.add(prev.id);
      }

      const conversation: PuterChatMessage[] = rawForText
        .filter((m) => !drop.has(m.id))
        .filter((m) => (m.attachments || []).length === 0)
        .map((m) => ({ role: m.role, content: String(m.text || "") } as PuterChatMessage))
        .filter((m) => m.content.trim().length > 0)
        .filter((m) => {
          const t = m.content.trim().toLowerCase();
          if (t === "pronto." || t === "..." || t === "…") return false;
          if (t.startsWith("buscando na web")) return false;
          return true;
        });

      const payload: PuterChatMessage[] = [
        sys(SYSTEM_PROMPT.trim()),
        ...(instruction.trim() ? [sys(instruction.trim())] : []),
        ...(deepSearchEnabled && deepSearchAvailable && searchContext
          ? [sys(`Resultados de busca (DeepSearch):\n\n${searchContext}`)]
          : []),
        ...conversation,
      ];

      const runChatWithPayload = async (
        messages: PuterChatMessage[],
        options: Record<string, unknown>,
        streamToUi: boolean
      ) => {
        if (signal.aborted) return "";

        const runPuterChatSafe = async (chatMessages: PuterChatMessage[], chatOptions: Record<string, unknown>) => {
          try {
            return await puter.ai.chat(chatMessages, { ...chatOptions, signal });
          } catch (error) {
            const msg = getErrorMessage(error).toLowerCase();
            const hasReasoningEffort = Object.prototype.hasOwnProperty.call(chatOptions, "reasoning_effort");
            const unsupportedReasoning =
              msg.includes("reasoning_effort") ||
              msg.includes("unknown parameter") ||
              msg.includes("unsupported parameter") ||
              msg.includes("unexpected property") ||
              msg.includes("invalid_request");

            if (hasReasoningEffort && unsupportedReasoning) {
              const { reasoning_effort: _drop, ...fallbackOptions } = chatOptions;
              return await puter.ai.chat(chatMessages, { ...fallbackOptions, signal });
            }

            throw error;
          }
        };

        // Note: Puter SDK may ignore `signal`, but we still use it to stop consuming streams + UI updates.
        const response = await runPuterChatSafe(messages, options);
        let fullText = "";
        let clearedTyping = false;

        if (response && typeof (response as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
          for await (const part of response as AsyncIterable<unknown>) {
            if (signal.aborted) break;
            const chunk = extractStreamText(part);
            if (!chunk) continue;

            // As soon as we start receiving the real answer, stop showing the "thinking" bubble UI.
            if (streamToUi && !clearedTyping) {
              clearedTyping = true;
              setTypingAssistantId((cur) => (cur === assistantId ? null : cur));
            }

            fullText += chunk;
            if (streamToUi && !signal.aborted) updateMessageInThread(threadId, assistantId, { text: `${prelude}${fullText}` });
          }
        } else {
          if (signal.aborted) return "";
          fullText = parseNonStreamResponse(response);
          if (streamToUi && fullText.trim() && !signal.aborted) {
            setTypingAssistantId((cur) => (cur === assistantId ? null : cur));
            updateMessageInThread(threadId, assistantId, { text: `${prelude}${fullText}` });
          }
        }

        if (signal.aborted) return fullText;

        // Some providers return a non-stream JSON payload even when stream:true,
        // or a stream that doesn't yield text chunks. Try a safe fallback.
        if (!fullText.trim() && options.stream === true) {
          try {
            const fallbackResponse = await runPuterChatSafe(messages, { ...options, stream: false });
            const fallbackText = parseNonStreamResponse(fallbackResponse);
            if (fallbackText.trim()) {
              fullText = fallbackText;
              if (streamToUi) {
                setTypingAssistantId((cur) => (cur === assistantId ? null : cur));
                updateMessageInThread(threadId, assistantId, { text: `${prelude}${fullText}` });
              }
            }
          } catch {
            // ignore; we'll surface the empty result below if it stays empty
          }
        }

        return fullText;
      };

      try {
        const baseChatOptions: Record<string, unknown> = { model: modelForText };
        const finalChatOptions: Record<string, unknown> = { ...baseChatOptions, stream: true };

        // If the model supports OpenAI-style reasoning effort, keep it as an extra boost in the final pass.
        if (thinkEnabled && openAIModel) finalChatOptions.reasoning_effort = "high";

        // Think = 2-pass (plan hidden) using the SAME Puter model selected by the user.
        if (thinkEnabled) {
          markReasoningStep(assistantId, "plan", "active");

          const planInstruction = [
            "MODO THINK (PLANO OCULTO).",
            "Gere um plano curto (max 8 itens) para responder a ultima pergunta do usuario.",
            "O plano deve ser objetivo (topicos) e pode incluir checagens, calculos, estrutura e premissas.",
            "IMPORTANTE: Retorne APENAS o plano. Nao responda ao usuario ainda. Nao inclua introducao.",
          ].join("\n");

          const planPayload: PuterChatMessage[] = [
            sys(SYSTEM_PROMPT.trim()),
            ...(instruction.trim() ? [sys(instruction.trim())] : []),
            ...(deepSearchEnabled && deepSearchAvailable && searchContext
              ? [sys(`Resultados de busca (DeepSearch):\n\n${searchContext}`)]
              : []),
            sys(planInstruction),
            ...conversation,
          ];

          let planText = "";
          try {
            // Keep plan pass cheap: no streaming and no special provider features.
            planText = (await runChatWithPayload(planPayload, { ...baseChatOptions, stream: false }, false)).trim();
          } catch {
            planText = "";
          }

          markReasoningStep(assistantId, "plan", "done", planText ? "Plano interno estruturado" : "Plano resumido");
          markReasoningStep(assistantId, "answer", "active");

          // Defensive: if a model ignores the instruction and outputs a full answer, clamp it.
          if (planText.length > 1600) planText = `${planText.slice(0, 1600)}...`;

          const finalThinkSystem = planText
            ? [
                "MODO THINK (2-PASS).",
                "Use o plano interno abaixo para produzir a melhor resposta final.",
                "Nao mostre nem mencione o plano para o usuario.",
                "Se o plano estiver ruim, corrija mentalmente e responda do mesmo jeito.",
                "",
                "PLANO INTERNO:",
                planText,
              ].join("\n")
            : [
                "MODO THINK ativo.",
                "Faca raciocinio aprofundado antes de responder, mas NAO revele cadeia de pensamento.",
                "Entregue apenas a resposta final, com premissas e limites quando fizer sentido.",
              ].join("\n");

          const finalPayload: PuterChatMessage[] = [
            sys(SYSTEM_PROMPT.trim()),
            ...(instruction.trim() ? [sys(instruction.trim())] : []),
            ...(deepSearchEnabled && deepSearchAvailable && searchContext
              ? [sys(`Resultados de busca (DeepSearch):\n\n${searchContext}`)]
              : []),
            sys(finalThinkSystem),
            ...conversation,
          ];

          const fullText = await runChatWithPayload(finalPayload, finalChatOptions, true);
          if (signal.aborted) return;
          const finalText =
            fullText.trim() ||
            "O modelo nao retornou texto nesta tentativa. Tente novamente ou troque o modelo em Settings.";
          updateMessageInThread(threadId, assistantId, { text: `${prelude}${finalText}` });
          markReasoningStep(assistantId, "answer", "done");
          textChargeId = "";
          return;
        }

        // Normal (single pass)
        markReasoningStep(assistantId, "answer", "active");
        const fullText = await runChatWithPayload(payload, finalChatOptions, true);
        if (signal.aborted) return;
        const finalText =
          fullText.trim() ||
          "O modelo nao retornou texto nesta tentativa. Tente novamente ou troque o modelo em Settings.";
        updateMessageInThread(threadId, assistantId, { text: `${prelude}${finalText}` });
        markReasoningStep(assistantId, "answer", "done");
        textChargeId = "";
      } catch (error) {
        if (isAbortError(error) || signal.aborted) {
          await refundTextCharge("text_cancelled");
          return;
        }

        // If moderation trips due to historical context, retry with minimal context (only the new question).
        if (isModerationError(error)) {
          try {
            const minimalPayload = [
              { role: "system", content: SYSTEM_PROMPT.trim() },
              ...(instruction.trim() ? [{ role: "system", content: instruction.trim() }] : []),
              ...(deepSearchEnabled && deepSearchAvailable && searchContext
                ? [{ role: "system", content: `Resultados de busca (DeepSearch):\n\n${searchContext}` }]
                : []),
              { role: "user", content: promptText },
            ];

            const response = await puter.ai.chat(minimalPayload, { model: modelForText, stream: false, signal });
            const text = parseNonStreamResponse(response).trim();
            if (text) {
              updateMessageInThread(threadId, assistantId, { text: `${prelude}${text}` });
              textChargeId = "";
              return;
            }
          } catch (fallbackError) {
            if (isAbortError(fallbackError) || signal.aborted) return;
            // fallthrough to user-facing moderation message
          }

          await refundTextCharge("text_moderation_failed");

          updateMessageInThread(threadId, assistantId, {
            text:
              "Falha de moderacao ao gerar a resposta de texto.\n\n" +
              "Isso normalmente acontece por causa do contexto do chat (historico) e nao por falta de creditos.\n\n" +
              "Tente:\n" +
              "- criar um novo chat\n" +
              "- ou apagar as mensagens antigas do chat que possam estar causando isso\n",
          });
          return;
        }

        if (isLowBalanceError(error)) {
          await refundTextCharge("text_provider_low_balance");
          const economyModel = findEconomyModel(models);
          const canSwitchModel = economyModel && economyModel.id !== model;

          if (canSwitchModel && economyModel) {
            setModel(economyModel.id);
            setActiveTools((prev) => {
              const next = prev.filter((item) => item !== "deepsearch" && item !== "think");
              if (activeThread) {
                updateThread(activeThread.id, (t) => ({
                  ...t,
                  activeTools: next,
                  activeTool: next[0] || null,
                  updatedAt: Date.now(),
                }));
              }
              return next;
            });
          }

          const suggestion =
            canSwitchModel && economyModel
              ? `\n\nModo economia ativado: modelo alterado para \`${economyModel.name}\` e DeepSearch/Think foram desligados. Tente enviar novamente.`
              : "\n\nDica: troque para um modelo free/mini/nano e desligue DeepSearch/Think para reduzir custo por mensagem.";

          updateMessageInThread(threadId, assistantId, {
            text:
              "Aviso: Saldo insuficiente na conta Puter para concluir a chamada de texto.\n\n" +
              "Isso nao mata seu projeto. Seu produto ainda funciona; so faltou credito nesta conta de teste." +
              suggestion,
          });
          return;
        }

        await refundTextCharge("text_provider_failed");
        updateMessageInThread(threadId, assistantId, {
          text: `Erro ao chamar modelo Puter: ${getErrorMessage(error)}`,
        });
      }

      if (signal.aborted && textChargeId) {
        await refundTextCharge("text_cancelled");
      }
    };

    const shouldRunText = !(wantsCreateImages || wantsEditImage);
    const jobs: Promise<void>[] = [...(shouldRunText ? [runTextJob()] : []), ...mediaJobs];

    const results = await Promise.allSettled(jobs);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;

    if (failed) {
      if (!isAbortError(failed.reason) && !signal.aborted) {
        const msg = failed.reason instanceof Error ? failed.reason.message : String(failed.reason);
        appendTextToMessageInThread(threadId, assistantId, `Aviso: Falha em uma tarefa: ${msg}`);
      }
    }

    if (thinkingAssistantRef.current === assistantId) {
      inflightRef.current = null;
      thinkingAssistantRef.current = null;
      setThinking(false);
      setTypingAssistantId((cur) => (cur === assistantId ? null : cur));
    }
    clearReasoningTrace(assistantId);
  };

  const handleRedeemBetaKey = async (licenseKey: string) => {
    setBetaGateError("");
    setBetaRedeeming(true);
    try {
      const token = await getToken().catch(() => null);
      if (!token) {
        setBetaGateError("Sua sessao expirou. Faca login novamente.");
        return;
      }

      const response = await apiJson<{ success: boolean; access: BetaAccessState; checkout?: BetaCheckoutState }>(
        "/api/beta/redeem",
        { license_key: licenseKey },
        token
      );
      if (response.access) setBetaAccess(response.access);
      if (response.checkout) setBetaCheckout(response.checkout);
      setBetaGateError("");
    } catch (error) {
      const payload = readApiErrorPayload(error);
      const code = String(payload?.code || "");
      if (code === "INVALID_KEY") {
        setBetaGateError("Chave invalida. Confira e tente novamente.");
      } else if (code === "KEY_ALREADY_USED") {
        setBetaGateError("Essa chave ja foi utilizada.");
      } else if (code === "ALREADY_LICENSED") {
        setBetaGateError("Sua conta ja possui licenca ativa.");
        try {
          await refreshBetaAccess();
        } catch {
          // ignore
        }
      } else {
        setBetaGateError(getErrorMessage(error));
      }
    } finally {
      setBetaRedeeming(false);
    }
  };

  return (
    <>
      <SignedOut>
        <AuthLanding />
      </SignedOut>

      <SignedIn>
        <div className="app-shell">
          <TopBar
            model={model}
            models={models}
            modelsLoading={modelsLoading}
            onModelChange={setModel}
            modelToggleCompatById={modelToggleCompatById}
            modelCompatCheckingById={modelCompatCheckingById}
            activeTools={activeTools}
            imageModel={imageModel}
            onImageModelChange={setImageModel}
            videoModel={videoModel}
            onVideoModelChange={setVideoModel}
            connected={connected}
            onNewChat={() => createNewChat("chat")}
            onNewMediaChat={() => createNewChat("media")}
            onConnectClick={() => {
              void handleConnectClick();
            }}
            onDisconnectClick={handleDisconnectClick}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
          />

          <div className={`content-shell ${sidebarOpen ? "" : "sidebar-collapsed"}`.trim()}>
            <Sidebar
              open={sidebarOpen}
              threads={threads}
              activeId={activeThread?.id || ""}
              onClose={() => setSidebarOpen(false)}
              onSelect={selectChat}
              onNewChat={() => createNewChat("chat")}
              onNewMediaChat={() => createNewChat("media")}
              onRename={renameChat}
              onToggleArchive={toggleArchiveChat}
              onDelete={deleteChat}
              onOpenProfile={() => {
                setSidebarOpen(false);
                setProfileOpen(true);
              }}
              onOpenSettings={() => {
                setSidebarOpen(false);
                setSettingsOpen(true);
              }}
              onOpenKnowledgeStudio={() => {
                setSidebarOpen(false);
                setKnowledgeOpen(true);
              }}
              onLogout={() => {
                setSidebarOpen(false);
                void clerk.signOut();
              }}
            />

            <main className="chat-shell">
              <section className="messages-scroller" ref={scrollerRef}>
                <div className="messages-inner">
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      typing={message.role === "assistant" && message.id === typingAssistantId}
                      reasoningTrace={message.role === "assistant" ? reasoningByAssistantId[message.id] : undefined}
                      onOpenImage={(url) => {
                        setLightboxUrl(url);
                      }}
                    />
                  ))}
                </div>
              </section>
            </main>
          </div>

          <Composer
            value={input}
            onChange={setInput}
            onSubmit={() => {
              void sendMessage();
            }}
            onCancel={cancelGeneration}
            disabled={thinking}
            activeTools={activeTools}
            onToolToggle={toggleTool}
            onPickImage={(file) => {
              void (async () => {
                try {
                  const dataUrl = await fileToDataUrl(file);
                  const ext = String(file.type || "image/png").split("/")[1] || "png";
                  const safeName = file.name && file.name.trim() ? file.name : `pasted-image.${ext}`;
                  const nextItem: PendingImageAttachment = {
                    id: crypto.randomUUID(),
                    name: safeName,
                    dataUrl,
                  };

                  setPendingImages((prev) => {
                    const max = activeTools.includes("edit-image") ? EDIT_IMAGE_MAX_ATTACHMENTS : 1;
                    if (max <= 1) return [nextItem];

                    const base = prev.slice(0, EDIT_IMAGE_MAX_ATTACHMENTS);
                    if (base.length >= EDIT_IMAGE_MAX_ATTACHMENTS) {
                      return [...base.slice(1), nextItem];
                    }
                    return [...base, nextItem];
                  });
                } catch (e) {
                  appendToActive([
                    {
                      id: crypto.randomUUID(),
                      role: "assistant",
                      text: e instanceof Error ? e.message : "Falha ao anexar imagem.",
                      createdAt: Date.now(),
                    },
                  ]);
                }
              })();
            }}
            attachedImages={pendingImages.map((img) => ({ id: img.id, name: img.name, previewUrl: img.dataUrl }))}
            onRemoveAttachment={(id) => {
              setPendingImages((prev) => prev.filter((img) => img.id !== id));
            }}
            creditsRemaining={betaAccess?.credits ?? null}
            creditPlanLabel={betaAccess?.plan_name || "Acesso Antecipado"}
            videoBadgeLabel={betaAccess?.early_access?.video_warning_badge || "Beta"}
          />

          <Lightbox
            url={lightboxUrl}
            onClose={() => {
              setLightboxUrl(null);
            }}
          />

          <AppSettingsModal
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            puterConnected={connected}
            onPuterConnect={() => {
              void handleConnectClick();
            }}
            onPuterDisconnect={handleDisconnectClick}
          />

          <KnowledgeStudioModal open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} />

          <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />

          <BetaAccessGate
            open={!betaLoading && !betaAccess?.licensed}
            loading={betaLoading}
            redeeming={betaRedeeming}
            error={betaGateError}
            access={betaAccess}
            checkout={betaCheckout}
            onRedeem={handleRedeemBetaKey}
          />
        </div>
      </SignedIn>
    </>
  );
}


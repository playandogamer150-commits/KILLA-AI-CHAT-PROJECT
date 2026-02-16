import { useEffect, useMemo, useRef, useState } from "react";
import { SignedIn, SignedOut, useAuth, useClerk } from "@clerk/clerk-react";
import AuthLanding from "./components/AuthLanding";
import AppSettingsModal from "./components/AppSettingsModal";
import Composer from "./components/Composer";
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

function createReasoningTrace(thinkEnabled: boolean, deepSearchEnabled: boolean): ReasoningTrace | null {
  if (!thinkEnabled && !deepSearchEnabled) return null;

  const mode: ReasoningTrace["mode"] = deepSearchEnabled && thinkEnabled ? "hybrid" : deepSearchEnabled ? "deepsearch" : "think";
  const optimizerEnabled = deepSearchEnabled && thinkEnabled;
  const title =
    mode === "hybrid"
      ? "KILLA esta usando THINK + DEEP SEARCH para pensar e buscar fontes..."
      : mode === "deepsearch"
        ? "KILLA esta usando DEEP SEARCH para pesquisar na internet..."
        : "KILLA esta usando THINK para pensar profundamente...";

  const steps: ReasoningTrace["steps"] = [
    { id: "analyze", label: "Entendendo o contexto do pedido", status: "active" },
    ...(optimizerEnabled ? [{ id: "optimize", label: "Optimizer Enhanced Research", status: "pending" as const }] : []),
    ...(deepSearchEnabled ? [{ id: "search", label: "Pesquisando fontes na web", status: "pending" as const }] : []),
    ...(deepSearchEnabled ? [{ id: "review", label: "Revisando fontes relevantes", status: "pending" as const }] : []),
    ...(thinkEnabled ? [{ id: "plan", label: "Estruturando o raciocinio", status: "pending" as const }] : []),
    { id: "answer", label: "Montando resposta final", status: "pending" },
  ];

  return {
    mode,
    title,
    steps,
    optimizer: optimizerEnabled ? { label: "Optimizer Enhanced Research ativo" } : undefined,
    optimizedQueries: [],
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
} {
  const base = String(prompt || "").trim().replace(/\s+/g, " ");
  if (!base) return { searchQueries: [], optimizedQueries: [] };

  const year = new Date().getFullYear();
  const baselineQueries = [
    base,
    `${base} atualizado ${year}`,
    `${base} fontes confiaveis`,
    `${base} dados oficiais`,
  ];

  if (!thinkEnabled) {
    return {
      searchQueries: dedupeQueries(baselineQueries, 4),
      optimizedQueries: [],
    };
  }

  // Think + DeepSearch: create an optimized research strategy to improve result quality.
  const optimizedQueries = dedupeQueries(
    [
      `"${base}" fonte oficial`,
      `${base} comparativo tecnico ${year}`,
      `${base} benchmark resultados ${year}`,
      `${base} melhores praticas implementacao`,
      `${base} riscos e limitacoes`,
    ],
    5
  );

  const searchQueries = dedupeQueries([...optimizedQueries, ...baselineQueries], 5);
  return { searchQueries, optimizedQueries };
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
    return "KILLA esta usando THINK + DEEP SEARCH para pensar e pesquisar fontes...";
  }
  if (tool === "think") return "KILLA esta usando THINK para pensar profundamente...";
  if (tool === "deepsearch") return "KILLA esta usando DEEP SEARCH para pesquisar na internet...";
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
- Seja direto e util. Entregue uma recomendacao principal quando houver escolha.
- Use codigo e comandos sempre em blocos fenced com a linguagem.
- Quando comparar 2+ opcoes, use tabela Markdown.
- Nao invente fontes. Se usar informacao externa, deixe claro o que e suposicao.`;

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
        "DeepSearch solicitado, mas a busca web falhou/esta indisponivel nesta tentativa. Nao invente fontes/links; responda apenas com conhecimento geral e deixe limites claros."
      );
    } else {
      instructions.push(
        "Modo DeepSearch ativo: use os resultados de busca fornecidos (Resultados de busca (DeepSearch)) para validar fatos. Inclua uma secao final 'Fontes' com os links utilizados. Nao invente links."
      );
    }
  }

  if (activeTools.includes("think")) {
    instructions.push("Modo Think ativo: faca raciocinio aprofundado antes de responder e destaque premissas e limites.");
  }

  if (activeTools.includes("create-images")) {
    instructions.push(
      "Create Images ativo: nao diga que voce nao consegue gerar imagens. Confirme em 1-2 linhas o que sera gerado e mantenha o texto curto."
    );
  }

  if (activeTools.includes("edit-image")) {
    instructions.push(
      "Edit Image ativo: nao diga que voce nao consegue editar imagens. Confirme em 1-2 linhas a edicao solicitada e mantenha o texto curto."
    );
  }

  if (activeTools.includes("create-video")) {
    instructions.push(
      "Create Video ativo: nao diga que voce nao consegue gerar videos. Confirme em 1-2 linhas o video solicitado e mantenha o texto curto."
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
  const t = text.trim().toLowerCase();
  return /^(sim|s|confirmar|confirmo|ok|bora)\b/.test(t);
}

function isNo(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(nao|não|cancelar|cancela|pare|stop)\b/.test(t);
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
  token?: string | null,
  signal?: AbortSignal
): Promise<{ url: string; duration?: number }> {
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(3000, signal);
    if (signal?.aborted) {
      const e = new Error("Aborted");
      (e as any).name = "AbortError";
      throw e;
    }
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`/api/video/status/${encodeURIComponent(requestId)}`, {
      method: "GET",
      headers: Object.keys(headers).length ? headers : undefined,
      signal,
    });
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
  const { getToken } = useAuth();
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

  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>([]);
  type PendingVideoConfirm = {
    prompt: string;
    imageDataUrl: string;
    duration: number;
    aspect_ratio: VideoAspectRatio;
    resolution: VideoResolution;
    provider: "xai" | "replicate";
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
  const [videoModel, setVideoModel] = useState<"xai-grok-imagine-video" | "replicate-grok-imagine-video">(() => {
    try {
      const raw = String(localStorage.getItem(STORAGE_VIDEO_MODEL) || "").trim();
      if (raw === "xai-grok-imagine-video" || raw === "replicate-grok-imagine-video") return raw;
    } catch {
      // ignore
    }
    return "replicate-grok-imagine-video";
  });
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
    // Create Video defaults to Replicate provider.
    if (toolId === "create-video") {
      setVideoModel("replicate-grok-imagine-video");
    }

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
      const imageToUse = attachedImageDataUrl || pendingConfirm.imageDataUrl;
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

      try {
        const gen = await apiJson<{ success: boolean; request_id: string }>(
          "/api/video/generate",
          {
            prompt: pendingConfirm.prompt,
            image_url: imageToUse,
            duration: durationToUse,
            aspect_ratio: aspectToUse,
            resolution: resolutionToUse,
            provider: pendingConfirm.provider || "xai",
            video_model_id: pendingConfirm.model_id || undefined,
          },
          clerkToken,
          signal
        );

        if (signal.aborted) return;
        if (!gen.request_id) throw new Error("Sem request_id retornado pelo backend.");

        const done = await pollVideo(gen.request_id, clerkToken, signal);
        if (signal.aborted) return;

        addAttachmentsToMessageInThread(threadId, assistantId, [
          {
            id: crypto.randomUUID(),
            kind: "video",
            url: done.url,
            createdAt: Date.now(),
          },
        ]);

        setPendingVideoConfirms((prev) => {
          const { [threadId]: _d, ...rest } = prev;
          return rest;
        });
      } catch (e) {
        if (isAbortError(e) || signal.aborted) return;
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
      }

      return;
    }

    const modelHint = extractImageModelHint(trimmed);
    const promptText = modelHint.prompt || trimmed;

    if (!promptText.trim()) return;

    const wantsCreateImages = activeTools.includes("create-images");
    const wantsEditImage = activeTools.includes("edit-image");
    const wantsCreateVideo = activeTools.includes("create-video");
    const selectedVideoProvider: "xai" | "replicate" =
      videoModel === "replicate-grok-imagine-video" ? "replicate" : "xai";
    const selectedVideoModelId = videoModel === "replicate-grok-imagine-video" ? "xai/grok-imagine-video" : undefined;

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
          imageDataUrl: attachedImageDataUrl,
          duration,
          aspect_ratio: aspectRatio,
          resolution,
          provider: selectedVideoProvider,
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

    const mediaJobs: Promise<void>[] = [];

    // If multiple media tools are enabled together, we chain them so video/edit can use freshly generated images.
    let createImagesPromise: Promise<string | null> | null = null;

    if (wantsCreateImages) {
      createImagesPromise = (async () => {
        try {
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

          return attachments[0]?.url || null;
        } catch (e) {
          if (isAbortError(e) || signal.aborted) return null;
          throw e;
        }
      })();

      mediaJobs.push(createImagesPromise.then(() => undefined));
    }

    if (wantsEditImage) {
      mediaJobs.push(
        (async () => {
          try {
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
              appendTextToMessageInThread(
                threadId,
                assistantId,
                "Aviso: Para usar Edit Image, anexe uma imagem (clipe) ou gere uma imagem antes."
              );
              return;
            }

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
          } catch (e) {
            if (isAbortError(e) || signal.aborted) return;
            throw e;
          }
        })()
      );
    }

    // Clear pending image(s) after enqueueing jobs (we captured data URL already).
    if (pendingImages.length) setPendingImages([]);

    const modelForText = models.some((m) => m.id === model) ? model : pickDefaultModelId(models);
    if (modelForText !== model) setModel(modelForText);

    const deepSearchEnabled = activeTools.includes("deepsearch");
    const thinkEnabled = activeTools.includes("think");
    const reasoningTrace = createReasoningTrace(thinkEnabled, deepSearchEnabled);
    if (reasoningTrace) upsertReasoningTrace(assistantId, reasoningTrace);

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

      const openAIModel = isLikelyOpenAIModel(modelForText);

      const preludeNotes: string[] = [];

      type WebSearchResult = { title: string; url: string; snippet?: string };
      type WebSearchTrace = {
        queries?: string[];
        perQuery?: Array<{ query: string; count: number; error?: string }>;
        total_sources?: number;
      };
      type WebSearchResponse = { success: boolean; results?: WebSearchResult[]; trace?: WebSearchTrace; error?: string };

      let deepSearchAvailable = !deepSearchEnabled;
      let searchContext = "";

      if (deepSearchEnabled) {
        markReasoningStep(assistantId, "analyze", "done");
        updateMessageInThread(threadId, assistantId, {
          text: thinkEnabled ? buildToolLoadingLabel("deepsearch+think") : buildToolLoadingLabel("deepsearch"),
        });
        try {
          const { searchQueries, optimizedQueries } = buildDeepSearchQueries(promptText, thinkEnabled);

          if (thinkEnabled && optimizedQueries.length > 0) {
            markReasoningStep(assistantId, "optimize", "active");
            setReasoningOptimizedQueries(assistantId, optimizedQueries);
            markReasoningStep(assistantId, "optimize", "done", `${optimizedQueries.length} estrategias`);
          }

          markReasoningStep(assistantId, "search", "active");
          setReasoningQueries(assistantId, searchQueries);

          const data = await apiJson<WebSearchResponse>(
            "/api/web/search",
            {
              query: promptText,
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
          const usable = results
            .filter((r) => r && typeof r.url === "string" && r.url.startsWith("http") && typeof r.title === "string")
            .slice(0, 8);

          if (usable.length > 0) {
            deepSearchAvailable = true;
            markReasoningStep(assistantId, "search", "done");
            markReasoningStep(assistantId, "review", "active");
            setReasoningSources(
              assistantId,
              usable.map((item) => ({ title: item.title, url: item.url }))
            );

            searchContext = usable
              .map((r, i) => {
                const snip = r.snippet ? String(r.snippet).trim() : "";
                const short = snip.length > 260 ? `${snip.slice(0, 260)}...` : snip;
                return `[#${i + 1}] ${r.title}\nURL: ${r.url}${short ? `\nResumo: ${short}` : ""}`;
              })
              .join("\n\n");

            markReasoningStep(assistantId, "review", "done", `${usable.length} fontes relevantes`);
          } else {
            deepSearchAvailable = false;
            markReasoningStep(assistantId, "search", "done", "Nenhuma fonte encontrada");
            markReasoningStep(assistantId, "review", "done", "Sem fontes para revisar");
            preludeNotes.push("Aviso: DeepSearch nao retornou resultados nesta tentativa. Respondendo sem fontes.");
          }
        } catch (e) {
          if (isAbortError(e) || signal.aborted) return;
          deepSearchAvailable = false;
          if (thinkEnabled) {
            markReasoningStep(assistantId, "optimize", "done", "Fallback de pesquisa");
          }
          markReasoningStep(assistantId, "search", "done", "Falha na busca");
          markReasoningStep(assistantId, "review", "done", "Busca indisponivel");
          preludeNotes.push("Aviso: DeepSearch falhou nesta tentativa. Respondendo sem fontes.");
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
      } catch (error) {
        if (isAbortError(error) || signal.aborted) return;

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
              return;
            }
          } catch (fallbackError) {
            if (isAbortError(fallbackError) || signal.aborted) return;
            // fallthrough to user-facing moderation message
          }

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

        updateMessageInThread(threadId, assistantId, {
          text: `Erro ao chamar modelo Puter: ${getErrorMessage(error)}`,
        });
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

          <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
        </div>
      </SignedIn>
    </>
  );
}

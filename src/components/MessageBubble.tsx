import { useEffect, useState } from "react";
import type { ChatAttachment, ChatMessage, ReasoningTrace } from "../types";
import MarkdownRenderer from "./MarkdownRenderer";

type MessageBubbleProps = {
  message: ChatMessage;
  onOpenImage?: (url: string) => void;
  typing?: boolean;
  reasoningTrace?: ReasoningTrace;
};

const THINK_TRACE_STEPS: ReasoningTrace["steps"] = [
  { id: "analyze", label: "Analisando a intencao do pedido", status: "active" },
  { id: "plan", label: "Conectando contexto e premissas", status: "pending" },
  { id: "answer", label: "Refinando a melhor resposta", status: "pending" },
];

type ReasoningTickerItem = {
  id: string;
  title: string;
  description?: string;
};

function getStepDescription(step: ReasoningTrace["steps"][number]): string {
  if (step.note && step.note.trim()) return step.note.trim();
  if (step.status === "active") return "Em andamento";
  if (step.status === "done") return "Concluido";
  return "Na fila";
}

function buildStaticTickerTitle(label: string, trace?: ReasoningTrace): string {
  if (trace?.mode === "hybrid") return "THINK + DEEP SEARCH";
  if (trace?.mode === "deepsearch") return "DEEP SEARCH";
  if (trace?.mode === "think") return "THINK";

  const source = `${trace?.title || label}`.toUpperCase();
  if (source.includes("CREATE VIDEO")) return "CREATE VIDEO";
  if (source.includes("EDIT IMAGE")) return "EDIT IMAGE";
  if (source.includes("CREATE IMAGES")) return "CREATE IMAGES";
  return label || "Processando";
}

function buildReasoningTickerItems(label: string, trace?: ReasoningTrace): ReasoningTickerItem[] {
  const steps = trace?.steps?.length ? trace.steps : THINK_TRACE_STEPS;
  const items: ReasoningTickerItem[] = steps.map((step) => ({
    id: `step-${step.id}`,
    title: step.label,
    description: getStepDescription(step),
  }));

  if (trace?.optimizer?.strategy) {
    items.push({
      id: "optimizer-strategy",
      title: trace.optimizer.label || "Optimizer",
      description: trace.optimizer.strategy,
    });
  }

  if (trace?.optimizer?.keywords && trace.optimizer.keywords.length > 0) {
    items.push({
      id: "optimizer-keywords",
      title: "Palavras-chave",
      description: trace.optimizer.keywords.slice(0, 4).join(", "),
    });
  }

  if (trace?.queries && trace.queries.length > 0) {
    items.push({
      id: "search-queries",
      title: "Pesquisando",
      description: `${trace.queries.length} consulta(s) em andamento`,
    });
  }

  if (trace?.sources && trace.sources.length > 0) {
    items.push({
      id: "search-sources",
      title: "Revisando fontes",
      description: `${trace.sources.length} fonte(s) analisada(s)`,
    });
  }

  if (items.length === 0) {
    items.push({
      id: "fallback-loading",
      title: label || "Processando",
      description: "Carregando",
    });
  }

  return items;
}

function ReasoningTracePanel({
  label,
  trace,
}: {
  label: string;
  trace?: ReasoningTrace;
}) {
  const steps = trace?.steps?.length ? trace.steps : THINK_TRACE_STEPS;
  const tickerItems = buildReasoningTickerItems(label, trace);
  const initialStepIndex = Math.max(
    0,
    Math.min(
      tickerItems.length - 1,
      steps.findIndex((step) => step.status === "active")
    )
  );
  const [lineIndex, setLineIndex] = useState(initialStepIndex);

  useEffect(() => {
    setLineIndex((prev) => {
      if (!tickerItems.length) return 0;
      if (prev >= tickerItems.length) return initialStepIndex;
      return prev;
    });
  }, [initialStepIndex, tickerItems.length]);

  useEffect(() => {
    if (tickerItems.length <= 1) return;
    const timer = window.setInterval(() => {
      setLineIndex((prev) => (prev + 1) % tickerItems.length);
    }, 3400);
    return () => window.clearInterval(timer);
  }, [tickerItems.length]);

  const current = tickerItems[lineIndex] || {
    id: "loading",
    title: label || "Processando",
    description: "Carregando",
  };
  const staticTitle = buildStaticTickerTitle(label, trace);
  const rotatingDescription = current.description ? `${current.title}: ${current.description}` : current.title;

  return (
    <div className="reasoning-compact-wrap" role="status" aria-live="polite">
      <span className="reasoning-compact-loader" aria-hidden="true" />
      <div className="reasoning-compact-track">
        <div className="reasoning-compact-line">
          <span className="reasoning-compact-title" title={staticTitle}>
            {staticTitle}
          </span>
          <span className="reasoning-compact-divider">-</span>
          <span
            key={`${current.id}-${lineIndex}`}
            className="reasoning-compact-description reasoning-compact-description-rotating"
            title={rotatingDescription}
          >
            {rotatingDescription}
          </span>
        </div>
      </div>
    </div>
  );
}

function Attachment({ item, onOpenImage }: { item: ChatAttachment; onOpenImage?: (url: string) => void }) {
  if (item.kind === "video") {
    return (
      <div className="message-attachment video">
        <video className="message-media" controls preload="metadata" src={item.url} />
      </div>
    );
  }

  return (
    <a
      className="message-attachment image"
      href={item.url}
      title="Abrir imagem"
      onClick={(e) => {
        if (onOpenImage) {
          e.preventDefault();
          onOpenImage(item.url);
        }
      }}
    >
      <img className="message-media" src={item.url} alt="Generated" loading="lazy" />
    </a>
  );
}

export default function MessageBubble({ message, onOpenImage, typing, reasoningTrace }: MessageBubbleProps) {
  const isTyping = Boolean(typing && message.role === "assistant");
  const isThinkTyping = /\busing THINK\b|\busando THINK\b|THINK/i.test(String(message.text || ""));
  const showReasoningTrace = isTyping && (Boolean(reasoningTrace) || isThinkTyping);
  const knowledgeMeta = message.meta?.knowledge;
  const showKnowledgeBadge = message.role === "assistant" && !isTyping && Boolean(knowledgeMeta?.used);
  const bubbleClass = `message-bubble ${isTyping ? "thinking" : ""} ${showReasoningTrace ? "think-trace" : ""}`.trim();

  return (
    <article className={`message-row ${message.role}`}>
      <div className={bubbleClass}>
        {showKnowledgeBadge ? (
          <div className="message-badge-row">
            <span
              className="message-badge knowledge"
              title={`Knowledge Studio${knowledgeMeta?.sourceCount ? `: ${knowledgeMeta.sourceCount} fonte(s)` : ""}${
                knowledgeMeta?.engine ? ` | engine: ${knowledgeMeta.engine}` : ""
              }`}
            >
              Knowledge
            </span>
          </div>
        ) : null}
        {isTyping ? (
          showReasoningTrace ? (
            <ReasoningTracePanel
              label={reasoningTrace?.title || message.text || "KILLA esta usando THINK para pensar profundamente..."}
              trace={reasoningTrace}
            />
          ) : (
            <>
              <span className="thinking-label">{message.text || "KILLA esta pensando"}</span>
              <div className="dots" aria-label="typing indicator">
                <span />
                <span />
                <span />
              </div>
            </>
          )
        ) : (
          <div className="message-markdown">
            <MarkdownRenderer content={message.text} />
          </div>
        )}

        {!isTyping && message.attachments && message.attachments.length > 0 ? (
          <div className="message-attachments">
            {message.attachments.map((item) => (
              <Attachment key={item.id} item={item} onOpenImage={onOpenImage} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

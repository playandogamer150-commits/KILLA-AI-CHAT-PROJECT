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

function OptimizerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.75 13.7 8.3l4.55 1.7-4.55 1.7L12 16.25l-1.7-4.55-4.55-1.7 4.55-1.7L12 3.75Zm6.35 10.9.9 2.45 2.45.9-2.45.9-.9 2.45-.9-2.45-2.45-.9 2.45-.9.9-2.45Zm-12.7 0 .9 2.45 2.45.9-2.45.9-.9 2.45-.9-2.45-2.45-.9 2.45-.9.9-2.45Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ReasoningTracePanel({
  label,
  trace,
}: {
  label: string;
  trace?: ReasoningTrace;
}) {
  const [activeStep, setActiveStep] = useState(0);
  const steps = trace?.steps?.length ? trace.steps : THINK_TRACE_STEPS;

  useEffect(() => {
    if (trace?.steps?.length) return;
    setActiveStep(0);
    const timer = window.setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length);
    }, 900);

    return () => window.clearInterval(timer);
  }, [steps.length, trace?.steps]);

  return (
    <div className="think-trace-wrap reasoning-trace-wrap" role="status" aria-live="polite">
      <div className="think-trace-title">{label}</div>
      <div className="think-trace-list">
        {steps.map((step, index) => {
          const isDone = trace ? step.status === "done" : index < activeStep;
          const isActive = trace ? step.status === "active" : index === activeStep;

          return (
            <div key={step.id} className={`think-trace-step ${isDone ? "done" : ""} ${isActive ? "active" : ""}`.trim()}>
              <span className="think-trace-dot" aria-hidden="true" />
              <span className="think-trace-text">{step.label}</span>
            </div>
          );
        })}
      </div>

      {trace?.optimizer ? (
        <section className="reasoning-section">
          <div className="reasoning-section-title with-icon">
            <span className="reasoning-section-icon" aria-hidden="true">
              <OptimizerIcon />
            </span>
            <span>{trace.optimizer.label}</span>
          </div>
          {trace.optimizedQueries && trace.optimizedQueries.length > 0 ? (
            <div className="reasoning-query-chips">
              {trace.optimizedQueries.map((query) => (
                <div key={`opt-${query}`} className="reasoning-query-chip optimizer" title={query}>
                  {query}
                </div>
              ))}
            </div>
          ) : (
            <div className="reasoning-optimizer-note">Gerando estrategia otimizada de pesquisa...</div>
          )}
        </section>
      ) : null}

      {trace?.queries && trace.queries.length > 0 ? (
        <section className="reasoning-section">
          <div className="reasoning-section-title">Pesquisando</div>
          <div className="reasoning-query-chips">
            {trace.queries.map((query) => (
              <div key={query} className="reasoning-query-chip" title={query}>
                {query}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {trace?.sources && trace.sources.length > 0 ? (
        <section className="reasoning-section">
          <div className="reasoning-section-title">Revisando fontes</div>
          <div className="reasoning-sources">
            {trace.sources.map((source, idx) => (
              (() => {
                let domain = "";
                if (source.url) {
                  try {
                    domain = new URL(source.url).hostname;
                  } catch {
                    domain = "";
                  }
                }

                return (
                  <a
                    key={`${source.url || source.title}-${idx}`}
                    className="reasoning-source-row"
                    href={source.url || "#"}
                    target={source.url ? "_blank" : undefined}
                    rel={source.url ? "noreferrer noopener" : undefined}
                    onClick={(e) => {
                      if (!source.url) e.preventDefault();
                    }}
                  >
                    <span className="reasoning-source-title">{source.title}</span>
                    {domain ? <span className="reasoning-source-domain">{domain}</span> : null}
                  </a>
                );
              })()
            ))}
          </div>
        </section>
      ) : null}
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
  const bubbleClass = `message-bubble ${isTyping ? "thinking" : ""} ${showReasoningTrace ? "think-trace" : ""}`.trim();

  return (
    <article className={`message-row ${message.role}`}>
      <div className={bubbleClass}>
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

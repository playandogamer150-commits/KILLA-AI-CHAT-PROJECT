import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { Tool } from "../types";

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  disabled: boolean;
  activeTools: string[];
  onToolToggle: (toolId: string) => void;
  onPickImage: (file: File) => void;
  attachedImages: Array<{ id: string; name: string; previewUrl: string | null }>;
  onRemoveAttachment: (id: string) => void;
  creditsRemaining?: number | null;
  creditPlanLabel?: string | null;
  videoBadgeLabel?: string | null;
};

function ToolSearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ToolThinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4.5a3.5 3.5 0 0 0-3.5 3.5v.5A3 3 0 0 0 4 11v2a3 3 0 0 0 1.5 2.6V16A3.5 3.5 0 0 0 9 19.5h.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 4.5a3.5 3.5 0 0 1 3.5 3.5v.5A3 3 0 0 1 20 11v2a3 3 0 0 1-1.5 2.6V16a3.5 3.5 0 0 1-3.5 3.5h-.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.2 9.2h.01M14.8 9.2h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9 13c1.8 1.6 4.2 1.6 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ToolImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 18h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M8 12.5 10.2 10.3 15.7 15.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M13.6 13.7 15 12.3 18 15.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9 9.3h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ToolEditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4l11-11a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L4 16v4Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ToolVideoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5v9A2.5 2.5 0 0 1 13.5 19h-7A2.5 2.5 0 0 1 4 16.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M16 10.2 20 8v8l-4-2.2v-3.6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function renderToolIcon(iconId: string) {
  switch (iconId) {
    case "search":
      return <ToolSearchIcon />;
    case "think":
      return <ToolThinkIcon />;
    case "image":
      return <ToolImageIcon />;
    case "edit":
      return <ToolEditIcon />;
    case "video":
      return <ToolVideoIcon />;
    default:
      return null;
  }
}

// Tool chips mirror Grok-style quick modes for prompt routing UX.
const TOOLS: Tool[] = [
  { id: "deepsearch", label: "DeepSearch", icon: "search" },
  { id: "think", label: "Think", icon: "think" },
  { id: "create-images", label: "Create Images", icon: "image" },
  { id: "edit-image", label: "Edit Image", icon: "edit" },
  { id: "create-video", label: "Create Video", icon: "video" },
];

function AttachmentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8.5 12.5 14.8 6.2a3 3 0 1 1 4.2 4.2l-7.1 7.1a5 5 0 1 1-7.1-7.1l7.8-7.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 11.5a6 6 0 1 0 12 0M12 18v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 18V6M12 6l-4.5 4.5M12 6l4.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function Composer({
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled,
  activeTools,
  onToolToggle,
  onPickImage,
  attachedImages,
  onRemoveAttachment,
  creditsRemaining,
  creditPlanLabel,
  videoBadgeLabel,
}: ComposerProps) {
  const canSend = value.trim().length > 0 && !disabled;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const keyPulseTimeoutRef = useRef<number | null>(null);

  const speechRef = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const [typingPulse, setTypingPulse] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ url: string; x: number; y: number } | null>(null);

  const speechSupported = useMemo(() => {
    try {
      return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (keyPulseTimeoutRef.current) {
        window.clearTimeout(keyPulseTimeoutRef.current);
        keyPulseTimeoutRef.current = null;
      }
      try {
        speechRef.current?.stop?.();
      } catch {
        // ignore
      }
    };
  }, []);

  useEffect(() => {
    if (!hoverPreview) return;
    const stillExists = attachedImages.some((item) => item.previewUrl === hoverPreview.url);
    if (!stillExists) setHoverPreview(null);
  }, [attachedImages, hoverPreview]);

  const toggleVoice = () => {
    if (!speechSupported) return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    if (listening) {
      try {
        speechRef.current?.stop?.();
      } catch {
        // ignore
      }
      setListening(false);
      return;
    }

    const rec = new SR();
    speechRef.current = rec;
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = false;

    let finalText = "";

    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = String(res?.[0]?.transcript || "");
        if (res.isFinal) finalText += t;
      }

      const cleaned = finalText.trim().replace(/\s+/g, " ");
      if (cleaned) {
        const next = [value.trim(), cleaned].filter(Boolean).join(" ");
        onChange(next);
      }
    };

    rec.onerror = () => {
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
    };

    try {
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return;

    // If the clipboard contains an image file, attach it instead of pasting random chars/base64 into the chat.
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      if (!item.type || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;

      onPickImage(file);
      event.preventDefault();
      return;
    }
  };

  const triggerTypingPulse = () => {
    setTypingPulse(false);
    window.requestAnimationFrame(() => {
      setTypingPulse(true);
    });
    if (keyPulseTimeoutRef.current) window.clearTimeout(keyPulseTimeoutRef.current);
    keyPulseTimeoutRef.current = window.setTimeout(() => {
      setTypingPulse(false);
      keyPulseTimeoutRef.current = null;
    }, 220);
  };

  const placeHoverPreview = (event: ReactMouseEvent<HTMLElement>, url: string) => {
    const previewWidth = 300;
    const previewHeight = 220;
    const padding = 14;
    const offsetX = 18;
    const offsetY = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.min(Math.max(event.clientX + offsetX, padding), Math.max(padding, vw - previewWidth - padding));
    const y = Math.min(Math.max(event.clientY - previewHeight - offsetY, padding), Math.max(padding, vh - previewHeight - padding));
    setHoverPreview({ url, x, y });
  };

  return (
    <footer className="composer-shell">
      <div className="composer-inner">
        {attachedImages.length > 0 ? (
          <div className="attachment-chips" role="status" aria-label="Imagens anexadas">
            {attachedImages.map((attachment) => (
              <div
                key={attachment.id}
                className={`attachment-chip ${attachment.previewUrl ? "previewable" : ""}`}
                aria-label={`Imagem anexada: ${attachment.name}`}
                onMouseEnter={(event) => {
                  if (!attachment.previewUrl) return;
                  placeHoverPreview(event, attachment.previewUrl);
                }}
                onMouseMove={(event) => {
                  if (!attachment.previewUrl) return;
                  placeHoverPreview(event, attachment.previewUrl);
                }}
                onMouseLeave={() => {
                  setHoverPreview(null);
                }}
              >
                {attachment.previewUrl ? (
                  <img className="attachment-chip-thumb" src={attachment.previewUrl} alt="" aria-hidden="true" />
                ) : (
                  <span className="attachment-chip-thumb fallback" aria-hidden="true" />
                )}
                <button
                  type="button"
                  className="attachment-chip-clear"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  aria-label="Remover imagem"
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {hoverPreview ? (
          <div
            className="attachment-hover-preview"
            style={{
              left: `${hoverPreview.x}px`,
              top: `${hoverPreview.y}px`,
            }}
            aria-hidden="true"
          >
            <img className="attachment-hover-preview-media" src={hoverPreview.url} alt="" />
          </div>
        ) : null}

        <div className="tools-row" role="toolbar" aria-label="AI tools">
          {typeof creditsRemaining === "number" ? (
            <span className="composer-credit-pill">{`${creditPlanLabel || "Acesso"}: ${creditsRemaining} creditos`}</span>
          ) : null}
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={`tool-pill ${activeTools.includes(tool.id) ? "active" : ""}`}
              onClick={() => onToolToggle(tool.id)}
            >
              <span className="tool-pill-icon" aria-hidden="true">
                {renderToolIcon(tool.icon)}
              </span>
              {tool.label}
              {tool.id === "create-video" && videoBadgeLabel ? <span className="tool-pill-badge">{videoBadgeLabel}</span> : null}
            </button>
          ))}
        </div>

        <div className={`composer-box ${typingPulse ? "typing-pulse" : ""}`.trim()}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple={activeTools.includes("edit-image")}
            style={{ display: "none" }}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              for (const file of files) onPickImage(file);
              // allow re-selecting the same file
              event.currentTarget.value = "";
            }}
          />

          <button type="button" className="icon-btn" aria-label="Attach image" onClick={() => fileRef.current?.click()}>
            <AttachmentIcon />
          </button>

          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={listening ? "Ouvindo... fale agora" : "Como o KILLA pode ajudar?"}
            rows={1}
            onPaste={onPaste}
            // Enter sends, Shift+Enter creates a new line.
            onKeyDown={(event) => {
              if (
                event.key.length === 1 ||
                event.key === "Backspace" ||
                event.key === "Delete" ||
                event.key === "Enter"
              ) {
                triggerTypingPulse();
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) onSubmit();
              }
            }}
          />

          <button
            type="button"
            className={`icon-btn ${listening ? "active" : ""}`}
            aria-label={speechSupported ? "Voice input" : "Voice input unavailable"}
            title={speechSupported ? (listening ? "Ouvindo..." : "Ditado (pt-BR)") : "Seu navegador nao suporta ditado"}
            onClick={toggleVoice}
            disabled={!speechSupported}
          >
            <MicIcon />
          </button>

          {disabled ? (
            <button
              type="button"
              className="stop-btn"
              onClick={onCancel}
              aria-label="Cancelar geracao"
              title="Pausar (cancelar) geracao"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              className={`send-btn ${canSend ? "active" : ""}`}
              onClick={onSubmit}
              disabled={!canSend}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}

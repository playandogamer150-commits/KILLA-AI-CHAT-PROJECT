import { useEffect, useMemo, useRef, useState } from "react";
import { UserButton } from "@clerk/clerk-react";
import type { ModelOption } from "../types";
import logoUrl from "../assets/killa-logo.svg";

type ModelToggleCompat = {
  deepsearch: boolean;
  think: boolean;
  combo: boolean;
  verifiedAt: number;
};

type TopBarProps = {
  model: string;
  models: ModelOption[];
  modelsLoading: boolean;
  onModelChange: (value: string) => void;
  modelToggleCompatById: Record<string, ModelToggleCompat>;
  modelCompatCheckingById: Record<string, boolean>;

  activeTools: string[];
  imageModel: "seedream-4.5" | "nano-banana-pro";
  onImageModelChange: (value: "seedream-4.5" | "nano-banana-pro") => void;
  videoModel: "modelslab-grok-imagine-video-i2v";
  onVideoModelChange: (value: "modelslab-grok-imagine-video-i2v") => void;

  connected: boolean;
  onConnectClick: () => void;
  onDisconnectClick: () => void;
  onToggleSidebar: () => void;
  onNewChat: () => void;
  onNewMediaChat: () => void;
};

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function useOutsideClick(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && el.contains(target)) return;
      onOutside();
    };

    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [enabled, onOutside, ref]);
}

function ModelDropdown({
  value,
  models,
  loading,
  onChange,
  modelToggleCompatById,
  modelCompatCheckingById,
  buttonTitle,
  buttonSubtitle,
  buttonClassName,
}: {
  value: string;
  models: ModelOption[];
  loading: boolean;
  onChange: (id: string) => void;
  modelToggleCompatById: Record<string, ModelToggleCompat>;
  modelCompatCheckingById: Record<string, boolean>;
  buttonTitle?: string;
  buttonSubtitle?: string;
  buttonClassName?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useOutsideClick(wrapRef, () => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const selected = useMemo(() => models.find((m) => m.id === value), [models, value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return models;
    const q = query.trim().toLowerCase();
    return models.filter((m) => (`${m.name} ${m.provider || ""} ${m.id}`).toLowerCase().includes(q));
  }, [models, query]);

  const label = loading
    ? "Loading models..."
    : selected
      ? `${selected.name}${selected.provider ? ` (${selected.provider})` : ""}`
      : value || "Select model";

  return (
    <div ref={wrapRef} className={`model-dd ${open ? "open" : ""}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`model-dd-btn ${buttonClassName || ""}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        title={label}
      >
        {buttonTitle ? (
          <span className="model-dd-labelstack">
            <span className="model-dd-title">{buttonTitle}</span>
            <span className="model-dd-subtitle">{buttonSubtitle || label}</span>
          </span>
        ) : (
          <span className="model-dd-label">{label}</span>
        )}
        <span className="model-dd-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {open ? (
        <div className="model-dd-pop" role="dialog" aria-label="Model picker">
          <div className="model-dd-search">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar modelo..."
              aria-label="Search model"
            />
          </div>

          <div className="model-dd-list" role="listbox" aria-label="Models">
            {filtered.length === 0 ? (
              <div className="model-dd-empty">Nenhum modelo encontrado.</div>
            ) : (
              filtered.map((m) => {
                const isActive = m.id === value;
                const compat = modelToggleCompatById[m.id];
                const checking = Boolean(modelCompatCheckingById[m.id]);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={`model-dd-opt ${isActive ? "active" : ""}`}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                      setQuery("");
                      buttonRef.current?.focus();
                    }}
                  >
                    <div className="model-dd-opt-title">{m.name}</div>
                    <div className="model-dd-opt-sub">
                      <span>{m.provider || "unknown"}</span>
                      <span className="sep">|</span>
                      <span className="mono">{m.id}</span>
                    </div>
                    <div className="model-dd-opt-badges">
                      {compat?.deepsearch ? <span className="model-dd-badge">DeepSearch</span> : null}
                      {compat?.think ? <span className="model-dd-badge">Think</span> : null}
                      {compat?.combo ? <span className="model-dd-badge">DeepSearch+Think</span> : null}
                      {checking ? <span className="model-dd-badge checking">Verificando...</span> : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MediaDropdown({
  title,
  subtitle,
  imageModel,
  onImageModelChange,
  videoModel,
  onVideoModelChange,
}: {
  title: string;
  subtitle: string;
  imageModel: "seedream-4.5" | "nano-banana-pro";
  onImageModelChange: (value: "seedream-4.5" | "nano-banana-pro") => void;
  videoModel: "modelslab-grok-imagine-video-i2v";
  onVideoModelChange: (value: "modelslab-grok-imagine-video-i2v") => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const [open, setOpen] = useState(false);

  useOutsideClick(wrapRef, () => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={wrapRef} className={`model-dd media-dd ${open ? "open" : ""}`}>
      <button
        ref={buttonRef}
        type="button"
        className="model-dd-btn tall"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={subtitle}
      >
        <span className="model-dd-labelstack">
          <span className="model-dd-title">{title}</span>
          <span className="model-dd-subtitle">{subtitle}</span>
        </span>
        <span className="model-dd-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {open ? (
        <div className="model-dd-pop" role="dialog" aria-label="Media models">
          <div className="model-dd-list" role="listbox" aria-label="Models">
            <div className="model-dd-group-title">Create Images</div>
            <button
              type="button"
              className={`model-dd-opt ${imageModel === "seedream-4.5" ? "active" : ""}`}
              role="option"
              aria-selected={imageModel === "seedream-4.5"}
              onClick={() => {
                onImageModelChange("seedream-4.5");
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <div className="model-dd-opt-title">Seedream 4.5</div>
              <div className="model-dd-opt-sub">
                <span>ModelsLab</span>
                <span className="sep">|</span>
                <span className="mono">seedream-4.5</span>
              </div>
            </button>

            <button
              type="button"
              className={`model-dd-opt ${imageModel === "nano-banana-pro" ? "active" : ""}`}
              role="option"
              aria-selected={imageModel === "nano-banana-pro"}
              onClick={() => {
                onImageModelChange("nano-banana-pro");
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <div className="model-dd-opt-title">Nano Banana Pro</div>
              <div className="model-dd-opt-sub">
                <span>ModelsLab</span>
                <span className="sep">|</span>
                <span className="mono">nano-banana-pro</span>
              </div>
            </button>

            <div className="model-dd-group-title">Edit Image</div>
            <button type="button" className="model-dd-opt disabled" disabled>
              <div className="model-dd-opt-title">Grok Imagine Image Edit</div>
              <div className="model-dd-opt-sub">
                <span>ModelsLab</span>
                <span className="sep">|</span>
                <span className="mono">grok-imagine-image-i2i</span>
              </div>
            </button>

            <div className="model-dd-group-title">Create Video</div>
            <button
              type="button"
              className={`model-dd-opt ${videoModel === "modelslab-grok-imagine-video-i2v" ? "active" : ""}`}
              role="option"
              aria-selected={videoModel === "modelslab-grok-imagine-video-i2v"}
              onClick={() => {
                onVideoModelChange("modelslab-grok-imagine-video-i2v");
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <div className="model-dd-opt-title">Grok Imagine Img2Video</div>
              <div className="model-dd-opt-sub">
                <span>ModelsLab</span>
                <span className="sep">|</span>
                <span className="mono">grok-imagine-video-i2v</span>
              </div>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function TopBar({
  model,
  models,
  modelsLoading,
  onModelChange,
  modelToggleCompatById,
  modelCompatCheckingById,
  activeTools,
  imageModel,
  onImageModelChange,
  videoModel,
  onVideoModelChange,
  connected,
  onConnectClick,
  onDisconnectClick,
  onToggleSidebar,
  onNewChat,
  onNewMediaChat,
}: TopBarProps) {
  const selected = useMemo(() => models.find((m) => m.id === model), [models, model]);
  const textSubtitle = modelsLoading
    ? "Loading..."
    : selected
      ? `${selected.name}${selected.provider ? ` (${selected.provider})` : ""}`
      : model || "Select model";

  const imageSubtitle = imageModel === "seedream-4.5" ? "Seedream 4.5" : "Nano Banana Pro";

  const mediaTitle = activeTools.includes("create-video")
    ? "Killa Model Video"
    : (activeTools.includes("create-images") || activeTools.includes("edit-image"))
      ? "Killa Model Image"
      : "Killa Model Media";

  const mediaSubtitle = activeTools.includes("create-video")
    ? "Grok Imagine Img2Video (ModelsLab)"
    : activeTools.includes("edit-image")
      ? "Grok Imagine Image Edit"
      : imageSubtitle;

  const newWrapRef = useRef<HTMLDivElement | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  useOutsideClick(newWrapRef, () => setNewOpen(false), newOpen);

  useEffect(() => {
    if (!newOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newOpen]);

  return (
    <header className="top-bar">
      <div className="brand">
        <button type="button" className="icon-btn topbar-menu" onClick={onToggleSidebar} aria-label="Toggle chats">
          <MenuIcon />
        </button>
        <img className="brand-logo" src={logoUrl} alt="" aria-hidden="true" />
        <span>KILLA CHAT</span>
      </div>

      <div className="top-center" aria-label="Model selectors">
        <ModelDropdown
          value={model}
          models={models}
          loading={modelsLoading}
          onChange={onModelChange}
          modelToggleCompatById={modelToggleCompatById}
          modelCompatCheckingById={modelCompatCheckingById}
          buttonTitle="Killa Model Chat"
          buttonSubtitle={textSubtitle}
          buttonClassName="tall"
        />

        <MediaDropdown
          title={mediaTitle}
          subtitle={mediaSubtitle}
          imageModel={imageModel}
          onImageModelChange={onImageModelChange}
          videoModel={videoModel}
          onVideoModelChange={onVideoModelChange}
        />
      </div>

      <div className="top-actions">
        <div className="clerk-user" title="Conta">
          <UserButton afterSignOutUrl="/" />
        </div>

        <div ref={newWrapRef} className={`new-dd ${newOpen ? "open" : ""}`}>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setNewOpen((v) => !v)}
            title="Novo"
            aria-haspopup="menu"
            aria-expanded={newOpen}
          >
            <span className="ghost-btn-icon" aria-hidden="true">
              <PlusIcon />
            </span>
            Novo
          </button>

          {newOpen ? (
            <div className="new-dd-pop" role="menu" aria-label="Novo">
              <button
                type="button"
                className="new-dd-item"
                role="menuitem"
                onClick={() => {
                  setNewOpen(false);
                  onNewChat();
                }}
              >
                <div className="new-dd-title">Novo chat</div>
                <div className="new-dd-sub">Texto (Puter)</div>
              </button>
              <button
                type="button"
                className="new-dd-item"
                role="menuitem"
                onClick={() => {
                  setNewOpen(false);
                  onNewMediaChat();
                }}
              >
                <div className="new-dd-title">Novo midia</div>
                <div className="new-dd-sub">Imagem / video</div>
              </button>
            </div>
          ) : null}
        </div>

        <button type="button" className="ghost-btn" onClick={onConnectClick} title="Conectar Puter">
          {connected ? "Puter: OK" : "Puter: Conectar"}
        </button>

        {connected && (
          <button type="button" className="ghost-btn" onClick={onDisconnectClick} title="Desconectar Puter">
            Puter: Sair
          </button>
        )}
      </div>
    </header>
  );
}

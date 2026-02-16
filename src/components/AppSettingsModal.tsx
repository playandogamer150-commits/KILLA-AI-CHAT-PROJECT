import { useEffect, useMemo, useState } from "react";

type AppSettingsModalProps = {
  open: boolean;
  onClose: () => void;
  puterConnected: boolean;
  onPuterConnect: () => void;
  onPuterDisconnect: () => void;
};

type HealthResponse = {
  status?: string;
  apis?: {
    modelslab?: boolean;
    xai?: boolean;
    serpapi?: boolean;
  };
};

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function AppSettingsModal({
  open,
  onClose,
  puterConnected,
  onPuterConnect,
  onPuterDisconnect,
}: AppSettingsModalProps) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const apis = useMemo(() => {
    const a = health?.apis || {};
    return {
      serpapi: Boolean(a.serpapi),
      modelslab: Boolean(a.modelslab),
      xai: Boolean(a.xai),
    };
  }, [health]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setHealth(null);

    void (async () => {
      try {
        const res = await fetch("/api/health");
        const json = (await res.json()) as HealthResponse;
        if (!cancelled) setHealth(json);
      } catch {
        if (!cancelled) setHealth({ status: "error", apis: {} });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Configuracoes"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <div className="settings-headings">
            <div className="settings-title">Configuracoes</div>
            <div className="settings-sub">Conta, integracoes e status do KILLA CHAT.</div>
          </div>
          <button type="button" className="icon-btn mini" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-card">
            <div className="settings-card-top">
              <div className="settings-card-title">Puter</div>
              <div className="settings-card-desc">Conexao usada para modelos de texto (Claude, GPT, DeepSeek, etc.).</div>
            </div>

            <div className="segmented">
              <button type="button" className={`seg-btn ${puterConnected ? "active" : ""}`} onClick={onPuterConnect}>
                {puterConnected ? "Conectado" : "Conectar"}
              </button>
              <button type="button" className="seg-btn" onClick={onPuterDisconnect} disabled={!puterConnected}>
                Desconectar
              </button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-top">
              <div className="settings-card-title">Status do Backend</div>
              <div className="settings-card-desc">
                {loading ? "Carregando..." : "Checagem rapida das APIs usadas por DeepSearch / Midia."}
              </div>
            </div>

            <div className="settings-readonly" aria-label="Health status">
              SerpAPI (DeepSearch): {apis.serpapi ? "OK" : "OFF"}
              {"\n"}
              ModelsLab (Imagens): {apis.modelslab ? "OK" : "OFF"}
              {"\n"}
              xAI (Video): {apis.xai ? "OK" : "OFF"}
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-top">
              <div className="settings-card-title">Dica</div>
              <div className="settings-card-desc">
                Se algo parecer \"falso\" (ex.: botao sem efeito), isso geralmente e falta de permissao/chave, ou um
                recurso ainda nao implementado. Aqui a gente so deixa botao ativo quando existe mecanismo real por tras.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

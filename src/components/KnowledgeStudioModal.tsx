import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/clerk-react";

type KnowledgeStudioModalProps = {
  open: boolean;
  onClose: () => void;
};

type KnowledgeType = "note" | "code" | "web" | "api" | "file" | "image" | "video";

type KnowledgeItem = {
  id: string;
  title: string;
  type: KnowledgeType;
  summary: string;
  content: string;
  url: string;
  tags: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

type KnowledgeStatusResponse = {
  success: boolean;
  is_admin?: boolean;
  admin_configured?: boolean;
  stats?: {
    total_items?: number;
    updated_at?: number;
    by_type?: Record<string, number>;
  };
  error?: string;
};

type KnowledgeListResponse = {
  success: boolean;
  total?: number;
  items?: KnowledgeItem[];
  error?: string;
};

const KNOWLEDGE_TYPE_OPTIONS: Array<{ value: KnowledgeType; label: string }> = [
  { value: "note", label: "Note" },
  { value: "code", label: "Code" },
  { value: "web", label: "Web" },
  { value: "api", label: "API" },
  { value: "file", label: "File" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
];

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <ellipse cx="12" cy="6" rx="7.5" ry="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 6v6c0 1.9 3.3 3.5 7.5 3.5s7.5-1.6 7.5-3.5V6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 12v6c0 1.9 3.3 3.5 7.5 3.5s7.5-1.6 7.5-3.5v-6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const maybe = payload as { error?: string; message?: string };
    if (maybe.error) return maybe.error;
    if (maybe.message) return maybe.message;
  }
  return fallback;
}

function formatTimestamp(value?: number) {
  if (!value || !Number.isFinite(value)) return "-";
  try {
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

export default function KnowledgeStudioModal({ open, onClose }: KnowledgeStudioModalProps) {
  const { getToken } = useAuth();

  const [statusLoading, setStatusLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<KnowledgeStatusResponse | null>(null);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<KnowledgeType | "">("");

  const [formType, setFormType] = useState<KnowledgeType>("note");
  const [formTitle, setFormTitle] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formSummary, setFormSummary] = useState("");
  const [formContent, setFormContent] = useState("");

  const isAdmin = Boolean(status?.is_admin);
  const statsByType = status?.stats?.by_type || {};
  const totalFromStatus = Number(status?.stats?.total_items || 0);
  const lastUpdated = Number(status?.stats?.updated_at || 0);

  const typeChips = useMemo(() => {
    return KNOWLEDGE_TYPE_OPTIONS.map((option) => ({
      ...option,
      count: Number(statsByType[option.value] || 0),
    })).filter((item) => item.count > 0);
  }, [statsByType]);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch("/api/knowledge/status", {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = (await res.json()) as KnowledgeStatusResponse;
      if (!res.ok || !json?.success) {
        throw new Error(getErrorMessage(json, `HTTP ${res.status}`));
      }
      setStatus(json);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Falha ao carregar status do Knowledge Studio.");
    } finally {
      setStatusLoading(false);
    }
  }, [getToken]);

  const loadItems = useCallback(async () => {
    if (!isAdmin) return;
    setItemsLoading(true);
    setError("");
    try {
      const token = await getToken();
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (typeFilter) params.set("type", typeFilter);
      params.set("limit", "120");
      const res = await fetch(`/api/knowledge/items?${params.toString()}`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = (await res.json()) as KnowledgeListResponse;
      if (!res.ok || !json?.success) {
        throw new Error(getErrorMessage(json, `HTTP ${res.status}`));
      }
      setItems(Array.isArray(json.items) ? json.items : []);
      setTotalItems(Number(json.total || 0));
    } catch (e) {
      setItems([]);
      setTotalItems(0);
      setError(e instanceof Error ? e.message : "Falha ao carregar itens da base.");
    } finally {
      setItemsLoading(false);
    }
  }, [getToken, isAdmin, query, typeFilter]);

  useEffect(() => {
    if (!open) return;
    void loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    const timer = window.setTimeout(() => {
      void loadItems();
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, isAdmin, loadItems]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submitItem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = formTitle.trim();
    const summary = formSummary.trim();
    const content = formContent.trim();
    const url = formUrl.trim();
    if (!title) {
      setError("Titulo e obrigatorio.");
      return;
    }
    if (!summary && !content && !url) {
      setError("Preencha resumo, conteudo ou URL.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch("/api/knowledge/items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: formType,
          title,
          summary,
          content,
          url,
          tags: formTags,
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json?.success) {
        throw new Error(getErrorMessage(json, `HTTP ${res.status}`));
      }

      setFormTitle("");
      setFormUrl("");
      setFormTags("");
      setFormSummary("");
      setFormContent("");
      await loadStatus();
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar item.");
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async (id: string) => {
    const confirmed = window.confirm("Excluir esta fonte da base central?");
    if (!confirmed) return;

    setError("");
    try {
      const token = await getToken();
      const res = await fetch(`/api/knowledge/items/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json?.success) {
        throw new Error(getErrorMessage(json, `HTTP ${res.status}`));
      }
      await loadStatus();
      await loadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao remover item.");
    }
  };

  if (!open) return null;

  return (
    <div className="knowledge-backdrop" role="presentation" onClick={onClose}>
      <section
        className="knowledge-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Knowledge Studio"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="knowledge-header">
          <div className="knowledge-header-main">
            <div className="knowledge-title-row">
              <span className="knowledge-title-icon" aria-hidden="true">
                <DatabaseIcon />
              </span>
              <div className="knowledge-title-wrap">
                <div className="knowledge-title">Knowledge Studio</div>
                <div className="knowledge-sub">
                  Dataset central para DeepSearch + Think. Ingestao manual de codigo, links, APIs, files, imagens e videos.
                </div>
              </div>
            </div>
            <div className="knowledge-kpis">
              <div className="knowledge-kpi">
                <span>Total</span>
                <strong>{statusLoading ? "..." : totalFromStatus}</strong>
              </div>
              <div className="knowledge-kpi">
                <span>Atualizado</span>
                <strong>{statusLoading ? "..." : formatTimestamp(lastUpdated)}</strong>
              </div>
              <div className={`knowledge-kpi ${isAdmin ? "ok" : "warn"}`}>
                <span>Acesso</span>
                <strong>{statusLoading ? "..." : isAdmin ? "Admin" : "Somente leitura"}</strong>
              </div>
            </div>
          </div>
          <button type="button" className="icon-btn mini" onClick={onClose} aria-label="Fechar">
            <XIcon />
          </button>
        </header>

        <div className="knowledge-body">
          <div className="knowledge-stats-row">
            {typeChips.length > 0 ? (
              typeChips.map((chip) => (
                <span key={chip.value} className="knowledge-type-chip">
                  {chip.label}: {chip.count}
                </span>
              ))
            ) : (
              <span className="knowledge-type-chip muted">Sem itens catalogados ainda</span>
            )}
          </div>

          {error ? <div className="knowledge-error">{error}</div> : null}

          {!isAdmin ? (
            <div className="knowledge-readonly-box">
              Seu usuario esta sem permissao de escrita para o Knowledge Studio.
              <br />
              Configure `KNOWLEDGE_ADMIN_USER_IDS` no backend para liberar o dashboard admin.
            </div>
          ) : (
            <div className="knowledge-grid">
              <form className="knowledge-card knowledge-ingest" onSubmit={submitItem}>
                <div className="knowledge-card-head">
                  <div className="knowledge-card-title">Ingerir Fonte</div>
                  <div className="knowledge-card-desc">Salve dados estruturados para o DeepSearch priorizar o seu dataset.</div>
                </div>

                <div className="knowledge-form-grid">
                  <label className="knowledge-field">
                    <span>Tipo</span>
                    <select value={formType} onChange={(event) => setFormType(event.target.value as KnowledgeType)}>
                      {KNOWLEDGE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="knowledge-field">
                    <span>Titulo</span>
                    <input
                      value={formTitle}
                      onChange={(event) => setFormTitle(event.target.value)}
                      placeholder="Ex.: Playbook de prompts para agente de vendas"
                      maxLength={180}
                    />
                  </label>

                  <label className="knowledge-field">
                    <span>URL / Fonte</span>
                    <input
                      value={formUrl}
                      onChange={(event) => setFormUrl(event.target.value)}
                      placeholder="https://..."
                    />
                  </label>

                  <label className="knowledge-field">
                    <span>Tags (separadas por virgula)</span>
                    <input value={formTags} onChange={(event) => setFormTags(event.target.value)} placeholder="growth, prompt, funnel" />
                  </label>

                  <label className="knowledge-field">
                    <span>Resumo curto</span>
                    <textarea
                      value={formSummary}
                      onChange={(event) => setFormSummary(event.target.value)}
                      placeholder="Sintese com os principais pontos para ranking rapido."
                      rows={3}
                    />
                  </label>

                  <label className="knowledge-field">
                    <span>Conteudo completo</span>
                    <textarea
                      value={formContent}
                      onChange={(event) => setFormContent(event.target.value)}
                      placeholder="Cole codigo, payload de API, extrato de scraping, notas, transcricao..."
                      rows={8}
                    />
                  </label>
                </div>

                <div className="knowledge-actions">
                  <button type="submit" className="seg-btn active" disabled={saving}>
                    {saving ? "Salvando..." : "Salvar no dataset"}
                  </button>
                  <button
                    type="button"
                    className="seg-btn"
                    onClick={() => {
                      setFormTitle("");
                      setFormUrl("");
                      setFormTags("");
                      setFormSummary("");
                      setFormContent("");
                    }}
                    disabled={saving}
                  >
                    Limpar
                  </button>
                </div>
              </form>

              <section className="knowledge-card knowledge-list">
                <div className="knowledge-card-head">
                  <div className="knowledge-card-title">Dataset Catalogado</div>
                  <div className="knowledge-card-desc">Busca interna usada pelo DeepSearch + Think antes da web.</div>
                </div>

                <div className="knowledge-list-toolbar">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar por titulo, tag ou conteudo..."
                    aria-label="Buscar no dataset"
                  />
                  <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as KnowledgeType | "")}>
                    <option value="">Todos os tipos</option>
                    {KNOWLEDGE_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="seg-btn" onClick={() => void loadItems()} disabled={itemsLoading}>
                    {itemsLoading ? "..." : "Atualizar"}
                  </button>
                </div>

                <div className="knowledge-list-meta">
                  {itemsLoading ? "Carregando..." : `${totalItems} item(ns) encontrado(s)`}
                </div>

                <div className="knowledge-list-scroller">
                  {items.length === 0 ? (
                    <div className="knowledge-empty">Sem itens nesta filtragem.</div>
                  ) : (
                    items.map((item) => (
                      <article key={item.id} className="knowledge-item">
                        <div className="knowledge-item-head">
                          <div className="knowledge-item-title-wrap">
                            <span className="knowledge-item-type">{item.type}</span>
                            <h4 className="knowledge-item-title" title={item.title}>
                              {item.title}
                            </h4>
                          </div>
                          <button type="button" className="icon-btn mini danger" onClick={() => void deleteItem(item.id)} aria-label="Excluir item">
                            <XIcon />
                          </button>
                        </div>

                        <p className="knowledge-item-summary">
                          {(item.summary || item.content || "").slice(0, 220) || "Sem resumo."}
                        </p>

                        {item.url ? (
                          <a className="knowledge-item-link" href={item.url} target="_blank" rel="noreferrer">
                            {item.url}
                          </a>
                        ) : null}

                        {Array.isArray(item.tags) && item.tags.length > 0 ? (
                          <div className="knowledge-item-tags">
                            {item.tags.slice(0, 6).map((tag) => (
                              <span key={tag} className="knowledge-tag">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}

                        <div className="knowledge-item-foot">Atualizado em {formatTimestamp(item.updatedAt)}</div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

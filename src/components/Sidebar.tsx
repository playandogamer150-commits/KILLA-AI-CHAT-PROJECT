import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatThread } from "../types";

type SidebarProps = {
  open: boolean;
  threads: ChatThread[];
  activeId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onNewMediaChat: () => void;
  onRename: (id: string, title: string) => void;
  onToggleArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
};

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 4h6m-8 4h10m-9 0 1 13h6l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16v3H4V7Zm2 3v10h12V10" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 13h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-3L16.5 4a2 2 0 0 0-3 0L3 14.5V20Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 12.2a4.2 4.2 0 1 0-4.2-4.2A4.2 4.2 0 0 0 12 12.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M4.8 20a7.2 7.2 0 0 1 14.4 0"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15.3a3.3 3.3 0 1 0-3.3-3.3 3.3 3.3 0 0 0 3.3 3.3Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M19.3 12a7.3 7.3 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7.5 7.5 0 0 0-1.7-1L14.8 3H9.2L8.9 6a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.3 7.3 0 0 0-.1 1 7.3 7.3 0 0 0 .1 1l-2 1.5 2 3.5 2.4-1a7.5 7.5 0 0 0 1.7 1l.3 3h5.6l.3-3a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7.3 7.3 0 0 0 .1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M11 12h-7m0 0 3-3m-3 3 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Sidebar({
  open,
  threads,
  activeId,
  onClose,
  onSelect,
  onNewChat,
  onNewMediaChat,
  onRename,
  onToggleArchive,
  onDelete,
  onOpenProfile,
  onOpenSettings,
  onLogout,
}: SidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const newWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!newOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      const el = newWrapRef.current;
      const target = e.target as Node | null;
      if (!el) return;
      if (target && el.contains(target)) return;
      setNewOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [newOpen]);

  const visibleChat = useMemo(
    () => {
      const q = query.trim().toLowerCase();
      return threads
        .filter((t) => !t.archived && (t.kind ?? "chat") !== "media")
        .filter((t) => (q ? `${t.title}`.toLowerCase().includes(q) : true))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    [threads, query]
  );
  const visibleMedia = useMemo(
    () => {
      const q = query.trim().toLowerCase();
      return threads
        .filter((t) => !t.archived && (t.kind ?? "chat") === "media")
        .filter((t) => (q ? `${t.title}`.toLowerCase().includes(q) : true))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    [threads, query]
  );
  const archived = useMemo(
    () => threads.filter((t) => t.archived).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    [threads]
  );

  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Menu" aria-hidden={!open}>
        <div className="sidebar-head">
          <div className="sidebar-title">Chats</div>
          <button type="button" className="icon-btn sidebar-close" onClick={onClose} aria-label="Close sidebar">
            <XIcon />
          </button>
        </div>

        <div className="sidebar-actions">
          <input
            className="sidebar-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar chats..."
            aria-label="Search chats"
          />

          <div ref={newWrapRef} className={`sidebar-new ${newOpen ? "open" : ""}`}>
            <button type="button" className="new-chat-btn" onClick={() => setNewOpen((v) => !v)} aria-haspopup="menu">
              + Novo
            </button>

            {newOpen ? (
              <div className="sidebar-pop" role="menu" aria-label="Novo chat">
                <button
                  type="button"
                  className="sidebar-pop-item"
                  role="menuitem"
                  onClick={() => {
                    setNewOpen(false);
                    onNewChat();
                  }}
                >
                  <div className="sidebar-pop-title">Novo chat</div>
                  <div className="sidebar-pop-sub">Texto (Puter)</div>
                </button>
                <button
                  type="button"
                  className="sidebar-pop-item"
                  role="menuitem"
                  onClick={() => {
                    setNewOpen(false);
                    onNewMediaChat();
                  }}
                >
                  <div className="sidebar-pop-title">Novo midia</div>
                  <div className="sidebar-pop-sub">Imagem / video</div>
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-subtitle">Chat</div>
          {visibleChat.length === 0 ? <div className="sidebar-empty">Nenhum chat de texto ainda.</div> : null}
          {visibleChat.map((t) => {
            const isActive = t.id === activeId;
            const isRenaming = renamingId === t.id;

            return (
              <div key={t.id} className={`chat-item ${isActive ? "active" : ""}`}>
                <button type="button" className="chat-item-main" onClick={() => onSelect(t.id)}>
                  {isRenaming ? (
                    <input
                      className="chat-rename-input"
                      value={renameDraft}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const next = renameDraft.trim();
                          if (next) onRename(t.id, next);
                          setRenamingId(null);
                        }
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => setRenamingId(null)}
                    />
                  ) : (
                    <span className="chat-item-title" title={t.title}>
                      {t.title}
                    </span>
                  )}
                </button>

                <div className="chat-item-actions" aria-label="Chat actions">
                  <button
                    type="button"
                    className="icon-btn mini"
                    aria-label="Rename chat"
                    onClick={() => {
                      setRenamingId(t.id);
                      setRenameDraft(t.title);
                    }}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn mini"
                    aria-label="Archive chat"
                    onClick={() => onToggleArchive(t.id)}
                  >
                    <ArchiveIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn mini danger"
                    aria-label="Delete chat"
                    onClick={() => onDelete(t.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-subtitle">Midia</div>
          {visibleMedia.length === 0 ? <div className="sidebar-empty">Nenhum chat de midia ainda.</div> : null}
          {visibleMedia.map((t) => {
            const isActive = t.id === activeId;
            const isRenaming = renamingId === t.id;

            return (
              <div key={t.id} className={`chat-item ${isActive ? "active" : ""}`}>
                <button type="button" className="chat-item-main" onClick={() => onSelect(t.id)}>
                  {isRenaming ? (
                    <input
                      className="chat-rename-input"
                      value={renameDraft}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const next = renameDraft.trim();
                          if (next) onRename(t.id, next);
                          setRenamingId(null);
                        }
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => setRenamingId(null)}
                    />
                  ) : (
                    <span className="chat-item-title" title={t.title}>
                      {t.title}
                    </span>
                  )}
                </button>

                <div className="chat-item-actions" aria-label="Chat actions">
                  <button
                    type="button"
                    className="icon-btn mini"
                    aria-label="Rename chat"
                    onClick={() => {
                      setRenamingId(t.id);
                      setRenameDraft(t.title);
                    }}
                  >
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn mini"
                    aria-label="Archive chat"
                    onClick={() => onToggleArchive(t.id)}
                  >
                    <ArchiveIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn mini danger"
                    aria-label="Delete chat"
                    onClick={() => onDelete(t.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {archived.length > 0 ? (
          <div className="sidebar-section">
            <div className="sidebar-subtitle">Archived</div>
            {archived.map((t) => (
              <div key={t.id} className={`chat-item ${t.id === activeId ? "active" : ""}`}>
                <button type="button" className="chat-item-main" onClick={() => onSelect(t.id)}>
                  <span className="chat-item-title" title={t.title}>
                    {t.title}
                  </span>
                </button>
                <div className="chat-item-actions" aria-label="Chat actions">
                  <button
                    type="button"
                    className="icon-btn mini"
                    aria-label="Unarchive chat"
                    onClick={() => onToggleArchive(t.id)}
                  >
                    <ArchiveIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-btn mini danger"
                    aria-label="Delete chat"
                    onClick={() => onDelete(t.id)}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="sidebar-footer">
          <div className="sidebar-subtitle">Conta</div>

          <button type="button" className="sidebar-nav-btn" onClick={onOpenProfile}>
            <span className="sidebar-nav-ic" aria-hidden="true">
              <UserIcon />
            </span>
            Perfil
          </button>

          <button type="button" className="sidebar-nav-btn" onClick={onOpenSettings}>
            <span className="sidebar-nav-ic" aria-hidden="true">
              <GearIcon />
            </span>
            Configuracoes
          </button>

          <button type="button" className="sidebar-nav-btn danger" onClick={onLogout}>
            <span className="sidebar-nav-ic" aria-hidden="true">
              <LogoutIcon />
            </span>
            Sair
          </button>
        </div>
      </aside>

      <button
        type="button"
        className={`sidebar-backdrop ${open ? "open" : ""}`}
        aria-label="Close chats overlay"
        onClick={onClose}
      />
    </>
  );
}

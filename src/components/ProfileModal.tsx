import { useEffect, useMemo } from "react";
import { UserProfile } from "@clerk/clerk-react";

type ProfileModalProps = {
  open: boolean;
  onClose: () => void;
};

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function ProfileModal({ open, onClose }: ProfileModalProps) {
  const appearance: any = useMemo(
    () => ({
      variables: {
        colorPrimary: "#ffffff",
        colorText: "#f4f4f4",
        colorTextSecondary: "rgba(255,255,255,0.72)",
        colorBackground: "transparent",
        colorInputBackground: "rgba(255,255,255,0.06)",
        colorInputText: "#ffffff",
        borderRadius: "16px",
      },
      elements: {
        card: { backgroundColor: "transparent", boxShadow: "none", border: "0" },
      },
    }),
    []
  );

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
    <div className="profile-backdrop" role="presentation" onClick={onClose}>
      <div className="profile-panel" role="dialog" aria-modal="true" aria-label="Perfil" onClick={(e) => e.stopPropagation()}>
        <div className="profile-header">
          <div className="profile-title">Perfil</div>
          <button type="button" className="icon-btn mini" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="profile-body">
          <UserProfile appearance={appearance} />
        </div>
      </div>
    </div>
  );
}

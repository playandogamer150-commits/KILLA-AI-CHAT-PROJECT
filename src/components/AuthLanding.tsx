import { useMemo, useState } from "react";
import { SignIn, SignUp } from "@clerk/clerk-react";
import heroUrl from "../assets/killa-auth-hero.svg";
import logoUrl from "../assets/killa-logo.svg";

type AuthMode = "signup" | "signin";

export default function AuthLanding() {
  const [mode, setMode] = useState<AuthMode>("signup");

  // Keep this as `any` so we can safely style Clerk without fighting exact element key typings.
  const appearance: any = useMemo(
    () => ({
      variables: {
        colorPrimary: "#ffffff",
        colorText: "#f4f4f4",
        colorTextSecondary: "rgba(255,255,255,0.68)",
        colorBackground: "transparent",
        colorInputBackground: "rgba(255,255,255,0.06)",
        colorInputText: "#f4f4f4",
        borderRadius: "16px",
      },
      elements: {
        rootBox: {
          width: "100%",
        },
        cardBox: {
          backgroundColor: "transparent",
          boxShadow: "none",
          border: "0",
          padding: 0,
          width: "100%",
        },
        card: {
          backgroundColor: "transparent",
          boxShadow: "none",
          border: "0",
          padding: 0,
          width: "100%",
        },
        headerTitle: { display: "none" },
        headerSubtitle: { display: "none" },
        footer: { display: "none" },
        dividerLine: { backgroundColor: "rgba(255,255,255,0.22)" },
        dividerText: { color: "rgba(255,255,255,0.74)" },
        socialButtonsRoot: { width: "100%" },
        socialButtons: { width: "100%" },
        // Some Clerk layouts render social providers as icon-only buttons.
        // Make them readable on dark backgrounds (GitHub can be black-on-black by default).
        socialButtonsIconButton: {
          border: "1px solid rgba(255,255,255,0.24)",
          backgroundColor: "rgba(255,255,255,0.06)",
          borderRadius: "14px",
        },
        socialButtonsBlockButton: {
          border: "1px solid rgba(255,255,255,0.24)",
          backgroundColor: "rgba(255,255,255,0.06)",
          color: "#f4f4f4",
          borderRadius: "14px",
        },
        socialButtonsBlockButtonText: {
          color: "#ffffff",
          fontWeight: 600,
        },
        socialButtonsProviderIcon: {
          color: "#ffffff",
          opacity: 0.92,
        },
        formFieldLabel: { color: "rgba(255,255,255,0.78)" },
        formFieldInput: {
          backgroundColor: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.18)",
          color: "#ffffff",
          borderRadius: "14px",
        },
        formButtonPrimary: {
          backgroundColor: "#ffffff",
          color: "#000000",
          borderRadius: "14px",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 18px 45px rgba(0,0,0,0.35)",
          fontWeight: 700,
        },
        formButtonPrimary__loading: {
          backgroundColor: "rgba(255,255,255,0.92)",
          color: "#000000",
        },
        formFieldInputShowPasswordButton: { color: "rgba(255,255,255,0.75)" },
      },
    }),
    []
  );

  return (
    <div className="auth-landing">
      <div className="auth-landing-frame" role="region" aria-label="KILLA AI Auth">
        <section className="auth-hero" aria-label="KILLA AI hero">
          <div className="auth-hero-img" style={{ backgroundImage: `url(${heroUrl})` }} aria-hidden="true" />
          <div className="auth-hero-overlay" aria-hidden="true" />

          <div className="auth-hero-top">
            <div className="auth-hero-badge">
              <span className="auth-hero-dot" aria-hidden="true" />
              KILLA AI
            </div>
          </div>

          <div className="auth-hero-bottom">
            <div className="auth-hero-kicker">KILLA AI CHAT</div>
            <h1 className="auth-hero-headline">
              Uma IA premium,
              <br />
              do seu jeito.
            </h1>
            <p className="auth-hero-copy">
              Converse, pesquise e crie midias em chats separados para manter contexto limpo e custo baixo.
            </p>
          </div>
        </section>

        <section className="auth-panel" aria-label="Login ou cadastro">
          <div className="auth-panel-head">
            <div className="auth-panel-brand">
              <img className="brand-logo" src={logoUrl} alt="" aria-hidden="true" />
              <div className="auth-panel-name">KILLA AI</div>
            </div>
            <div className="auth-panel-title">{mode === "signup" ? "Crie sua conta" : "Entre na sua conta"}</div>
            <div className="auth-panel-sub">
              {mode === "signup" ? "Comece em segundos. Sem complicacao." : "Bom te ver de volta."}
            </div>
          </div>

          <div className="auth-panel-body">
            {mode === "signup" ? (
              <SignUp routing="virtual" appearance={appearance} fallbackRedirectUrl="/" />
            ) : (
              <SignIn routing="virtual" appearance={appearance} fallbackRedirectUrl="/" />
            )}
          </div>

          <div className="auth-panel-foot">
            {mode === "signup" ? (
              <span>
                Ja tem uma conta?{" "}
                <button type="button" className="auth-link" onClick={() => setMode("signin")}>
                  Entrar
                </button>
              </span>
            ) : (
              <span>
                Nao tem conta?{" "}
                <button type="button" className="auth-link" onClick={() => setMode("signup")}>
                  Criar conta
                </button>
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

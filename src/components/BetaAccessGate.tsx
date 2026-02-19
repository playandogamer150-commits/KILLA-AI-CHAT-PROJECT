import { useMemo, useState } from "react";

type BetaActionCosts = Record<string, number>;

type BetaAccess = {
  licensed: boolean;
  plan_name: string;
  credits: number;
  early_access?: {
    title?: string;
    included_credits?: number;
    video_editing_enabled?: boolean;
    video_warning_badge?: string;
  };
  action_costs?: BetaActionCosts;
};

type BetaCheckout = {
  purchase_url?: string;
  support_email?: string;
  delivery_mode?: string;
};

type BetaAccessGateProps = {
  open: boolean;
  loading: boolean;
  redeeming: boolean;
  error: string;
  access: BetaAccess | null;
  checkout: BetaCheckout | null;
  onRedeem: (licenseKey: string) => Promise<void>;
};

const ACTION_LABELS: Array<{ key: keyof BetaActionCosts; label: string }> = [
  { key: "image_generate", label: "Gerar imagem" },
  { key: "image_edit", label: "Editar imagem" },
  { key: "text_basic", label: "Prompt texto" },
  { key: "text_think", label: "Texto + Think" },
  { key: "text_think_deepsearch", label: "Texto + Think + DeepSearch" },
  { key: "text_deepsearch", label: "Texto + DeepSearch" },
  { key: "video_generate", label: "Gerar video" },
];

export default function BetaAccessGate({
  open,
  loading,
  redeeming,
  error,
  access,
  checkout,
  onRedeem,
}: BetaAccessGateProps) {
  const [licenseKey, setLicenseKey] = useState("");
  const canSubmit = !loading && !redeeming && licenseKey.trim().length >= 8;

  const costs = useMemo(() => access?.action_costs || {}, [access?.action_costs]);
  if (!open) return null;

  const purchaseUrl = String(checkout?.purchase_url || "").trim();
  const supportEmail = String(checkout?.support_email || "").trim();
  const early = access?.early_access;

  return (
    <div className="beta-gate-backdrop" role="presentation">
      <div className="beta-gate-panel" role="dialog" aria-modal="true" aria-label="Acesso antecipado">
        <div className="beta-gate-head">
          <h2>Acesso Antecipado</h2>
          <p>Entre com sua chave de licenca para liberar o KILLA AI.</p>
        </div>

        <div className="beta-gate-kpis">
          <span className="beta-gate-chip">{early?.title || "Plano"} </span>
          <span className="beta-gate-chip">{`${early?.included_credits || 100} creditos iniciais`}</span>
          {early?.video_warning_badge ? <span className="beta-gate-chip warn">{early.video_warning_badge}</span> : null}
        </div>

        <div className="beta-gate-form">
          <label htmlFor="beta-license-key">Chave de licenca</label>
          <input
            id="beta-license-key"
            value={licenseKey}
            onChange={(event) => setLicenseKey(event.target.value.toUpperCase())}
            placeholder="KILLA-EA-XXXXXX-XXXXXX-XXXXXX"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="beta-gate-submit"
            disabled={!canSubmit}
            onClick={() => {
              void onRedeem(licenseKey.trim());
            }}
          >
            {redeeming ? "Validando..." : "Ativar chave"}
          </button>
          {error ? <div className="beta-gate-error">{error}</div> : null}
        </div>

        <div className="beta-gate-buybox">
          <p>Sem chave ainda? Compre o plano e receba manualmente por email.</p>
          <div className="beta-gate-actions">
            {purchaseUrl ? (
              <a className="beta-gate-link" href={purchaseUrl} target="_blank" rel="noreferrer">
                Comprar chave
              </a>
            ) : null}
            {supportEmail ? (
              <a className="beta-gate-link muted" href={`mailto:${supportEmail}`}>
                Receber chave por email
              </a>
            ) : null}
          </div>
          <small>
            Entrega atual: {checkout?.delivery_mode === "manual_email" ? "manual por email" : "manual"}.
          </small>
        </div>

        <div className="beta-gate-costs">
          <h3>Consumo de creditos</h3>
          <ul>
            {ACTION_LABELS.map((item) => (
              <li key={item.key}>
                <span>{item.label}</span>
                <strong>{`${Number(costs[item.key] || 0)} credito(s)`}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}


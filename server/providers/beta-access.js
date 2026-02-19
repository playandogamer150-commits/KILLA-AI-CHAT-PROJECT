import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const STORE_FILE = path.join(DATA_DIR, "beta-access-store.json");

const PLAN_ID = "early_access";
const PLAN_NAME = "Acesso Antecipado";
const PLAN_START_CREDITS = 100;

const ACTION_COSTS = Object.freeze({
  text_basic: 1,
  text_think: 1,
  text_deepsearch: 5,
  text_think_deepsearch: 3,
  image_generate: 1,
  image_edit: 2,
  video_generate: 10,
});

export class BetaAccessError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "BetaAccessError";
    this.code = String(code || "BETA_ERROR");
    this.status = Number(status) || 400;
  }
}

function nowTs() {
  return Date.now();
}

function normalizeKey(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function maskKey(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return "";
  if (normalized.length <= 8) return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
  return `${normalized.slice(0, 6)}***${normalized.slice(-4)}`;
}

function createLicenseKey() {
  const block = () => randomBytes(3).toString("hex").toUpperCase();
  return `KILLA-EA-${block()}-${block()}-${block()}`;
}

function normalizeStore(raw) {
  const base = raw && typeof raw === "object" ? raw : {};
  const keys = Array.isArray(base.keys) ? base.keys : [];
  const users = Array.isArray(base.users) ? base.users : [];
  const ledger = Array.isArray(base.ledger) ? base.ledger : [];

  return {
    version: 1,
    updatedAt: Number(base.updatedAt) || nowTs(),
    keys: keys
      .map((item) => ({
        id: String(item?.id || randomUUID()),
        key: normalizeKey(item?.key),
        planId: String(item?.planId || PLAN_ID),
        credits: Math.max(0, Number(item?.credits) || PLAN_START_CREDITS),
        status: String(item?.status || "available"),
        createdAt: Number(item?.createdAt) || nowTs(),
        redeemedAt: Number(item?.redeemedAt) || 0,
        redeemedBy: String(item?.redeemedBy || ""),
        notes: String(item?.notes || ""),
      }))
      .filter((item) => item.key),
    users: users
      .map((item) => ({
        userId: String(item?.userId || "").trim(),
        licensed: Boolean(item?.licensed),
        planId: String(item?.planId || PLAN_ID),
        credits: Math.max(0, Number(item?.credits) || 0),
        totalGranted: Math.max(0, Number(item?.totalGranted) || 0),
        totalSpent: Math.max(0, Number(item?.totalSpent) || 0),
        licenseKey: normalizeKey(item?.licenseKey),
        createdAt: Number(item?.createdAt) || nowTs(),
        updatedAt: Number(item?.updatedAt) || nowTs(),
      }))
      .filter((item) => item.userId),
    ledger: ledger
      .map((entry) => ({
        id: String(entry?.id || randomUUID()),
        type: String(entry?.type || "charge"),
        userId: String(entry?.userId || "").trim(),
        action: String(entry?.action || ""),
        credits: Math.max(0, Number(entry?.credits) || 0),
        operationId: String(entry?.operationId || ""),
        chargeId: String(entry?.chargeId || ""),
        note: String(entry?.note || ""),
        createdAt: Number(entry?.createdAt) || nowTs(),
      }))
      .filter((entry) => entry.userId),
  };
}

async function readStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : "";
    if (code !== "ENOENT") throw error;
    const empty = normalizeStore({ keys: [], users: [], ledger: [] });
    await writeStore(empty);
    return empty;
  }
}

async function writeStore(nextStore) {
  const snapshot = normalizeStore({ ...nextStore, updatedAt: nowTs() });
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = path.join(DATA_DIR, `beta-access.${nowTs()}.${Math.random().toString(16).slice(2)}.tmp`);
  await fs.writeFile(tempFile, JSON.stringify(snapshot, null, 2), "utf8");
  await fs.rename(tempFile, STORE_FILE);
  return snapshot;
}

let mutationQueue = Promise.resolve();

async function mutateStore(mutator) {
  const run = mutationQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    const nextStore = await writeStore(store);
    return { result, store: nextStore };
  });
  mutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  const { result, store } = await run;
  return { result, store };
}

function getUserRecord(store, userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  return store.users.find((user) => user.userId === id) || null;
}

function ensureUserRecord(store, userId) {
  const id = String(userId || "").trim();
  if (!id) {
    throw new BetaAccessError("UNAUTHORIZED", "User not authenticated.", 401);
  }

  const existing = getUserRecord(store, id);
  if (existing) return existing;

  const created = {
    userId: id,
    licensed: false,
    planId: PLAN_ID,
    credits: 0,
    totalGranted: 0,
    totalSpent: 0,
    licenseKey: "",
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  store.users.push(created);
  return created;
}

function getActionCost(action) {
  const key = String(action || "").trim();
  if (!Object.prototype.hasOwnProperty.call(ACTION_COSTS, key)) {
    throw new BetaAccessError("UNKNOWN_ACTION", "Acao de credito invalida.", 400);
  }
  return ACTION_COSTS[key];
}

function buildAccessSummary(user) {
  const record = user || {
    userId: "",
    licensed: false,
    planId: PLAN_ID,
    credits: 0,
    totalGranted: 0,
    totalSpent: 0,
    licenseKey: "",
  };

  return {
    licensed: Boolean(record.licensed),
    plan_id: record.planId || PLAN_ID,
    plan_name: PLAN_NAME,
    credits: Math.max(0, Number(record.credits) || 0),
    total_granted: Math.max(0, Number(record.totalGranted) || 0),
    total_spent: Math.max(0, Number(record.totalSpent) || 0),
    license_key_masked: record.licenseKey ? maskKey(record.licenseKey) : "",
    early_access: {
      enabled: true,
      title: "Acesso Antecipado",
      included_credits: PLAN_START_CREDITS,
      video_editing_enabled: false,
      video_warning_badge: "Video em manutencao (beta)",
    },
    action_costs: { ...ACTION_COSTS },
  };
}

export function getBetaPublicCheckoutConfig() {
  const purchaseUrl = String(process.env.BETA_EARLY_ACCESS_CHECKOUT_URL || "").trim();
  const supportEmail = String(process.env.BETA_SUPPORT_EMAIL || "").trim();

  return {
    purchase_url: purchaseUrl,
    support_email: supportEmail,
    delivery_mode: "manual_email",
    plan_id: PLAN_ID,
    plan_name: PLAN_NAME,
    initial_credits: PLAN_START_CREDITS,
  };
}

export async function getBetaAccessForUser(userId) {
  const store = await readStore();
  const user = getUserRecord(store, userId);
  return buildAccessSummary(user);
}

export async function redeemBetaLicenseForUser(userId, licenseKey) {
  const normalizedKey = normalizeKey(licenseKey);
  if (!normalizedKey) {
    throw new BetaAccessError("KEY_REQUIRED", "Informe uma chave de licenca valida.", 400);
  }

  const { result } = await mutateStore(async (store) => {
    const user = ensureUserRecord(store, userId);
    if (user.licensed) {
      throw new BetaAccessError("ALREADY_LICENSED", "Sua conta ja possui uma licenca ativa.", 409);
    }

    const key = store.keys.find((item) => item.key === normalizedKey);
    if (!key) {
      throw new BetaAccessError("INVALID_KEY", "Chave de licenca invalida.", 404);
    }
    if (key.status !== "available") {
      throw new BetaAccessError("KEY_ALREADY_USED", "Esta chave ja foi utilizada.", 409);
    }

    key.status = "redeemed";
    key.redeemedAt = nowTs();
    key.redeemedBy = user.userId;

    const grantCredits = Math.max(0, Number(key.credits) || PLAN_START_CREDITS);
    user.licensed = true;
    user.planId = key.planId || PLAN_ID;
    user.licenseKey = key.key;
    user.credits = Math.max(0, Number(user.credits) || 0) + grantCredits;
    user.totalGranted = Math.max(0, Number(user.totalGranted) || 0) + grantCredits;
    user.updatedAt = nowTs();

    store.ledger.push({
      id: randomUUID(),
      type: "redeem",
      userId: user.userId,
      action: "license_redeem",
      credits: 0,
      operationId: "",
      chargeId: "",
      note: `Key ${maskKey(key.key)} redeemed`,
      createdAt: nowTs(),
    });
    store.ledger.push({
      id: randomUUID(),
      type: "grant",
      userId: user.userId,
      action: "credits_grant",
      credits: grantCredits,
      operationId: "",
      chargeId: "",
      note: `Initial credits for ${PLAN_NAME}`,
      createdAt: nowTs(),
    });

    return {
      access: buildAccessSummary(user),
      redeemed_key_masked: maskKey(key.key),
    };
  });

  return result;
}

export async function chargeBetaCreditsForUser(userId, { action, operationId, note }) {
  const opId = String(operationId || "").trim();
  const actionName = String(action || "").trim();
  const cost = getActionCost(actionName);

  const { result } = await mutateStore(async (store) => {
    const user = ensureUserRecord(store, userId);
    if (!user.licensed) {
      throw new BetaAccessError("LICENSE_REQUIRED", "Ative sua chave de licenca para usar o KILLA AI.", 403);
    }

    if (opId) {
      const duplicated = store.ledger.find(
        (entry) => entry.userId === user.userId && entry.type === "charge" && entry.operationId === opId && entry.action === actionName
      );
      if (duplicated) {
        return {
          charge_id: duplicated.id,
          charged_credits: duplicated.credits,
          duplicated: true,
          access: buildAccessSummary(user),
        };
      }
    }

    if (Number(user.credits) < cost) {
      throw new BetaAccessError(
        "INSUFFICIENT_CREDITS",
        `Creditos insuficientes. Necessario: ${cost}, disponivel: ${user.credits}.`,
        402
      );
    }

    user.credits -= cost;
    user.totalSpent = Math.max(0, Number(user.totalSpent) || 0) + cost;
    user.updatedAt = nowTs();

    const chargeEntry = {
      id: randomUUID(),
      type: "charge",
      userId: user.userId,
      action: actionName,
      credits: cost,
      operationId: opId,
      chargeId: "",
      note: String(note || ""),
      createdAt: nowTs(),
    };
    store.ledger.push(chargeEntry);

    return {
      charge_id: chargeEntry.id,
      charged_credits: cost,
      duplicated: false,
      access: buildAccessSummary(user),
    };
  });

  return result;
}

export async function refundBetaChargeForUser(userId, { chargeId, reason }) {
  const chargeRef = String(chargeId || "").trim();
  if (!chargeRef) {
    throw new BetaAccessError("CHARGE_ID_REQUIRED", "charge_id e obrigatorio.", 400);
  }

  const { result } = await mutateStore(async (store) => {
    const user = ensureUserRecord(store, userId);
    const chargeEntry = store.ledger.find(
      (entry) => entry.id === chargeRef && entry.userId === user.userId && entry.type === "charge"
    );
    if (!chargeEntry) {
      throw new BetaAccessError("CHARGE_NOT_FOUND", "Cobranca nao encontrada.", 404);
    }

    const alreadyRefunded = store.ledger.find(
      (entry) => entry.type === "refund" && entry.userId === user.userId && entry.chargeId === chargeEntry.id
    );
    if (alreadyRefunded) {
      return {
        refund_id: alreadyRefunded.id,
        refunded_credits: alreadyRefunded.credits,
        duplicated: true,
        access: buildAccessSummary(user),
      };
    }

    const creditsToRefund = Math.max(0, Number(chargeEntry.credits) || 0);
    user.credits = Math.max(0, Number(user.credits) || 0) + creditsToRefund;
    user.totalSpent = Math.max(0, Number(user.totalSpent) || 0) - creditsToRefund;
    if (user.totalSpent < 0) user.totalSpent = 0;
    user.updatedAt = nowTs();

    const refundEntry = {
      id: randomUUID(),
      type: "refund",
      userId: user.userId,
      action: chargeEntry.action,
      credits: creditsToRefund,
      operationId: chargeEntry.operationId,
      chargeId: chargeEntry.id,
      note: String(reason || ""),
      createdAt: nowTs(),
    };
    store.ledger.push(refundEntry);

    return {
      refund_id: refundEntry.id,
      refunded_credits: creditsToRefund,
      duplicated: false,
      access: buildAccessSummary(user),
    };
  });

  return result;
}

export async function generateBetaLicenseKeys({ quantity = 1, notes = "" } = {}) {
  const qty = Math.min(Math.max(Number(quantity) || 1, 1), 500);
  const { result } = await mutateStore(async (store) => {
    const created = [];
    const existing = new Set(store.keys.map((item) => item.key));

    for (let i = 0; i < qty; i++) {
      let key = "";
      do {
        key = createLicenseKey();
      } while (existing.has(key));
      existing.add(key);

      const item = {
        id: randomUUID(),
        key,
        planId: PLAN_ID,
        credits: PLAN_START_CREDITS,
        status: "available",
        createdAt: nowTs(),
        redeemedAt: 0,
        redeemedBy: "",
        notes: String(notes || ""),
      };
      created.push(item);
      store.keys.push(item);
    }

    return {
      created: created.map((item) => ({
        id: item.id,
        key: item.key,
        credits: item.credits,
        status: item.status,
        created_at: item.createdAt,
      })),
    };
  });

  return result;
}

export async function listBetaLicenseKeys({ status = "", limit = 120 } = {}) {
  const store = await readStore();
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const max = Math.min(Math.max(Number(limit) || 120, 1), 500);
  const keys = store.keys
    .filter((item) => {
      if (!normalizedStatus) return true;
      return String(item.status || "").toLowerCase() === normalizedStatus;
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max)
    .map((item) => ({
      id: item.id,
      key: item.key,
      key_masked: maskKey(item.key),
      status: item.status,
      credits: item.credits,
      created_at: item.createdAt,
      redeemed_at: item.redeemedAt || null,
      redeemed_by: item.redeemedBy || "",
      notes: item.notes || "",
    }));

  return {
    total: keys.length,
    keys,
  };
}


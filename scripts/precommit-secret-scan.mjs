import { execFileSync } from "node:child_process";

const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.env$/i,
  /(^|\/)server\/data\//i,
  /(^|\/)killa-license-/i,
  /(^|\/)beta-access-store\.json$/i,
  /(^|\/).*\.pem$/i,
  /(^|\/).*\.key$/i,
  /(^|\/)id_rsa(\.pub)?$/i,
  /(^|\/)id_ed25519(\.pub)?$/i,
];

const RAW_SECRET_PATTERNS = [
  { label: "KILLA license key", regex: /KILLA-EA-[A-F0-9]{6}-[A-F0-9]{6}-[A-F0-9]{6}/g },
  { label: "OpenAI key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { label: "GitHub token", regex: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { label: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: "Google API key", regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { label: "Authorization Bearer token", regex: /Authorization:\s*Bearer\s+[A-Za-z0-9._\-]{20,}/gi },
];

const ENV_SECRET_KEYS = new Set([
  "MODELSLAB_API_KEY",
  "REPLICATE_API_TOKEN",
  "XAI_API_KEY",
  "SERPAPI_API_KEY",
  "CLERK_SECRET_KEY",
  "OPENAI_API_KEY",
  "BETA_ADMIN_USER_IDS",
]);

const SAFE_ENV_VALUE_PATTERNS = [
  /^$/,
  /^YOUR_/i,
  /^REPLACE/i,
  /^CHANGE_ME$/i,
  /^CHANGEME$/i,
  /^<.*>$/,
];

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function getStagedFiles() {
  const out = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]);
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getStagedContent(filePath) {
  try {
    return runGit(["show", `:${filePath}`]);
  } catch {
    return "";
  }
}

function isBinaryLikely(content) {
  return content.includes("\u0000");
}

function scanEnvAssignments(filePath, content, findings) {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    const rawValue = String(match[2] || "").trim();
    if (!ENV_SECRET_KEYS.has(key)) continue;

    const safe = SAFE_ENV_VALUE_PATTERNS.some((pattern) => pattern.test(rawValue));
    if (safe) continue;

    findings.push(`${filePath}:${i + 1} -> ${key} parece conter valor real`);
  }
}

function scanRawPatterns(filePath, content, findings) {
  for (const pattern of RAW_SECRET_PATTERNS) {
    const matches = content.match(pattern.regex);
    if (!matches || matches.length === 0) continue;
    findings.push(`${filePath} -> ${pattern.label} (${matches.length} ocorrência(s))`);
  }
}

function main() {
  const stagedFiles = getStagedFiles();
  if (stagedFiles.length === 0) process.exit(0);

  const findings = [];

  for (const filePath of stagedFiles) {
    const normalized = filePath.replace(/\\/g, "/");
    const blockedPath = SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
    if (blockedPath) {
      findings.push(`${filePath} -> caminho sensível bloqueado`);
      continue;
    }

    const content = getStagedContent(filePath);
    if (!content || isBinaryLikely(content)) continue;

    scanEnvAssignments(filePath, content, findings);
    scanRawPatterns(filePath, content, findings);
  }

  if (findings.length > 0) {
    console.error("Segredos potenciais detectados nos arquivos staged:");
    for (const item of findings) console.error(`- ${item}`);
    process.exit(1);
  }
}

main();

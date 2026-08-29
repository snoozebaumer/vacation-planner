import crypto from "crypto";

const SCRYPT_KEYLEN = 64;

// OWASP-current recommended cost parameters for interactive-login password
// hashing: N=2^17 costs ~128MB of memory per hash, specifically to resist
// GPU/ASIC-parallelized cracking — scrypt's whole point is that this memory
// cost can't be traded away for less time the way a plain iterated hash
// can. Embedded in the stored hash itself (the way bcrypt embeds its own
// cost factor) so these can be raised again later without invalidating
// anyone's already-set password.
const CURRENT_PARAMS = { N: 131072, r: 8, p: 1 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024; // scrypt needs ~128*N*r bytes; headroom above that

// Unlock tokens are signed, not stored server-side — no session table needed.
// The frontend keeps them in sessionStorage (cleared when the browser tab
// closes, matching "only ask once per session"); this TTL is just a backstop
// limiting how long a copied-out token would keep working if extracted and
// reused outside the browser, generous enough to cover one long sitting.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.VACATION_UNLOCK_SECRET;
  if (!secret) throw new Error("VACATION_UNLOCK_SECRET is not set");
  return secret;
}

function scrypt(password: string, salt: string, params: { N: number; r: number; p: number }): Buffer {
  return crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { ...params, maxmem: SCRYPT_MAXMEM });
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const { N, r, p } = CURRENT_PARAMS;
  const hash = scrypt(password, salt, CURRENT_PARAMS).toString("hex");
  return `scrypt:${N}:${r}:${p}:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, salt, hashHex] = parts;
  const params = { N: Number(nStr), r: Number(rStr), p: Number(pStr) };
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) return false;
  if (!salt || !hashHex) return false;

  const candidate = scrypt(password, salt, params);
  const expected = Buffer.from(hashHex, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function signUnlockToken(vacationId: string): string {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${vacationId}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifyUnlockToken(token: string, vacationId: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return false;
    const [tokenVacationId, expiresAtStr, sig] = parts;
    if (tokenVacationId !== vacationId) return false;

    const expiresAt = Number(expiresAtStr);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

    const expected = crypto.createHmac("sha256", getSecret()).update(`${tokenVacationId}.${expiresAtStr}`).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

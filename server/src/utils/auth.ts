import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);

export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const item of header.split(';')) {
    const [key, ...rest] = item.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(rest.join('=')); } catch { return undefined; }
    }
  }
  return undefined;
}

const ephemeralSessionSecret = randomBytes(32);
export function sessionSecret() {
  return process.env.SESSION_SECRET || ephemeralSessionSecret;
}

export function signAdminSession(email: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ email, expiresAt: now + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAdminSession(token: string | undefined, now = Date.now()) {
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', sessionSecret()).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: unknown; expiresAt?: unknown };
    if (typeof value.email !== 'string' || typeof value.expiresAt !== 'number' || value.expiresAt <= now) return null;
    return value.email;
  } catch { return null; }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string | undefined) {
  if (!encoded) return false;
  const [algorithm, salt, hex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !/^[0-9a-f]{128}$/i.test(hex ?? '')) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

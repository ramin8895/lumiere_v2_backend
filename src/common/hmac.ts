import { createHmac, timingSafeEqual } from 'crypto';

/** Same scheme as NexCart's LumiereService: HMAC-SHA256 over `${ts}.${METHOD}.${pathWithQuery}` */
export const MAX_SKEW_MS = 5 * 60 * 1000;

export function signRequest(secret: string, timestamp: string, method: string, pathWithQuery: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${method.toUpperCase()}.${pathWithQuery}`).digest('hex');
}

export function verifyRequest(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  method: string,
  pathWithQuery: string,
  now = Date.now(),
): boolean {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(signRequest(secret, timestamp, method, pathWithQuery), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

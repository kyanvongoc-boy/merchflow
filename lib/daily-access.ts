import { env } from 'cloudflare:workers';

// User identity headers are trusted only behind the authenticated Sites gateway.
// Unattended callers must additionally present a deployment-specific secret.
export async function dailyAccessAllowed(req: Request): Promise<boolean> {
  if (req.headers.get('oai-authenticated-user-id')) return true;
  const expected = String((env as any).DAILY_WORKER_SECRET || '');
  const authorization = req.headers.get('Authorization') || '';
  if (expected.length < 32 || !authorization.startsWith('Bearer ')) return false;
  const provided = authorization.slice(7);
  if (provided.length > 4096) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([expected, provided].map(value =>
    crypto.subtle.digest('SHA-256', encode.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

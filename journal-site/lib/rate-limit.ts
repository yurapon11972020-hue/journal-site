const attempts = new Map<string, { count: number; until: number }>();
export function withinRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  for (const [stored, entry] of attempts) if (entry.until <= now) attempts.delete(stored);
  const entry = attempts.get(key) ?? { count: 0, until: now + windowMs };
  if (!attempts.has(key) && attempts.size >= 5000) return false;
  entry.count += 1;
  attempts.set(key, entry);
  return entry.count <= limit;
}

export function requestOrigin(request: Request): string {
  const configured = process.env.PUBLIC_SITE_URL?.trim();
  if (configured) return new URL(configured).origin;
  const url = new URL(request.url);
  // Next may use its internal hostname in Request.url. Host is browser-controlled by the destination,
  // unlike x-forwarded-host, which must never choose redirect or webhook targets here.
  const host = request.headers.get('host');
  return host && /^[a-zA-Z0-9.:[\]-]+$/.test(host) ? url.protocol + '//' + host : url.origin;
}

export function isSameOrigin(request: Request): boolean {
  return request.headers.get('origin') === requestOrigin(request);
}

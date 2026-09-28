export const DEFAULT_WINDOW_TITLE = 'Offline POS';

export function resolveWindowBrand({ siteName, iconUrl, logoUrl, serverOrigin } = {}) {
  const title = String(siteName || '').trim() || DEFAULT_WINDOW_TITLE;
  const imageUrl = iconUrl || logoUrl;
  if (!imageUrl) return { title, logoUrl: null };

  try {
    const url = new URL(String(imageUrl), serverOrigin);
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    return {
      title,
      logoUrl: url.protocol === 'https:' || (loopback && url.protocol === 'http:') ? url.href : null,
    };
  } catch {
    return { title, logoUrl: null };
  }
}

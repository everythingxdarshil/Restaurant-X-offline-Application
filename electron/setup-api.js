export function normalizeServerOrigin(value) {
  let url;
  try { url = new URL(String(value).trim()); }
  catch { throw new Error('Enter a valid server URL.'); }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Server URL must use HTTPS.');
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Server URL must contain only the server origin.');
  }
  return url.origin;
}

export class SetupApi {
  constructor(fetchImpl) {
    this.fetch = fetchImpl;
    this.origin = null;
    this.tenantCode = null;
    this.tenant = null;
    this.setupToken = null;
    this.challengeToken = null;
  }

  connect(serverUrl) {
    this.origin = normalizeServerOrigin(serverUrl);
  }

  async discover(serverUrl, tenantCode = '', locationId = null) {
    this.connect(serverUrl);
    const query = new URLSearchParams();
    if (tenantCode.trim()) query.set('tenant', tenantCode.trim());
    if (locationId) query.set('location_id', String(locationId));
    const result = await this.request(`/api/v1/desktop/discovery${query.size ? `?${query}` : ''}`);
    this.tenantCode = result.tenant?.code ?? null;
    this.tenant = result.tenant ?? null;
    return result;
  }

  async login(login, password) {
    if (!this.tenantCode) throw new Error('Resolve a restaurant before signing in.');
    const result = await this.request('/api/v1/desktop/setup/login', {
      method: 'POST', body: { tenant: this.tenantCode, login, password },
    });
    this.setupToken = result.setup_token ?? null;
    this.challengeToken = result.challenge_token ?? null;
    return result;
  }

  activate(code, payload) {
    return this.request('/api/v1/desktop/setup/activate', {
      method: 'POST', body: { code: String(code).trim().toUpperCase(), ...payload },
    });
  }

  async verifyTwoFactor(code) {
    const result = await this.request('/api/v1/desktop/setup/verify-2fa', {
      method: 'POST', body: { challenge_token: this.challengeToken, code },
    });
    this.setupToken = result.setup_token;
    this.challengeToken = null;
    return result;
  }

  scopes() { return this.request('/api/v1/desktop/setup/scopes', { token: this.setupToken }); }
  register(payload) { return this.request('/api/v1/desktop/terminals', { method: 'POST', token: this.setupToken, body: payload }); }

  async request(path, { method = 'GET', token = null, body = null } = {}) {
    if (!this.origin) throw new Error('Server is not configured.');
    const response = await this.fetch(`${this.origin}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    const routeMissing = !result.message || /\broute\b.*\bnot found\b|\bcould not be found\b/i.test(result.message);
    if (response.status === 404 && path.startsWith('/api/v1/desktop/') && routeMissing) {
      throw new Error('Server does not have Offline POS desktop API. Deploy latest backend first.');
    }
    if (!response.ok) throw new Error(result.message || `Server returned HTTP ${response.status}.`);
    return result;
  }
}

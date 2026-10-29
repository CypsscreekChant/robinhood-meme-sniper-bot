import { createHash } from 'node:crypto';

type Credentials = { appKey?: string; appSecret?: string; token?: string };
type Fetcher = typeof fetch;
function normalizeToken(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid GoPlus access token');
  const token = value.trim().replace(/^Bearer\s+/i, '');
  if (!token || /\s/.test(token)) throw new Error('Invalid GoPlus access token');
  return token;
}

export class GoPlusAuth {
  private cached?: { token: string; refreshAt: number };
  private pending?: Promise<string>;
  private lastTimestamp = 0;
  private appKey: string;
  private appSecret: string;
  private manualToken?: string;
  constructor(credentials: Credentials, private request: Fetcher = (url, init) => fetch(url, init), private now = Date.now) {
    this.appKey = credentials.appKey?.trim() || '';
    this.appSecret = credentials.appSecret?.trim() || '';
    if (!!this.appKey !== !!this.appSecret) throw new Error('Set both GOPLUS_APP_KEY and GOPLUS_APP_SECRET');
    // App credentials take precedence over a stale manually configured token.
    if (!this.appKey && credentials.token?.trim()) this.manualToken = normalizeToken(credentials.token);
  }
  get automatic() { return !!this.appKey; }
  async getToken(): Promise<string | undefined> {
    if (!this.automatic) return this.manualToken;
    if (this.cached && this.now() < this.cached.refreshAt) return this.cached.token;
    if (!this.pending) {
      this.pending = this.issue().finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }
  private async issue(): Promise<string> {
    // A one-second increment avoids reusing the same signed timestamp on an immediate auth retry.
    const time = Math.max(Math.floor(this.now() / 1000), this.lastTimestamp + 1);
    this.lastTimestamp = time;
    const sign = createHash('sha1').update(this.appKey + time + this.appSecret).digest('hex');
    const response = await this.request('https://api.gopluslabs.io/api/v1/token', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({app_key: this.appKey, time, sign}), signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('GoPlus token refresh failed');
    const body = await response.json() as any;
    const ttl = Number(body.result?.expires_in);
    if (Number(body.code) !== 1 || !Number.isFinite(ttl) || ttl <= 0) throw new Error('Invalid GoPlus token response');
    const token = normalizeToken(body.result?.access_token);
    // Use issuance time, not response completion, for conservative expiration.
    this.cached = {token, refreshAt: time * 1000 + (ttl - Math.min(60, ttl / 10)) * 1000};
    return token;
  }
  async securityReport(tokenAddress: string): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.getToken();
      const response = await this.request(`https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses=${encodeURIComponent(tokenAddress)}`, {
        headers: token ? {Authorization: `Bearer ${token}`} : {}, signal: AbortSignal.timeout(15000)
      });
      // Do not require a JSON body on an HTTP authentication failure.
      const body = response.ok ? await response.json() as any : undefined;
      const authFailure = response.status === 401 || Number(body?.code) === 4023;
      if (authFailure && this.automatic && attempt === 0) {
        if (this.cached?.token === token) this.cached = undefined;
        continue;
      }
      if (!response.ok || Number(body?.code) !== 1) throw new Error('GoPlus security data unavailable');
      return body;
    }
    throw new Error('GoPlus authentication failed');
  }
}

let shared: GoPlusAuth | undefined;
export function getGoPlusAuth() {
  return shared ||= new GoPlusAuth({
    appKey: process.env.GOPLUS_APP_KEY,
    appSecret: process.env.GOPLUS_APP_SECRET,
    token: process.env.GOPLUS_API_TOKEN
  });
}

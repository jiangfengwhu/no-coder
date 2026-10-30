import { configuredValue, type Env } from './types';

interface Probe {
  status: number;
  ok: boolean;
  data: any;
  scopes?: string[];
}

// Only deliberate, selected response fields leave this module. Never return upstream bodies or credentials.
export async function checkTokens(env: Env, fetcher: typeof fetch = fetch) {
  async function probe(url: string, headers: Record<string, string>): Promise<Probe> {
    try {
      const response = await fetcher(url, { headers, signal: AbortSignal.timeout(12_000) });
      const data = await response.json().catch(() => null);
      return { status: response.status, ok: response.ok, data,
        scopes: response.headers.get('X-OAuth-Scopes')?.split(',').map(scope => scope.trim()).filter(Boolean) };
    } catch { return { status: 0, ok: false, data: null }; }
  }
  const githubHeaders = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'noCoder-token-check', 'X-GitHub-Api-Version': '2022-11-28' };
  const rawCfToken = env.CLOUDFLARE_API_TOKEN ?? '';
  const normalizedCfToken = rawCfToken.trim().replace(/^Bearer\s+/i, '').replace(/^(['"])(.*)\1$/, '$2');
  const cfHeaders = { Authorization: `Bearer ${normalizedCfToken}` };
  const repo = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`;
  const account = '9f38af437152e2268766afd8fdb6cf72';
  const cfBase = 'https://api.cloudflare.com/client/v4';

  const [jules, github, cloudflare] = await Promise.all([
    (async () => {
      if (!configuredValue(env.JULES_API_KEY)) return { configured: false, valid: false };
      let pageToken = '';
      let source: string | null = null;
      let status = 0;
      let sourceCount = 0;
      for (let page = 0; page < 20; page++) {
        const result = await probe(`https://jules.googleapis.com/v1alpha/sources?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { 'x-goog-api-key': env.JULES_API_KEY });
        status = result.status;
        if (!result.ok) return { configured: true, valid: false, sourcesStatus: status };
        const sources = Array.isArray(result.data?.sources) ? result.data.sources : [];
        sourceCount += sources.length;
        source = sources.find((item: any) => item.githubRepo?.owner?.toLowerCase() === env.GITHUB_OWNER.toLowerCase() && item.githubRepo?.repo?.toLowerCase() === env.GITHUB_REPO.toLowerCase())?.name ?? null;
        pageToken = result.data?.nextPageToken ?? '';
        if (source || !pageToken) break;
      }
      const sessions = await probe('https://jules.googleapis.com/v1alpha/sessions?pageSize=1', { 'x-goog-api-key': env.JULES_API_KEY });
      return { configured: true, valid: true, sourcesStatus: status, sessionsStatus: sessions.status,
        repositoryConnected: Boolean(source), source, scannedSources: sourceCount, writeTested: false };
    })(),
    (async () => {
      if (!configuredValue(env.GITHUB_TOKEN)) return { configured: false, valid: false };
      const [identity, repository, pulls, actions] = await Promise.all([
        probe('https://api.github.com/user', githubHeaders), probe(repo, githubHeaders),
        probe(`${repo}/pulls?state=all&per_page=1`, githubHeaders), probe(`${repo}/actions/runs?per_page=1`, githubHeaders),
      ]);
      let checksStatus: number | null = null;
      let statusesStatus: number | null = null;
      const branch = await probe(`${repo}/branches/${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`, githubHeaders);
      const sha = branch.data?.commit?.sha;
      if (branch.ok && typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha)) {
        const [checks, statuses] = await Promise.all([probe(`${repo}/commits/${sha}/check-runs?per_page=1`, githubHeaders), probe(`${repo}/commits/${sha}/status`, githubHeaders)]);
        checksStatus = checks.status; statusesStatus = statuses.status;
      }
      return { configured: true, valid: identity.ok, identityStatus: identity.status, repositoryStatus: repository.status,
        pullsStatus: pulls.status, actionsStatus: actions.status, branchStatus: branch.status, checksStatus, statusesStatus,
        accountCanPush: repository.data?.permissions?.push === true, scopes: identity.scopes ?? [], writeTested: false };
    })(),
    (async () => {
      if (!configuredValue(env.CLOUDFLARE_API_TOKEN)) return { configured: false, valid: false };
      const [verify, accountVerify, settings, routes] = await Promise.all([
        probe(`${cfBase}/user/tokens/verify`, cfHeaders),
        probe(`${cfBase}/accounts/${account}/tokens/verify`, cfHeaders),
        probe(`${cfBase}/accounts/${account}/workers/scripts/nocoder-lab/settings`, cfHeaders),
        probe(`${cfBase}/zones/5abe4ba6aee82a3016fe261a208243f4/workers/routes`, cfHeaders),
      ]);
      const userValid = verify.ok && verify.data?.success === true && verify.data?.result?.status === 'active';
      const accountValid = accountVerify.ok && accountVerify.data?.success === true && accountVerify.data?.result?.status === 'active';
      const valid = userValid || accountValid;
      const selected = userValid ? verify : accountVerify;
      const tokenId = typeof selected.data?.result?.id === 'string' ? selected.data.result.id : undefined;
      let permissionGroups: string[] = [];
      let policyReadStatus: number | null = null;
      if (valid && tokenId && /^[a-f0-9]{32}$/.test(tokenId)) {
        const details = await probe(`${cfBase}/${userValid ? 'user' : `accounts/${account}`}/tokens/${tokenId}`, cfHeaders);
        policyReadStatus = details.status;
        if (details.ok) permissionGroups = (details.data?.result?.policies ?? []).flatMap((policy: any) => (policy.permission_groups ?? []).map((group: any) => group.name)).filter((name: unknown): name is string => typeof name === 'string');
      }
      return { configured: true, valid, verifyStatus: verify.status, accountVerifyStatus: accountVerify.status,
        tokenType: valid ? userValid ? 'user' : 'account' : undefined, normalizationRequired: normalizedCfToken !== rawCfToken, tokenStatus: valid ? 'active' : undefined,
        workerSettingsStatus: settings.status, routesStatus: routes.status, tokenId, policyReadStatus, permissionGroups, writeTested: false };
    })(),
  ]);
  return { checkedAt: new Date().toISOString(), mode: 'read-only', jules, github, cloudflare };
}

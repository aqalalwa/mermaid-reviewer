import { AccountInfo, InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-browser';
import { AdoApi, AdoProject, AdoRepo } from '../types';

export const ADO_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';
export const VSSPS = 'https://app.vssps.visualstudio.com/_apis/';

interface NotFoundError extends Error {
  notFound?: boolean;
}

/**
 * Normalizes an organization string or Azure DevOps URL into the organization name.
 * Also extracts optional project/repo hints if a full repository URL was pasted.
 */
export function parseAdoOrgInput(raw: string): { org: string; projectHint?: string; repoHint?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { org: '' };

  // Handle https://dev.azure.com/{org}/{project}/_git/{repo}
  const devAzureMatch = /^https?:\/\/dev\.azure\.com\/([^/?#]+)(?:\/([^/?#]+))?(?:\/_git\/([^/?#]+))?/i.exec(trimmed);
  if (devAzureMatch) {
    return {
      org: decodeURIComponent(devAzureMatch[1]),
      projectHint: devAzureMatch[2] ? decodeURIComponent(devAzureMatch[2]) : undefined,
      repoHint: devAzureMatch[3] ? decodeURIComponent(devAzureMatch[3]) : undefined
    };
  }

  // Handle https://{org}.visualstudio.com/{project}/_git/{repo}
  const vsMatch = /^https?:\/\/([^./]+)\.visualstudio\.com(?:\/([^/?#]+))?(?:\/_git\/([^/?#]+))?/i.exec(trimmed);
  if (vsMatch) {
    return {
      org: decodeURIComponent(vsMatch[1]),
      projectHint: vsMatch[2] ? decodeURIComponent(vsMatch[2]) : undefined,
      repoHint: vsMatch[3] ? decodeURIComponent(vsMatch[3]) : undefined
    };
  }

  const clean = trimmed
    .replace(/^https?:\/\/dev\.azure\.com\//i, '')
    .replace(/\/.*$/, '')
    .trim();
  return { org: clean };
}

/**
 * Creates an Azure DevOps REST API 7.1 client using a dynamic Authorization header provider
 * (supports both Bearer tokens from Microsoft Entra ID SSO and Basic auth from Personal Access Tokens).
 */
export function createLiveAdoApi(org: string, getAuthHeader: () => Promise<string>): AdoApi {
  const base = 'https://dev.azure.com/' + encodeURIComponent(org) + '/';

  const get = async (path: string, q?: Record<string, string | number>) => {
    const u = new URL(base + path);
    Object.entries({ ...(q || {}), 'api-version': '7.1' }).forEach(([k, v]) =>
      u.searchParams.set(k, String(v))
    );
    let res: Response;
    const authHeader = await getAuthHeader();
    try {
      res = await fetch(u.toString(), {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json'
        }
      });
    } catch (_) {
      throw new Error(
        'Could not reach dev.azure.com. Check the organization name, and that your network allows browser requests to Azure DevOps.'
      );
    }
    if (res.status === 401 || res.status === 203) {
      throw new Error(
        'Azure DevOps denied access (401/203). Check that your token or account belongs to "' +
          org +
          '" and has Code (Read) permission.'
      );
    }
    if (res.status === 403) {
      throw new Error(
        'Azure DevOps forbidden (403). Ensure your Personal Access Token or Entra ID app has Code (Read) scope.'
      );
    }
    if (res.status === 404) {
      const e: NotFoundError = new Error(
        'Organization or resource "' + org + '" was not found on dev.azure.com.'
      );
      e.notFound = true;
      throw e;
    }
    if (!res.ok) {
      throw new Error('Azure DevOps returned HTTP ' + res.status + '.');
    }
    return res.json();
  };

  const enc = encodeURIComponent;
  const repoPath = (p: string, r: string) => enc(p) + '/_apis/git/repositories/' + enc(r);

  return {
    projects: async (): Promise<AdoProject[]> => {
      const data = await get('_apis/projects', { $top: 500 });
      return (data.value || [])
        .map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))
        .sort((a: AdoProject, b: AdoProject) => a.name.localeCompare(b.name));
    },

    repos: async (p: string): Promise<AdoRepo[]> => {
      const data = await get(enc(p) + '/_apis/git/repositories');
      return (data.value || [])
        .map((r: { id: string; name: string; defaultBranch?: string }) => ({
          id: r.id,
          name: r.name,
          defaultBranch: (r.defaultBranch || 'refs/heads/main').replace('refs/heads/', '')
        }))
        .sort((a: AdoRepo, b: AdoRepo) => a.name.localeCompare(b.name));
    },

    branches: async (p: string, r: string): Promise<string[]> => {
      const data = await get(repoPath(p, r) + '/refs', { filter: 'heads/' });
      return (data.value || []).map((x: { name: string }) => x.name.replace('refs/heads/', ''));
    },

    files: async (p: string, r: string, b: string): Promise<string[]> => {
      const data = await get(repoPath(p, r) + '/items', {
        scopePath: '/',
        recursionLevel: 'Full',
        'versionDescriptor.version': b,
        'versionDescriptor.versionType': 'branch'
      });
      return (data.value || [])
        .filter((i: { isFolder?: boolean }) => !i.isFolder)
        .map((i: { path: string }) => i.path);
    },

    changes: async (p: string, r: string, baseBranch: string, tgtBranch: string): Promise<Record<string, string>> => {
      const j = await get(repoPath(p, r) + '/diffs/commits', {
        baseVersion: baseBranch,
        baseVersionType: 'branch',
        targetVersion: tgtBranch,
        targetVersionType: 'branch',
        $top: 2000
      });
      const m: Record<string, string> = {};
      (j.changes || []).forEach((c: { item?: { isFolder?: boolean; path: string }; changeType: string }) => {
        if (c.item && !c.item.isFolder) {
          // Normalize ADO changeType (e.g. "edit, rename" or "add")
          const raw = String(c.changeType || '').toLowerCase();
          m[c.item.path] = raw.includes('add') ? 'add' : raw.includes('delete') ? 'delete' : 'edit';
        }
      });
      return m;
    },

    content: async (p: string, r: string, b: string, path: string): Promise<string | null> => {
      try {
        const j = await get(repoPath(p, r) + '/items', {
          path,
          includeContent: 'true',
          $format: 'json',
          'versionDescriptor.version': b,
          'versionDescriptor.versionType': 'branch'
        });
        return j.content ?? '';
      } catch (e) {
        if ((e as NotFoundError)?.notFound) return null;
        throw e;
      }
    }
  };
}

/**
 * Encodes a Personal Access Token (PAT) for Azure DevOps HTTP Basic authentication.
 */
export function patAuthHeader(pat: string): string {
  const cleanPat = pat.trim();
  const bytes = new TextEncoder().encode(':' + cleanPat);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return 'Basic ' + btoa(binary);
}

/**
 * Manages Microsoft Entra ID (MSAL) PublicClientApplication lifecycle.
 */
export class MsalSsoManager {
  private msal: PublicClientApplication | null = null;
  private msalKey: string | null = null;

  async getApp(clientId: string, tenantId: string, redirectUri: string): Promise<PublicClientApplication> {
    const cleanClient = clientId.trim();
    const cleanTenant = tenantId.trim() || 'organizations';
    if (!cleanClient) {
      throw new Error('Single sign-on Client ID is not configured.');
    }
    const key = `${cleanClient}|${cleanTenant}|${redirectUri}`;
    if (this.msal && this.msalKey === key) {
      return this.msal;
    }
    const app = new PublicClientApplication({
      auth: {
        clientId: cleanClient,
        authority: 'https://login.microsoftonline.com/' + cleanTenant,
        redirectUri
      },
      cache: {
        cacheLocation: 'sessionStorage'
      }
    });
    await app.initialize();
    try {
      await app.handleRedirectPromise();
    } catch (_) {}
    this.msal = app;
    this.msalKey = key;
    return app;
  }

  async restoreAccount(clientId: string, tenantId: string, redirectUri: string): Promise<AccountInfo | null> {
    if (!clientId.trim()) return null;
    try {
      const app = await this.getApp(clientId, tenantId, redirectUri);
      const acc = app.getActiveAccount() || app.getAllAccounts()[0] || null;
      if (acc) app.setActiveAccount(acc);
      return acc;
    } catch (_) {
      return null;
    }
  }

  async login(clientId: string, tenantId: string, redirectUri: string): Promise<AccountInfo> {
    const app = await this.getApp(clientId, tenantId, redirectUri);
    const res = await app.loginPopup({
      scopes: [ADO_SCOPE],
      prompt: 'select_account'
    });
    app.setActiveAccount(res.account);
    return res.account;
  }

  async logout(clientId: string, tenantId: string, redirectUri: string): Promise<void> {
    try {
      const app = await this.getApp(clientId, tenantId, redirectUri);
      const acc = app.getActiveAccount();
      if (acc) {
        await app.clearCache({ account: acc });
      }
    } catch (_) {}
  }

  async getAccessToken(clientId: string, tenantId: string, redirectUri: string): Promise<string> {
    const app = await this.getApp(clientId, tenantId, redirectUri);
    const account = app.getActiveAccount() || app.getAllAccounts()[0];
    if (!account) throw new Error('Sign in with your Microsoft account to continue.');
    try {
      const res = await app.acquireTokenSilent({ scopes: [ADO_SCOPE], account });
      return res.accessToken;
    } catch (e) {
      if (e instanceof InteractionRequiredAuthError) {
        const res = await app.acquireTokenPopup({ scopes: [ADO_SCOPE], account });
        return res.accessToken;
      }
      throw e;
    }
  }

  async discoverOrganizations(accessToken: string): Promise<string[]> {
    const H = {
      headers: {
        Authorization: 'Bearer ' + accessToken,
        Accept: 'application/json'
      }
    };
    const meRes = await fetch(VSSPS + 'profile/profiles/me?api-version=7.1', H);
    if (!meRes.ok) throw new Error('Could not load profile');
    const me = await meRes.json();
    const accRes = await fetch(VSSPS + 'accounts?memberId=' + encodeURIComponent(me.id) + '&api-version=7.1', H);
    if (!accRes.ok) throw new Error('Could not load organizations');
    const acc = await accRes.json();
    return (acc.value || [])
      .map((a: { accountName: string }) => a.accountName)
      .sort((a: string, b: string) => a.localeCompare(b));
  }
}

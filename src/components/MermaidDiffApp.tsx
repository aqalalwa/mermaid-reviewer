import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountInfo } from '@azure/msal-browser';
import mermaid from 'mermaid';
import {
  AdoActiveSession,
  AdoApi,
  AdoFileEntry,
  AdoPickState,
  AdoProject,
  AdoRepo,
  AuthMethod,
  DiffFilter,
  FileChangeKind,
  FocusTarget,
  MermaidDiffProps,
  PaneKey,
  TransformState,
  ViewMode
} from '../types';
import {
  buildFullDiff,
  CH,
  cleanLabel,
  COL,
  edgeSig,
  edgeTypeName,
  isMermaidPath,
  mermaidBlocks,
  nodeLabel
} from '../parser/flowchartDiff';
import { demoApi, SAMPLE_A, SAMPLE_B } from '../ado/demoData';
import { createLiveAdoApi, MsalSsoManager, parseAdoOrgInput, patAuthHeader } from '../ado/adoClient';

const SSO_STORAGE_CLIENT_KEY = 'mermaid_diff_sso_client_id';
const SSO_STORAGE_TENANT_KEY = 'mermaid_diff_sso_tenant_id';

export const MermaidDiffApp: React.FC<MermaidDiffProps> = ({
  defaultView = 'split',
  syncPanZoom = true,
  dimUnchanged = false,
  adoDemoOnLoad = false,
  ssoClientId: propSsoClientId = '',
  ssoTenantId: propSsoTenantId = 'organizations'
}) => {
  // Core diagram & UI state
  const [srcA, setSrcA] = useState<string>(SAMPLE_A);
  const [srcB, setSrcB] = useState<string>(SAMPLE_B);
  const [nameA, setNameA] = useState<string>('checkout-v1.mmd');
  const [nameB, setNameB] = useState<string>('checkout-v2.mmd');
  const [view, setView] = useState<ViewMode>(defaultView);
  const [sync, setSync] = useState<boolean>(syncPanZoom);
  const [filter, setFilter] = useState<DiffFilter>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [editA, setEditA] = useState<boolean>(false);
  const [editB, setEditB] = useState<boolean>(false);
  const [dragA, setDragA] = useState<boolean>(false);
  const [dragB, setDragB] = useState<boolean>(false);
  const [dragging, setDragging] = useState<PaneKey | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errA, setErrA] = useState<string>('');
  const [errB, setErrB] = useState<string>('');
  const [errO, setErrO] = useState<string>('');
  const [transforms, setTransforms] = useState<Record<PaneKey, TransformState>>({
    a: { x: 0, y: 0, s: 1 },
    b: { x: 0, y: 0, s: 1 },
    o: { x: 0, y: 0, s: 1 }
  });

  // Azure DevOps modal & connection state
  const [modal, setModal] = useState<'connect' | 'pick' | null>(null);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('pat');
  const [org, setOrg] = useState<string>('');
  const [pat, setPat] = useState<string>('');
  const [customClientId, setCustomClientId] = useState<string>(() => {
    try {
      return localStorage.getItem(SSO_STORAGE_CLIENT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [customTenantId, setCustomTenantId] = useState<string>(() => {
    try {
      return localStorage.getItem(SSO_STORAGE_TENANT_KEY) || 'organizations';
    } catch {
      return 'organizations';
    }
  });
  const [showSsoConfig, setShowSsoConfig] = useState<boolean>(false);

  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [orgs, setOrgs] = useState<string[]>([]);
  const [orgsBusy, setOrgsBusy] = useState<boolean>(false);
  const [orgsFailed, setOrgsFailed] = useState<boolean>(false);
  const [signingIn, setSigningIn] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<'live' | 'demo' | null>(null);
  const [connErr, setConnErr] = useState<string>('');

  const [projects, setProjects] = useState<AdoProject[]>([]);
  const [repos, setRepos] = useState<AdoRepo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [files, setFiles] = useState<AdoFileEntry[]>([]);
  const [pick, setPick] = useState<AdoPickState>({});
  const [pickBusy, setPickBusy] = useState<string>('');
  const [pickErr, setPickErr] = useState<string>('');
  const [fileQuery, setFileQuery] = useState<string>('');
  const [onlyChanged, setOnlyChanged] = useState<boolean>(false);

  const [ado, setAdo] = useState<AdoActiveSession | null>(null);
  const [fetching, setFetching] = useState<boolean>(false);
  const [adoErr, setAdoErr] = useState<string>('');
  const [missA, setMissA] = useState<boolean>(false);
  const [missB, setMissB] = useState<boolean>(false);
  const [blockCount, setBlockCount] = useState<number>(1);
  const [blockIdx, setBlockIdx] = useState<number>(0);

  // Refs
  const paneARef = useRef<HTMLDivElement>(null);
  const paneBRef = useRef<HTMLDivElement>(null);
  const paneORef = useRef<HTMLDivElement>(null);
  const svgARef = useRef<HTMLDivElement>(null);
  const svgBRef = useRef<HTMLDivElement>(null);
  const svgORef = useRef<HTMLDivElement>(null);
  const fileARef = useRef<HTMLInputElement>(null);
  const fileBRef = useRef<HTMLInputElement>(null);

  const sizesRef = useRef<Partial<Record<PaneKey, { w: number; h: number } | null>>>({});
  const fittedRef = useRef<Partial<Record<PaneKey, boolean>>>({});
  const seqRef = useRef<number>(0);
  const qRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<number | null>(null);
  const tmpRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ k: PaneKey; x: number; y: number } | null>(null);
  const mmReadyRef = useRef<boolean>(false);
  const needRetryRef = useRef<boolean>(false);
  const retriesRef = useRef<number>(0);

  const apiRef = useRef<AdoApi | null>(null);
  const apiModeRef = useRef<'demo' | 'live'>('demo');
  const orgLabelRef = useRef<string>('');
  const blocksRef = useRef<{ a: string[]; b: string[] }>({ a: [], b: [] });
  const msalManagerRef = useRef<MsalSsoManager>(new MsalSsoManager());

  // Sync state with latest values for event listeners
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const viewRef = useRef(view);
  viewRef.current = view;

  const effectiveClientId = (propSsoClientId || customClientId).trim();
  const effectiveTenantId = (propSsoTenantId || customTenantId).trim() || 'organizations';
  const redirectUri = useMemo(() => window.location.origin + window.location.pathname, []);

  // Switch default auth tab to SSO if an SSO client ID is already configured
  useEffect(() => {
    if (effectiveClientId) {
      setAuthMethod('sso');
    }
  }, [effectiveClientId]);

  const getPaneEl = useCallback((k: PaneKey): HTMLDivElement | null => {
    return k === 'a' ? paneARef.current : k === 'b' ? paneBRef.current : paneORef.current;
  }, []);

  const getSvgEl = useCallback((k: PaneKey): HTMLDivElement | null => {
    return k === 'a' ? svgARef.current : k === 'b' ? svgBRef.current : svgORef.current;
  }, []);

  const diff = useMemo(() => buildFullDiff(srcA, srcB, !!dimUnchanged), [srcA, srcB, dimUnchanged]);
  const diffRef = useRef(diff);
  diffRef.current = diff;

  const calcFit = useCallback(
    (k: PaneKey) => {
      const p = getPaneEl(k);
      const sz = sizesRef.current[k];
      if (!p || !sz || !sz.w || !sz.h) return null;
      const W = p.clientWidth;
      const H = p.clientHeight;
      if (!W || !H) return null;
      return { W, H, sz, s: Math.min((W - 56) / sz.w, (H - 56) / sz.h, 1.3) };
    },
    [getPaneEl]
  );

  const place = useCallback(
    (f: { W: number; H: number; sz: { w: number; h: number }; s: number }, s: number): TransformState => ({
      s,
      x: (f.W - f.sz.w * s) / 2,
      y: Math.max(28, (f.H - f.sz.h * s) / 2)
    }),
    []
  );

  const fit = useCallback(
    (k: PaneKey) => {
      const f = calcFit(k);
      if (!f) return;
      fittedRef.current[k] = true;
      setTransforms((st) => ({ ...st, [k]: place(f, f.s) }));
    },
    [calcFit, place]
  );

  const fitSplit = useCallback(() => {
    const fa = calcFit('a');
    const fb = calcFit('b');
    if (syncRef.current && fa && fb) {
      const s = Math.min(fa.s, fb.s);
      fittedRef.current.a = true;
      fittedRef.current.b = true;
      setTransforms((st) => ({
        ...st,
        a: place(fa, s),
        b: place(fb, s)
      }));
    } else {
      fit('a');
      fit('b');
    }
  }, [calcFit, fit, place]);

  const fitVisible = useCallback(() => {
    const v = viewRef.current;
    if (v === 'split') {
      if (!fittedRef.current.a || !fittedRef.current.b) fitSplit();
    } else if (v === 'overlay' && !fittedRef.current.o) {
      fit('o');
    }
  }, [fit, fitSplit]);

  const linked = useCallback((k: PaneKey): PaneKey[] => {
    return k !== 'o' && syncRef.current && viewRef.current === 'split' ? ['a', 'b'] : [k];
  }, []);

  const zoomAt = useCallback(
    (k: PaneKey, f: number, px: number, py: number) => {
      const keys = linked(k);
      setTransforms((prev) => {
        const next = { ...prev };
        keys.forEach((kk) => {
          const c = next[kk];
          const s = Math.min(6, Math.max(0.1, c.s * f));
          const r = s / c.s;
          next[kk] = { s, x: px - (px - c.x) * r, y: py - (py - c.y) * r };
        });
        return next;
      });
    },
    [linked]
  );

  const zoomBtn = useCallback(
    (k: PaneKey, f: number) => {
      const p = getPaneEl(k);
      if (p) zoomAt(k, f, p.clientWidth / 2, p.clientHeight / 2);
    },
    [getPaneEl, zoomAt]
  );

  const renderInto = useCallback(
    async (k: PaneKey, code: string, setErr: React.Dispatch<React.SetStateAction<string>>) => {
      const el = getSvgEl(k);
      if (!el) return;
      try {
        if (!tmpRef.current) {
          const div = document.createElement('div');
          div.style.cssText = 'position:absolute;left:-20000px;top:0;width:2400px;visibility:visible;';
          document.body.appendChild(div);
          tmpRef.current = div;
        }
        const id = 'mdd' + ++seqRef.current;
        const { svg } = await mermaid.render(id, code, tmpRef.current);
        tmpRef.current.innerHTML = '';
        el.innerHTML = svg;
        const s = el.querySelector('svg');
        if (s) {
          const vb = s.viewBox && s.viewBox.baseVal;
          let w = vb && vb.width > 0 ? vb.width : 0;
          let h = vb && vb.height > 0 ? vb.height : 0;
          if (!w || !h) {
            try {
              const bb = s.getBBox();
              if (bb.width > 0 && bb.height > 0) {
                w = bb.width + 16;
                h = bb.height + 16;
              }
            } catch (_) {}
          }
          if (!w || !h) {
            w = parseFloat(s.getAttribute('width') || '400') || 400;
            h = parseFloat(s.getAttribute('height') || '300') || 300;
          }
          s.removeAttribute('style');
          s.setAttribute('width', String(w));
          s.setAttribute('height', String(h));
          s.style.display = 'block';
          s.style.overflow = 'visible';
          sizesRef.current[k] = { w, h };
        }
        setErr('');
      } catch (e: unknown) {
        el.innerHTML = '';
        sizesRef.current[k] = null;
        document.querySelectorAll('body > [id^="dmdd"]').forEach((n) => n.remove());
        if (tmpRef.current) tmpRef.current.innerHTML = '';
        let syntax = false;
        try {
          await mermaid.parse(code);
        } catch (_) {
          syntax = true;
        }
        if (!syntax) {
          needRetryRef.current = true;
          setErr('');
          if (document.visibilityState === 'visible' && ++retriesRef.current < 6) {
            window.setTimeout(() => scheduleRender(0), 400);
          }
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        setErr('Syntax error\n' + msg.slice(0, 400));
        document.querySelectorAll('body > [id^="dmdd"]').forEach((n) => n.remove());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getSvgEl]
  );

  const renderAll = useCallback(async () => {
    if (!mmReadyRef.current) return;
    needRetryRef.current = false;
    const d = diffRef.current;

    const clearPane = (k: PaneKey, setErr: React.Dispatch<React.SetStateAction<string>>) => {
      const el = getSvgEl(k);
      if (el) el.innerHTML = '';
      sizesRef.current[k] = null;
      setErr('');
    };

    if (d.blankA) clearPane('a', setErrA);
    else await renderInto('a', d.srcA, setErrA);

    if (d.blankB) clearPane('b', setErrB);
    else await renderInto('b', d.srcB, setErrB);

    if (d.srcO) {
      await renderInto('o', d.srcO, setErrO);
    } else {
      const el = getSvgEl('o');
      if (el) el.innerHTML = '';
      sizesRef.current.o = null;
      setErrO('The merged view is available when both files are flowcharts. Use Split or Source for other diagram types.');
    }

    if (!needRetryRef.current) retriesRef.current = 0;
    fitVisible();
  }, [fitVisible, getSvgEl, renderInto]);

  const scheduleRender = useCallback(
    (ms: number) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        qRef.current = qRef.current.then(() => renderAll()).catch(() => {});
      }, ms);
    },
    [renderAll]
  );

  // Initialize Mermaid and listeners
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      logLevel: 'fatal',
      theme: 'base',
      securityLevel: 'strict',
      suppressErrorRendering: true,
      fontFamily: 'Geist, system-ui, sans-serif',
      flowchart: { curve: 'basis', padding: 14, nodeSpacing: 44, rankSpacing: 52 },
      themeVariables: {
        fontFamily: 'Geist, system-ui, sans-serif',
        fontSize: '14px',
        primaryColor: '#ffffff',
        primaryBorderColor: '#3a3934',
        primaryTextColor: '#191917',
        lineColor: '#8a887f',
        textColor: '#3a3934',
        edgeLabelBackground: '#fbfaf7',
        clusterBkg: '#f0eee8',
        clusterBorder: '#d6d3c9',
        secondaryColor: '#f0eee8',
        tertiaryColor: '#f4f3ef'
      }
    });

    let active = true;
    (async () => {
      try {
        await document.fonts.ready;
      } catch (_) {}
      if (!active) return;
      mmReadyRef.current = true;
      setLoading(false);
      scheduleRender(0);
    })();

    return () => {
      active = false;
    };
  }, [scheduleRender]);

  // Re-render when diagram sources change
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    fittedRef.current = {};
    scheduleRender(250);
  }, [srcA, srcB, dimUnchanged, scheduleRender]);

  // Fit visible when switching views or toggling editors
  useEffect(() => {
    requestAnimationFrame(() => fitVisible());
  }, [view, editA, editB, fitVisible]);

  // Wheel, mousemove, resize, and ResizeObserver
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    (['a', 'b', 'o'] as PaneKey[]).forEach((k) => {
      const el = getPaneEl(k);
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomAt(k, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      cleanups.push(() => el.removeEventListener('wheel', onWheel));
    });

    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current.x = e.clientX;
      dragRef.current.y = e.clientY;
      const keys = linked(dragRef.current.k);
      setTransforms((st) => {
        const next = { ...st };
        keys.forEach((k) => {
          next[k] = { ...next[k], x: next[k].x + dx, y: next[k].y + dy };
        });
        return next;
      });
    };

    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setDragging(null);
      }
    };

    const onResize = () => {
      fittedRef.current = {};
      fitVisible();
    };

    const onVis = () => {
      if (document.visibilityState === 'visible' && needRetryRef.current) {
        retriesRef.current = 0;
        scheduleRender(0);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);

    const ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        const k: PaneKey =
          en.target === paneARef.current ? 'a' : en.target === paneBRef.current ? 'b' : 'o';
        if (en.contentRect.width > 0 && sizesRef.current[k] && !fittedRef.current[k]) {
          if (k === 'o') fit('o');
          else fitSplit();
        }
      }
    });
    (['a', 'b', 'o'] as PaneKey[]).forEach((k) => {
      const el = getPaneEl(k);
      if (el) ro.observe(el);
    });

    return () => {
      cleanups.forEach((fn) => fn());
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
    };
  }, [fit, fitSplit, fitVisible, getPaneEl, linked, scheduleRender, zoomAt]);

  const findEl = useCallback(
    (k: PaneKey, item: FocusTarget): Element | null => {
      const root = getSvgEl(k);
      if (!root) return null;
      if (item.kind === 'node' && item.id) {
        const esc = item.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('flowchart-' + esc + '-\\d+$');
        return [...root.querySelectorAll('g.node')].find((n) => re.test(n.id)) || null;
      }
      if (item.pair) {
        const [from, to] = item.pair;
        const ms = [...root.querySelectorAll('path[id]')].filter(
          (p) => p.id.includes(`L_${from}_${to}_`) || p.id.includes(`L-${from}-${to}-`)
        );
        return ms[item.occ || 0] || ms[0] || null;
      }
      return null;
    },
    [getSvgEl]
  );

  const focusItem = useCallback(
    (item: FocusTarget) => {
      const v = viewRef.current;
      if (v === 'source') {
        setView('split');
        window.setTimeout(() => {
          fitVisible();
          window.setTimeout(() => focusItem(item), 60);
        }, 20);
        return;
      }
      setSel(item.key);
      const keys: PaneKey[] =
        v === 'overlay'
          ? ['o']
          : [
              item.status === 'del' ? 'a' : 'b',
              ...(item.status === 'mod' || item.status === 'same' ? (['a'] as PaneKey[]) : [])
            ];
      const ks: PaneKey[] = v === 'split' ? ['a', 'b'] : keys;

      ks.forEach((k) => {
        const el = findEl(k, item);
        const p = getPaneEl(k);
        if (!el || !p) return;
        const r = p.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        const dx = r.left + r.width / 2 - (e.left + e.width / 2);
        const dy = r.top + r.height / 2 - (e.top + e.height / 2);
        setTransforms((st) => ({
          ...st,
          [k]: { ...st[k], x: st[k].x + dx, y: st[k].y + dy }
        }));
        try {
          el.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], {
            duration: 450,
            iterations: 3,
            delay: 120
          });
        } catch (_) {}
      });
    },
    [findEl, fitVisible, getPaneEl]
  );

  const loadLocalFile = useCallback((side: 'a' | 'b', file?: File) => {
    if (!file) return;
    file.text().then((t) => {
      if (/\.(md|markdown)$/i.test(file.name)) {
        const m = /```mermaid[^\n]*\n([\s\S]*?)```/.exec(t);
        if (m) t = m[1];
      }
      fittedRef.current = {};
      if (side === 'a') {
        setSrcA(t);
        setNameA(file.name);
        setDragA(false);
      } else {
        setSrcB(t);
        setNameB(file.name);
        setDragB(false);
      }
    });
  }, []);

  // Azure DevOps SSO & PAT Functions
  const loadOrgsForSso = useCallback(async () => {
    if (!effectiveClientId) return;
    setOrgsBusy(true);
    setOrgsFailed(false);
    try {
      const tok = await msalManagerRef.current.getAccessToken(
        effectiveClientId,
        effectiveTenantId,
        redirectUri
      );
      const discovered = await msalManagerRef.current.discoverOrganizations(tok);
      setOrgs(discovered);
      setOrgsBusy(false);
      setOrgsFailed(discovered.length === 0);
      setOrg((prev) => (prev && discovered.includes(prev) ? prev : discovered[0] || prev));
    } catch (_) {
      setOrgsBusy(false);
      setOrgsFailed(true);
    }
  }, [effectiveClientId, effectiveTenantId, redirectUri]);

  const restoreSession = useCallback(async () => {
    if (!effectiveClientId || account) return;
    const acc = await msalManagerRef.current.restoreAccount(
      effectiveClientId,
      effectiveTenantId,
      redirectUri
    );
    if (acc) {
      setAccount(acc);
      loadOrgsForSso();
    }
  }, [account, effectiveClientId, effectiveTenantId, loadOrgsForSso, redirectUri]);

  const handleSignIn = useCallback(
    async (switchAcct: boolean) => {
      if (!effectiveClientId || signingIn) return;
      setSigningIn(true);
      setConnErr('');
      try {
        const acc = await msalManagerRef.current.login(
          effectiveClientId,
          effectiveTenantId,
          redirectUri
        );
        setAccount(acc);
        setSigningIn(false);
        setOrgs([]);
        if (switchAcct) setOrg('');
        loadOrgsForSso();
      } catch (e: unknown) {
        const errObj = e as { errorCode?: string; message?: string };
        const raw = String((errObj && (errObj.errorCode || errObj.message)) || e);
        const msg = /user_cancelled|popup_window_error|cancel/i.test(raw)
          ? /popup_window_error/i.test(String(errObj?.errorCode))
            ? 'The sign-in popup was blocked. Allow popups for this page and try again.'
            : ''
          : errObj?.message || String(e);
        setSigningIn(false);
        setConnErr(msg);
      }
    },
    [effectiveClientId, effectiveTenantId, loadOrgsForSso, redirectUri, signingIn]
  );

  const handleSignOut = useCallback(async () => {
    await msalManagerRef.current.logout(effectiveClientId, effectiveTenantId, redirectUri);
    setAccount(null);
    setOrgs([]);
    setOrg('');
  }, [effectiveClientId, effectiveTenantId, redirectUri]);

  const saveCustomSsoSettings = (clientId: string, tenantId: string) => {
    setCustomClientId(clientId);
    setCustomTenantId(tenantId);
    try {
      localStorage.setItem(SSO_STORAGE_CLIENT_KEY, clientId.trim());
      localStorage.setItem(SSO_STORAGE_TENANT_KEY, tenantId.trim() || 'organizations');
    } catch (_) {}
  };

  const loadFilesForBranches = useCallback(
    async (ctx: AdoPickState, autoPick: boolean): Promise<string | null> => {
      const api = apiRef.current;
      if (!api || !ctx.project || !ctx.repo || !ctx.source || !ctx.target) return null;
      const [sf, tf, ch] = await Promise.all([
        api.files(ctx.project, ctx.repo, ctx.source),
        api.files(ctx.project, ctx.repo, ctx.target),
        ctx.source !== ctx.target
          ? api.changes(ctx.project, ctx.repo, ctx.target, ctx.source)
          : Promise.resolve<Record<string, FileChangeKind>>({})
      ]);
      const S = new Set(sf);
      const T = new Set(tf);
      const list: AdoFileEntry[] = [...new Set([...sf, ...tf])]
        .filter(isMermaidPath)
        .map((path): AdoFileEntry => ({
          path,
          change:
            S.has(path) && !T.has(path)
              ? 'add'
              : T.has(path) && !S.has(path)
                ? 'delete'
                : ch[path]
                  ? 'edit'
                  : null
        }))
        .sort((a, b) => Number(!!b.change) - Number(!!a.change) || a.path.localeCompare(b.path));

      let chosenPath = ctx.path ?? null;
      if (autoPick || !list.some((f) => f.path === chosenPath)) {
        chosenPath = (list.find((f) => f.change) || list[0])?.path || null;
      }
      setFiles(list);
      return chosenPath;
    },
    []
  );

  const pickRepoInternal = useCallback(
    async (projectId: string, projectName: string, repoList: AdoRepo[], repoId: string) => {
      const api = apiRef.current;
      if (!api) return;
      const repo = repoList.find((r) => r.id === repoId) || repoList[0];
      if (!repo) return;
      setPickBusy('Loading branches…');
      const brs = await api.branches(projectId, repo.id);
      const target = brs.includes(repo.defaultBranch) ? repo.defaultBranch : brs[0] || 'main';
      const source = brs.find((b) => b !== target) || target;
      const nextPick: AdoPickState = {
        project: projectId,
        projectName,
        repo: repo.id,
        repoName: repo.name,
        source,
        target,
        path: null
      };
      setBranches(brs);
      setPick(nextPick);
      setPickBusy('Finding Mermaid files…');
      const path = await loadFilesForBranches(nextPick, true);
      const finalPick = { ...nextPick, path };
      setPick(finalPick);
      return finalPick;
    },
    [loadFilesForBranches]
  );

  const pickProjectInternal = useCallback(
    async (projectList: AdoProject[], projectId: string, repoHint?: string) => {
      const api = apiRef.current;
      if (!api) return null;
      setPickBusy('Loading repositories…');
      setPickErr('');
      try {
        const proj = projectList.find((p) => p.id === projectId) || projectList[0];
        const pName = proj ? proj.name : projectId;
        setPick({ project: projectId, projectName: pName });
        setRepos([]);
        setBranches([]);
        setFiles([]);
        const repoList = await api.repos(projectId);
        setRepos(repoList);
        if (repoList.length > 0) {
          const matchedRepo = repoHint
            ? repoList.find((r) => r.name.toLowerCase() === repoHint.toLowerCase() || r.id === repoHint)
            : undefined;
          const resultPick = await pickRepoInternal(
            projectId,
            pName,
            repoList,
            (matchedRepo || repoList[0]).id
          );
          setPickBusy('');
          return resultPick || null;
        }
        setPickBusy('');
        return null;
      } catch (e: unknown) {
        setPickErr(e instanceof Error ? e.message : String(e));
        setPickBusy('');
        return null;
      }
    },
    [pickRepoInternal]
  );

  const loadComparison = useCallback(async (session: AdoActiveSession) => {
    const api = apiRef.current;
    if (!api || !session.path || !session.project || !session.repo || !session.target || !session.source) return;
    setFetching(true);
    setAdoErr('');
    try {
      const [a, b] = await Promise.all([
        api.content(session.project, session.repo, session.target, session.path),
        api.content(session.project, session.repo, session.source, session.path)
      ]);
      const ba = mermaidBlocks(session.path, a);
      const bb = mermaidBlocks(session.path, b);
      const n = Math.max(ba.length, bb.length);
      blocksRef.current = { a: ba, b: bb };
      let idx = 0;
      for (let i = 0; i < n; i++) {
        if ((ba[i] || '') !== (bb[i] || '')) {
          idx = i;
          break;
        }
      }
      fittedRef.current = {};
      setFetching(false);
      setAdoErr(n ? '' : 'No Mermaid diagrams found in this file.');
      setSrcA(ba[idx] || '');
      setSrcB(bb[idx] || '');
      setNameA(session.target);
      setNameB(session.source);
      setMissA(a === null);
      setMissB(b === null);
      setBlockCount(Math.max(n, 1));
      setBlockIdx(idx);
      setSel(null);
      setEditA(false);
      setEditB(false);
    } catch (e: unknown) {
      setFetching(false);
      setAdoErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleConnect = useCallback(
    async (mode: 'demo' | 'live', autoCompareAfter = false) => {
      const parsedOrg = parseAdoOrgInput(org);
      const cleanOrg = parsedOrg.org;

      if (mode === 'live') {
        if (authMethod === 'pat') {
          if (!cleanOrg) {
            setConnErr('Enter your Azure DevOps organization name (e.g. dev.azure.com/your-org).');
            return;
          }
          if (!pat.trim()) {
            setConnErr('Paste a Personal Access Token with Code (Read) scope.');
            return;
          }
        } else {
          if (!account) {
            setConnErr('Sign in with your Microsoft work account first.');
            return;
          }
          if (!cleanOrg) {
            setConnErr('Choose or enter an Azure DevOps organization.');
            return;
          }
        }
      }

      setConnecting(mode);
      setConnErr('');
      try {
        let nextApi: AdoApi;
        if (mode === 'demo') {
          nextApi = demoApi;
        } else if (authMethod === 'pat') {
          const authHeader = patAuthHeader(pat);
          nextApi = createLiveAdoApi(cleanOrg, async () => authHeader);
        } else {
          nextApi = createLiveAdoApi(cleanOrg, async () => {
            const tok = await msalManagerRef.current.getAccessToken(
              effectiveClientId,
              effectiveTenantId,
              redirectUri
            );
            return 'Bearer ' + tok;
          });
        }

        const projList = await nextApi.projects();
        if (!projList.length) {
          throw new Error('No projects are visible in this organization with the provided credentials.');
        }

        apiRef.current = nextApi;
        apiModeRef.current = mode;
        orgLabelRef.current = mode === 'demo' ? 'contoso' : cleanOrg;

        setProjects(projList);
        setConnecting(null);
        setModal('pick');
        setPick({});
        setPickErr('');

        const matchedProj = parsedOrg.projectHint
          ? projList.find(
              (p) =>
                p.name.toLowerCase() === parsedOrg.projectHint!.toLowerCase() ||
                p.id === parsedOrg.projectHint
            )
          : undefined;

        const chosenPick = await pickProjectInternal(
          projList,
          (matchedProj || projList[0]).id,
          parsedOrg.repoHint
        );

        if (autoCompareAfter && chosenPick?.path) {
          const session: AdoActiveSession = {
            ...chosenPick,
            mode,
            authMethod: mode === 'live' ? authMethod : undefined,
            org: orgLabelRef.current
          };
          setModal(null);
          setAdo(session);
          await loadComparison(session);
        }
      } catch (e: unknown) {
        setConnecting(null);
        setConnErr(e instanceof Error ? e.message : String(e));
      }
    },
    [
      account,
      authMethod,
      effectiveClientId,
      effectiveTenantId,
      loadComparison,
      org,
      pat,
      pickProjectInternal,
      redirectUri
    ]
  );

  // Auto-load demo if requested
  useEffect(() => {
    if (adoDemoOnLoad) {
      handleConnect('demo', true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSetBranches = async (patch: Partial<AdoPickState>) => {
    setPickBusy('Finding Mermaid files…');
    setPickErr('');
    try {
      const ctx = { ...pick, ...patch };
      setPick(ctx);
      const path = await loadFilesForBranches(ctx, false);
      setPick((s) => ({ ...s, path }));
    } catch (e: unknown) {
      setPickErr(e instanceof Error ? e.message : String(e));
    }
    setPickBusy('');
  };

  const handleDoCompare = () => {
    if (!pick.path || !apiRef.current) return;
    const session: AdoActiveSession = {
      ...pick,
      mode: apiModeRef.current,
      authMethod: apiModeRef.current === 'live' ? authMethod : undefined,
      org: orgLabelRef.current
    };
    setModal(null);
    setAdo(session);
    loadComparison(session);
  };

  const handleUpdateAdo = async (patch: Partial<AdoActiveSession>, reloadFiles: boolean) => {
    if (!ado) return;
    let nextAdo: AdoActiveSession = { ...ado, ...patch };
    setAdo(nextAdo);
    setAdoErr('');
    try {
      if (reloadFiles) {
        setFetching(true);
        const path = await loadFilesForBranches(nextAdo, false);
        nextAdo = { ...nextAdo, path };
        setAdo(nextAdo);
      }
      await loadComparison(nextAdo);
    } catch (e: unknown) {
      setFetching(false);
      setAdoErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSelectBlock = (idx: number) => {
    const bl = blocksRef.current;
    fittedRef.current = {};
    setBlockIdx(idx);
    setSrcA(bl.a[idx] || '');
    setSrcB(bl.b[idx] || '');
    setSel(null);
  };

  const handleDisconnect = () => {
    apiRef.current = null;
    fittedRef.current = {};
    setAdo(null);
    setMissA(false);
    setMissB(false);
    setBlockCount(1);
    setAdoErr('');
    setFiles([]);
    setBranches([]);
    setProjects([]);
    setRepos([]);
    setPick({});
    setNameA('base.mmd');
    setNameB('compare.mmd');
  };

  // Derived values for UI
  const nodesCh = diff.nodes.filter((n) => n.status !== 'same');
  const edgesCh = diff.edges.filter((e) => e.status !== 'same');
  const allChanges = [...nodesCh, ...edgesCh];
  const cnt = (s: string) => allChanges.filter((x) => x.status === s).length;
  const stats = {
    add: cnt('add'),
    del: cnt('del'),
    mod: cnt('mod'),
    total: allChanges.length
  };

  const passFilter = (s: string) => filter === 'all' || filter === s;
  const filteredNodes = nodesCh.filter((n) => passFilter(n.status));
  const filteredEdges = edgesCh.filter((e) => passFilter(e.status));

  const queryLower = fileQuery.trim().toLowerCase();
  const shownFiles = files.filter(
    (f) => (!onlyChanged || f.change) && (!queryLower || f.path.toLowerCase().includes(queryLower))
  );
  const nChangedFiles = files.filter((f) => f.change).length;
  const sameBr = !!(pick.source && pick.source === pick.target);
  const canCompare = !!pick.path && !pickBusy;
  const stepDone = modal === 'pick';

  const ssoConfigured = !!effectiveClientId;
  const parsedCurrentOrg = parseAdoOrgInput(org).org;
  const canContinueConnect =
    !connecting &&
    (authMethod === 'pat'
      ? !!parsedCurrentOrg && !!pat.trim()
      : !!account && !!parsedCurrentOrg);

  const acctName = account ? account.name || account.username || '' : '';
  const acctInitials = acctName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0].toUpperCase())
    .join('');

  const br = modal ? pick : ado || {};
  const showMissA = !!ado && missA && !srcA.trim();
  const showMissB = !!ado && missB && !srcB.trim();

  const ts = (k: PaneKey) =>
    `translate(${transforms[k].x}px, ${transforms[k].y}px) scale(${transforms[k].s})`;
  const pct = (k: PaneKey) => Math.round(transforms[k].s * 100) + '%';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', minWidth: 760 }}>
      {/* Top Header */}
      <header
        style={{
          height: 56,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 16px',
          borderBottom: '1px solid #e3e1d9',
          background: '#fbfaf7'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: "'Geist Mono', monospace",
            fontWeight: 500,
            fontSize: 14,
            letterSpacing: '-0.01em'
          }}
        >
          <div style={{ width: 20, height: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <span style={{ background: '#191917', borderRadius: '3px 0 0 3px' }} />
            <span style={{ background: '#1f8a4c', borderRadius: '0 3px 3px 0' }} />
          </div>
          <span>
            mermaid<span style={{ color: '#a19f96' }}>/</span>diff
          </span>
        </div>

        <div style={{ display: 'flex', gap: 2, padding: 3, background: '#eceae4', borderRadius: 8 }}>
          {(
            [
              ['split', 'Split'],
              ['overlay', 'Merged'],
              ['source', 'Source']
            ] as Array<[ViewMode, string]>
          ).map(([id, label]) => {
            const active = view === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                style={{
                  height: 26,
                  padding: '0 12px',
                  border: 0,
                  borderRadius: 6,
                  font: '500 12.5px Geist, sans-serif',
                  cursor: 'pointer',
                  background: active ? '#fff' : 'transparent',
                  color: active ? '#191917' : '#6e6c64',
                  boxShadow: active ? '0 1px 2px rgba(25,25,23,0.12)' : 'none'
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: "'Geist Mono', monospace",
            fontSize: 12.5
          }}
        >
          <span
            title="Added"
            style={{
              padding: '3px 8px',
              whiteSpace: 'nowrap',
              borderRadius: 5,
              background: '#e2f3e7',
              color: '#146b39'
            }}
          >
            +{stats.add}
          </span>
          <span
            title="Removed"
            style={{
              padding: '3px 8px',
              whiteSpace: 'nowrap',
              borderRadius: 5,
              background: '#fbe5e2',
              color: '#a12a21'
            }}
          >
            −{stats.del}
          </span>
          <span
            title="Changed"
            style={{
              padding: '3px 8px',
              whiteSpace: 'nowrap',
              borderRadius: 5,
              background: '#fbefd3',
              color: '#7a5010'
            }}
          >
            ~{stats.mod}
          </span>
        </div>

        <div style={{ width: 1, height: 24, background: '#e3e1d9' }} />

        {!ado && (
          <button
            type="button"
            onClick={() => {
              setModal(apiRef.current ? 'pick' : 'connect');
              setConnErr('');
              restoreSession();
            }}
            title="Compare a file between branches in Azure DevOps"
            className="hover-bg-f4f3ef"
            style={{
              height: 30,
              padding: '0 10px',
              border: '1px solid #191917',
              background: '#fff',
              borderRadius: 6,
              font: '500 12.5px Geist, sans-serif',
              color: '#191917',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <span style={{ fontFamily: "'Geist Mono', monospace" }}>⎇</span>Azure DevOps
          </button>
        )}

        <button
          type="button"
          onClick={() => setSync((s) => !s)}
          title="Pan and zoom both sides together"
          style={{
            height: 30,
            padding: '0 10px',
            border: '1px solid #e3e1d9',
            background: '#fff',
            borderRadius: 6,
            font: '500 12.5px Geist, sans-serif',
            color: '#191917',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <span
            style={{
              width: 26,
              height: 16,
              borderRadius: 8,
              padding: 2,
              display: 'flex',
              background: sync ? '#191917' : '#d6d3c9',
              justifyContent: sync ? 'flex-end' : 'flex-start'
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 6, background: '#fff' }} />
          </span>
          Sync view
        </button>

        <button
          type="button"
          onClick={() => {
            fittedRef.current = {};
            setSrcA(srcB);
            setSrcB(srcA);
            setNameA(nameB);
            setNameB(nameA);
          }}
          title="Swap Base and Compare"
          className="hover-bg-f4f3ef"
          style={{
            height: 30,
            padding: '0 10px',
            border: '1px solid #e3e1d9',
            background: '#fff',
            borderRadius: 6,
            font: '500 12.5px Geist, sans-serif',
            color: '#191917',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flex: 'none'
          }}
        >
          ⇄ Swap
        </button>
      </header>

      {/* Connected Azure DevOps Sub-header Bar */}
      {ado && (
        <div
          style={{
            height: 50,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 16px',
            borderBottom: '1px solid #e3e1d9',
            background: '#f4f3ef',
            minWidth: 0,
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flex: '0 1 auto',
              minWidth: 60,
              overflow: 'hidden'
            }}
          >
            <span
              style={{
                flex: 'none',
                width: 22,
                height: 22,
                borderRadius: 5,
                background: '#191917',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                font: "500 13px 'Geist Mono', monospace"
              }}
            >
              ⎇
            </span>
            <span
              title={`${ado.org} / ${ado.projectName} / ${ado.repoName}`}
              style={{
                font: "12.5px 'Geist Mono', monospace",
                color: '#3a3934',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0
              }}
            >
              {ado.org} / {ado.projectName} / {ado.repoName}
            </span>
            <span
              style={{
                padding: '2px 7px',
                borderRadius: 4,
                background: '#e6e4dd',
                font: "500 11px 'Geist Mono', monospace",
                color: '#6e6c64',
                whiteSpace: 'nowrap',
                flex: 'none'
              }}
            >
              {ado.mode === 'demo' ? 'demo data' : 'live'}
            </span>
          </div>

          <span style={{ width: 1, height: 22, background: '#dcd9cf', flex: 'none' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            <span
              style={{
                flex: 'none',
                width: 20,
                height: 20,
                borderRadius: 4,
                background: '#1f8a4c',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                font: "500 11px 'Geist Mono', monospace"
              }}
            >
              B
            </span>
            <select
              value={br.source || ''}
              onChange={(e) => handleUpdateAdo({ source: e.target.value }, true)}
              title="Source branch"
              style={{
                height: 30,
                padding: '0 8px',
                border: '1px solid #e3e1d9',
                borderRadius: 6,
                background: '#fff',
                font: "500 12.5px 'Geist Mono', monospace",
                color: '#191917',
                cursor: 'pointer',
                flex: 'none',
                maxWidth: 170
              }}
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: '#6e6c64', padding: '0 2px', flex: 'none' }}>into</span>
            <span
              style={{
                flex: 'none',
                width: 20,
                height: 20,
                borderRadius: 4,
                background: '#191917',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                font: "500 11px 'Geist Mono', monospace"
              }}
            >
              A
            </span>
            <select
              value={br.target || ''}
              onChange={(e) => handleUpdateAdo({ target: e.target.value }, true)}
              title="Target branch"
              style={{
                height: 30,
                padding: '0 8px',
                border: '1px solid #e3e1d9',
                borderRadius: 6,
                background: '#fff',
                font: "500 12.5px 'Geist Mono', monospace",
                color: '#191917',
                cursor: 'pointer',
                flex: 'none',
                maxWidth: 130
              }}
            >
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <span style={{ width: 1, height: 22, background: '#dcd9cf', flex: 'none' }} />

          <select
            value={ado.path || ''}
            onChange={(e) => handleUpdateAdo({ path: e.target.value }, false)}
            title="File"
            style={{
              height: 30,
              padding: '0 8px',
              border: '1px solid #e3e1d9',
              borderRadius: 6,
              background: '#fff',
              font: "500 12.5px 'Geist Mono', monospace",
              color: '#191917',
              cursor: 'pointer',
              minWidth: 110,
              flex: '0 1 auto',
              maxWidth: 320
            }}
          >
            {files.map((f) => {
              const lbl = f.path.replace(/^\//, '') + (f.change ? '  · ' + CH[f.change].label : '');
              return (
                <option key={f.path} value={f.path}>
                  {lbl}
                </option>
              );
            })}
          </select>

          {blockCount > 1 && (
            <select
              value={String(blockIdx)}
              onChange={(e) => handleSelectBlock(Number(e.target.value))}
              title="Diagram in this file"
              style={{
                height: 30,
                padding: '0 8px',
                border: '1px solid #e3e1d9',
                borderRadius: 6,
                background: '#fff',
                font: "500 12.5px 'Geist Mono', monospace",
                color: '#191917',
                cursor: 'pointer',
                minWidth: 0,
                flex: 'none'
              }}
            >
              {Array.from({ length: blockCount }, (_, i) => (
                <option key={i} value={String(i)}>
                  Diagram {i + 1} of {blockCount}
                </option>
              ))}
            </select>
          )}

          {fetching && (
            <span style={{ fontSize: 12.5, color: '#6e6c64', whiteSpace: 'nowrap' }}>Fetching…</span>
          )}
          {adoErr && (
            <span style={{ fontSize: 12.5, color: '#a12a21', whiteSpace: 'nowrap' }}>{adoErr}</span>
          )}

          <div style={{ flex: 1 }} />

          <button
            type="button"
            onClick={() => handleUpdateAdo({}, true)}
            title="Refresh from Azure DevOps"
            className="hover-bg-fbfaf7"
            style={{
              width: 30,
              height: 30,
              flex: 'none',
              border: '1px solid #e3e1d9',
              background: '#fff',
              borderRadius: 6,
              cursor: 'pointer',
              font: '15px Geist, sans-serif',
              color: '#191917',
              display: 'grid',
              placeItems: 'center'
            }}
          >
            ↻
          </button>
          <button
            type="button"
            onClick={() => {
              setModal('pick');
              setPick({ ...ado });
              setPickErr('');
            }}
            className="hover-bg-fbfaf7"
            style={{
              height: 30,
              padding: '0 10px',
              border: '1px solid #e3e1d9',
              background: '#fff',
              borderRadius: 6,
              font: '500 12.5px Geist, sans-serif',
              color: '#191917',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flex: 'none'
            }}
          >
            Change…
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            title="Disconnect"
            className="hover-disconnect"
            style={{
              width: 30,
              height: 30,
              flex: 'none',
              border: '1px solid transparent',
              background: 'transparent',
              borderRadius: 6,
              cursor: 'pointer',
              font: '15px Geist, sans-serif',
              color: '#6e6c64',
              display: 'grid',
              placeItems: 'center'
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 312px'
        }}
      >
        <div style={{ position: 'relative', minWidth: 0, minHeight: 0 }}>
          {/* Split View */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: view === 'split' ? 'grid' : 'none',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: 1,
              background: '#e3e1d9'
            }}
          >
            {/* Side A */}
            <section
              style={{
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
                background: '#fbfaf7'
              }}
            >
              <div
                style={{
                  height: 44,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 10px 0 12px',
                  borderBottom: '1px solid #e3e1d9',
                  minWidth: 0,
                  overflow: 'hidden'
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: '#191917',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    font: "500 11px 'Geist Mono', monospace"
                  }}
                >
                  A
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {ado ? 'Target' : 'Base'}
                </span>
                <span
                  style={{
                    font: "12px 'Geist Mono', monospace",
                    color: '#6e6c64',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                    flex: '1 1 0'
                  }}
                >
                  {nameA}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    fittedRef.current.a = false;
                    fittedRef.current.b = false;
                    setEditA((v) => !v);
                  }}
                  style={{
                    height: 26,
                    padding: '0 8px',
                    border: '1px solid #e3e1d9',
                    borderRadius: 5,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flex: 'none',
                    font: '500 12px Geist, sans-serif',
                    background: editA ? '#191917' : '#fff',
                    color: editA ? '#fff' : '#191917'
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => fileARef.current?.click()}
                  style={{
                    height: 26,
                    padding: '0 8px',
                    border: '1px solid #191917',
                    background: '#191917',
                    color: '#fff',
                    borderRadius: 5,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flex: 'none',
                    font: '500 12px Geist, sans-serif'
                  }}
                >
                  Open file
                </button>
                <input
                  ref={fileARef}
                  type="file"
                  accept=".mmd,.mermaid,.md,.txt"
                  onChange={(e) => {
                    loadLocalFile('a', e.target.files?.[0]);
                    e.target.value = '';
                  }}
                  style={{ display: 'none' }}
                />
              </div>

              <div
                ref={paneARef}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  dragRef.current = { k: 'a', x: e.clientX, y: e.clientY };
                  setDragging('a');
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragA) setDragA(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragA(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragA(false);
                  loadLocalFile('a', e.dataTransfer.files?.[0]);
                }}
                style={{
                  flex: 1,
                  minHeight: 0,
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: dragging === 'a' ? 'grabbing' : 'grab',
                  backgroundColor: '#fbfaf7',
                  backgroundImage: 'radial-gradient(#dcd9cf 1px, transparent 1px)',
                  backgroundSize: '18px 18px'
                }}
              >
                <div
                  ref={svgARef}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    transformOrigin: '0 0',
                    transform: ts('a')
                  }}
                />
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    right: 12,
                    bottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    padding: 3,
                    background: '#fff',
                    border: '1px solid #e3e1d9',
                    borderRadius: 8,
                    boxShadow: '0 1px 3px rgba(25,25,23,0.08)',
                    zIndex: 2
                  }}
                >
                  <button
                    type="button"
                    onClick={() => zoomBtn('a', 0.8)}
                    className="hover-bg-f0eee8"
                    style={{
                      width: 26,
                      height: 26,
                      border: 0,
                      background: 'transparent',
                      borderRadius: 5,
                      cursor: 'pointer',
                      font: '15px Geist, sans-serif',
                      color: '#191917'
                    }}
                  >
                    −
                  </button>
                  <span
                    style={{
                      width: 42,
                      textAlign: 'center',
                      font: "12px 'Geist Mono', monospace",
                      color: '#6e6c64'
                    }}
                  >
                    {pct('a')}
                  </span>
                  <button
                    type="button"
                    onClick={() => zoomBtn('a', 1.25)}
                    className="hover-bg-f0eee8"
                    style={{
                      width: 26,
                      height: 26,
                      border: 0,
                      background: 'transparent',
                      borderRadius: 5,
                      cursor: 'pointer',
                      font: '15px Geist, sans-serif',
                      color: '#191917'
                    }}
                  >
                    +
                  </button>
                  <span style={{ width: 1, height: 16, background: '#e3e1d9' }} />
                  <button
                    type="button"
                    onClick={() => (sync ? fitSplit() : fit('a'))}
                    className="hover-bg-f0eee8"
                    style={{
                      height: 26,
                      padding: '0 8px',
                      border: 0,
                      background: 'transparent',
                      borderRadius: 5,
                      cursor: 'pointer',
                      font: '500 12px Geist, sans-serif',
                      color: '#191917'
                    }}
                  >
                    Fit
                  </button>
                </div>

                {errA && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 16,
                      right: 16,
                      top: 16,
                      padding: '12px 14px',
                      border: '1px solid #e9b7b1',
                      background: '#fdf3f2',
                      borderRadius: 8,
                      font: "12px/1.5 'Geist Mono', monospace",
                      color: '#a12a21',
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {errA}
                  </div>
                )}

                {loading && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 13,
                      color: '#6e6c64'
                    }}
                  >
                    Loading renderer…
                  </div>
                )}

                {showMissA && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      pointerEvents: 'none'
                    }}
                  >
                    <div
                      style={{
                        maxWidth: 280,
                        padding: '18px 20px',
                        border: '1px dashed #cfccc2',
                        borderRadius: 10,
                        background: '#fbfaf7',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600 }}>Not on {ado?.target}</span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#6e6c64' }}>
                        This file is new — it only exists on {ado?.source}.
                      </span>
                    </div>
                  </div>
                )}

                {fetching && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(251,250,247,0.7)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 13,
                      color: '#6e6c64'
                    }}
                  >
                    Fetching from {br.target || 'target'}…
                  </div>
                )}

                {dragA && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 10,
                      border: '1.5px dashed #191917',
                      borderRadius: 10,
                      background: 'rgba(251,250,247,0.9)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 14,
                      fontWeight: 500,
                      pointerEvents: 'none'
                    }}
                  >
                    Drop to replace Base
                  </div>
                )}
              </div>

              {editA && (
                <textarea
                  value={srcA}
                  onChange={(e) => setSrcA(e.target.value)}
                  spellCheck={false}
                  style={{
                    flex: 'none',
                    height: 240,
                    resize: 'vertical',
                    border: 0,
                    borderTop: '1px solid #e3e1d9',
                    padding: '12px 14px',
                    font: "12.5px/1.6 'Geist Mono', monospace",
                    color: '#191917',
                    background: '#fff',
                    outline: 'none'
                  }}
                />
              )}
            </section>

            {/* Side B */}
            <section
              style={{
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
                background: '#fbfaf7'
              }}
            >
              <div
                style={{
                  height: 44,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 10px 0 12px',
                  borderBottom: '1px solid #e3e1d9',
                  minWidth: 0,
                  overflow: 'hidden'
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: '#1f8a4c',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    font: "500 11px 'Geist Mono', monospace"
                  }}
                >
                  B
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {ado ? 'Source' : 'Compare'}
                </span>
                <span
                  style={{
                    font: "12px 'Geist Mono', monospace",
                    color: '#6e6c64',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                    flex: '1 1 0'
                  }}
                >
                  {nameB}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    fittedRef.current.a = false;
                    fittedRef.current.b = false;
                    setEditB((v) => !v);
                  }}
                  style={{
                    height: 26,
                    padding: '0 8px',
                    border: '1px solid #e3e1d9',
                    borderRadius: 5,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flex: 'none',
                    font: '500 12px Geist, sans-serif',
                    background: editB ? '#191917' : '#fff',
                    color: editB ? '#fff' : '#191917'
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => fileBRef.current?.click()}
                  style={{
                    height: 26,
                    padding: '0 8px',
                    border: '1px solid #191917',
                    background: '#191917',
                    color: '#fff',
                    borderRadius: 5,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flex: 'none',
                    font: '500 12px Geist, sans-serif'
                  }}
                >
                  Open file
                </button>
                <input
                  ref={fileBRef}
                  type="file"
                  accept=".mmd,.mermaid,.md,.txt"
                  onChange={(e) => {
                    loadLocalFile('b', e.target.files?.[0]);
                    e.target.value = '';
                  }}
                  style={{ display: 'none' }}
                />
              </div>

              <div
                ref={paneBRef}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  dragRef.current = { k: 'b', x: e.clientX, y: e.clientY };
                  setDragging('b');
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragB) setDragB(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragB(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragB(false);
                  loadLocalFile('b', e.dataTransfer.files?.[0]);
                }}
                style={{
                  flex: 1,
                  minHeight: 0,
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: dragging === 'b' ? 'grabbing' : 'grab',
                  backgroundColor: '#fbfaf7',
                  backgroundImage: 'radial-gradient(#dcd9cf 1px, transparent 1px)',
                  backgroundSize: '18px 18px'
                }}
              >
                <div
                  ref={svgBRef}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    transformOrigin: '0 0',
                    transform: ts('b')
                  }}
                />
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    right: 12,
                    bottom: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    padding: 3,
                    background: '#fff',
                    border: '1px solid #e3e1d9',
                    borderRadius: 8,
                    boxShadow: '0 1px 3px rgba(25,25,23,0.08)',
                    zIndex: 2
                  }}
                >
                  <button
                    type="button"
                    onClick={() => zoomBtn('b', 0.8)}
                    className="hover-bg-f0eee8"
                    style={{
                      width: 26,
                      height: 26,
                      border: 0,
                      background: 'transparent',
                      borderRadius: 5,
                      cursor: 'pointer',
                      font: '15px Geist, sans-serif',
                      color: '#191917'
                    }}
                  >
                    −
                  </button>
                  <span
                    style={{
                      width: 42,
                      textAlign: 'center',
                      font: "12px 'Geist Mono', monospace",
                      color: '#6e6c64'
                    }}
                  >
                    {pct('b')}
                  </span>
                  <button
                    type="button"
                    onClick={() => zoomBtn('b', 1.25)}
                    className="hover-bg-f0eee8"
                    style={{
                      width: 26,
                      height: 26,
                      border: 0,
                      background: 'transparent',
                      borderRadius: 5,
                      cursor: 'pointer',
                      font: '15px Geist, sans-serif',
                      color: '#191917'
                    }}
                  >
                    +
                  </button>
                  <span style={{ width: 1, height: 16, background: '#e3e1d9' }} />
                  <button
                    type="button"
                    onClick={() => (sync ? fitSplit() : fit('b'))}
                    className="hover-bg-f0eee8"
                    style={{
                      height: 26,
                      padding: '0 8px',
                      border: 0,
                      background: 'transparent',
                      borderRadius: 5,
                      cursor: 'pointer',
                      font: '500 12px Geist, sans-serif',
                      color: '#191917'
                    }}
                  >
                    Fit
                  </button>
                </div>

                {errB && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 16,
                      right: 16,
                      top: 16,
                      padding: '12px 14px',
                      border: '1px solid #e9b7b1',
                      background: '#fdf3f2',
                      borderRadius: 8,
                      font: "12px/1.5 'Geist Mono', monospace",
                      color: '#a12a21',
                      whiteSpace: 'pre-wrap'
                    }}
                  >
                    {errB}
                  </div>
                )}

                {loading && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 13,
                      color: '#6e6c64'
                    }}
                  >
                    Loading renderer…
                  </div>
                )}

                {showMissB && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      pointerEvents: 'none'
                    }}
                  >
                    <div
                      style={{
                        maxWidth: 280,
                        padding: '18px 20px',
                        border: '1px dashed #cfccc2',
                        borderRadius: 10,
                        background: '#fbfaf7',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600 }}>Deleted on {ado?.source}</span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: '#6e6c64' }}>
                        This file exists on {ado?.target} but was removed on the source branch.
                      </span>
                    </div>
                  </div>
                )}

                {fetching && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(251,250,247,0.7)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 13,
                      color: '#6e6c64'
                    }}
                  >
                    Fetching from {br.source || 'source'}…
                  </div>
                )}

                {dragB && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 10,
                      border: '1.5px dashed #191917',
                      borderRadius: 10,
                      background: 'rgba(251,250,247,0.9)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 14,
                      fontWeight: 500,
                      pointerEvents: 'none'
                    }}
                  >
                    Drop to replace Compare
                  </div>
                )}
              </div>

              {editB && (
                <textarea
                  value={srcB}
                  onChange={(e) => setSrcB(e.target.value)}
                  spellCheck={false}
                  style={{
                    flex: 'none',
                    height: 240,
                    resize: 'vertical',
                    border: 0,
                    borderTop: '1px solid #e3e1d9',
                    padding: '12px 14px',
                    font: "12.5px/1.6 'Geist Mono', monospace",
                    color: '#191917',
                    background: '#fff',
                    outline: 'none'
                  }}
                />
              )}
            </section>
          </div>

          {/* Merged / Overlay View */}
          <section
            style={{
              position: 'absolute',
              inset: 0,
              display: view === 'overlay' ? 'flex' : 'none',
              flexDirection: 'column',
              background: '#fbfaf7'
            }}
          >
            <div
              style={{
                height: 44,
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 10px 0 12px',
                borderBottom: '1px solid #e3e1d9'
              }}
            >
              <span style={{ display: 'flex' }}>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '4px 0 0 4px',
                    background: '#191917',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    font: "500 11px 'Geist Mono', monospace"
                  }}
                >
                  A
                </span>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '0 4px 4px 0',
                    background: '#1f8a4c',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    font: "500 11px 'Geist Mono', monospace"
                  }}
                >
                  B
                </span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Merged</span>
              <span style={{ fontSize: 12.5, color: '#6e6c64' }}>
                Both versions in one graph. Removed items are dashed.
              </span>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => zoomBtn('o', 0.8)}
                style={{
                  width: 26,
                  height: 26,
                  border: '1px solid #e3e1d9',
                  background: '#fff',
                  borderRadius: 5,
                  cursor: 'pointer',
                  font: '14px Geist, sans-serif',
                  color: '#191917'
                }}
              >
                −
              </button>
              <span
                style={{
                  width: 40,
                  flex: 'none',
                  textAlign: 'center',
                  font: "12px 'Geist Mono', monospace",
                  color: '#6e6c64'
                }}
              >
                {pct('o')}
              </span>
              <button
                type="button"
                onClick={() => zoomBtn('o', 1.25)}
                style={{
                  width: 26,
                  height: 26,
                  border: '1px solid #e3e1d9',
                  background: '#fff',
                  borderRadius: 5,
                  cursor: 'pointer',
                  font: '14px Geist, sans-serif',
                  color: '#191917'
                }}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => fit('o')}
                style={{
                  height: 26,
                  padding: '0 8px',
                  border: '1px solid #e3e1d9',
                  background: '#fff',
                  borderRadius: 5,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flex: 'none',
                  font: '500 12px Geist, sans-serif',
                  color: '#191917'
                }}
              >
                Fit
              </button>
            </div>
            <div
              ref={paneORef}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                dragRef.current = { k: 'o', x: e.clientX, y: e.clientY };
                setDragging('o');
              }}
              style={{
                flex: 1,
                minHeight: 0,
                position: 'relative',
                overflow: 'hidden',
                cursor: dragging === 'o' ? 'grabbing' : 'grab',
                backgroundColor: '#fbfaf7',
                backgroundImage: 'radial-gradient(#dcd9cf 1px, transparent 1px)',
                backgroundSize: '18px 18px'
              }}
            >
              <div
                ref={svgORef}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transformOrigin: '0 0',
                  transform: ts('o')
                }}
              />
              {errO && (
                <div
                  style={{
                    position: 'absolute',
                    left: 16,
                    right: 16,
                    top: 16,
                    padding: '12px 14px',
                    border: '1px solid #e3e1d9',
                    background: '#fff',
                    borderRadius: 8,
                    font: '13px/1.5 Geist, sans-serif',
                    color: '#6e6c64',
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {errO}
                </div>
              )}
            </div>
          </section>

          {/* Source View */}
          <section
            style={{
              position: 'absolute',
              inset: 0,
              display: view === 'source' ? 'flex' : 'none',
              flexDirection: 'column',
              background: '#fff'
            }}
          >
            <div
              style={{
                height: 44,
                flex: 'none',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                borderBottom: '1px solid #e3e1d9',
                background: '#fbfaf7'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 12px',
                  borderRight: '1px solid #e3e1d9'
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: '#191917',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    font: "500 11px 'Geist Mono', monospace"
                  }}
                >
                  A
                </span>
                <span style={{ font: "12px 'Geist Mono', monospace", color: '#6e6c64' }}>{nameA}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: '#1f8a4c',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    font: "500 11px 'Geist Mono', monospace"
                  }}
                >
                  B
                </span>
                <span style={{ font: "12px 'Geist Mono', monospace", color: '#6e6c64' }}>{nameB}</span>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', font: "12.5px/1.75 'Geist Mono', monospace" }}>
              {diff.rows.map((r, i) => (
                <div
                  key={i}
                  style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) 44px minmax(0, 1fr)' }}
                >
                  <span
                    style={{
                      padding: '0 10px 0 0',
                      textAlign: 'right',
                      color: '#a19f96',
                      userSelect: 'none',
                      background: r.gA
                    }}
                  >
                    {r.la}
                  </span>
                  <span
                    style={{
                      padding: '0 12px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      borderRight: '1px solid #e3e1d9',
                      background: r.bA,
                      color: r.cA
                    }}
                  >
                    {r.ta}
                  </span>
                  <span
                    style={{
                      padding: '0 10px 0 0',
                      textAlign: 'right',
                      color: '#a19f96',
                      userSelect: 'none',
                      background: r.gB
                    }}
                  >
                    {r.lb}
                  </span>
                  <span
                    style={{
                      padding: '0 12px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      background: r.bB,
                      color: r.cB
                    }}
                  >
                    {r.tb}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Sidebar */}
        <aside
          style={{
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid #e3e1d9',
            background: '#fbfaf7'
          }}
        >
          <div
            style={{
              padding: '16px 16px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              borderBottom: '1px solid #e3e1d9'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Changes</span>
              <span style={{ font: "12px 'Geist Mono', monospace", color: '#6e6c64' }}>{stats.total}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(
                [
                  ['all', 'All', stats.total],
                  ['add', 'Added', stats.add],
                  ['del', 'Removed', stats.del],
                  ['mod', 'Changed', stats.mod]
                ] as Array<[DiffFilter, string, number]>
              ).map(([id, label, n]) => {
                const on = filter === id;
                const c = id !== 'all' ? COL[id] : undefined;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilter(id)}
                    style={{
                      height: 26,
                      padding: '0 9px',
                      borderRadius: 13,
                      font: '500 12px Geist, sans-serif',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      border: `1px solid ${on ? (c ? c.stroke : '#191917') : '#e3e1d9'}`,
                      background: on ? (c ? c.fill : '#191917') : '#fff',
                      color: on ? (c ? c.ink : '#fff') : '#3a3934'
                    }}
                  >
                    {label}
                    <span style={{ fontFamily: "'Geist Mono', monospace", opacity: 0.7 }}>{n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 8px 16px' }}>
            {!diff.flow && (
              <div
                style={{
                  margin: 8,
                  padding: 12,
                  border: '1px solid #e3e1d9',
                  borderRadius: 8,
                  background: '#fff',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: '#6e6c64'
                }}
              >
                Visual highlighting works on{' '}
                <span style={{ fontFamily: "'Geist Mono', monospace", color: '#191917' }}>flowchart</span> /{' '}
                <span style={{ fontFamily: "'Geist Mono', monospace", color: '#191917' }}>graph</span> diagrams. For{' '}
                <span style={{ fontFamily: "'Geist Mono', monospace", color: '#191917' }}>
                  {diff.A.isFlow === false ? diff.A.type : diff.B.type || ''}
                </span>
                , use the Source view to see line changes.
              </div>
            )}

            {diff.flow && allChanges.length === 0 && (
              <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: '#6e6c64' }}>
                No structural differences.
              </div>
            )}

            {filteredNodes.length > 0 && (
              <>
                <div
                  style={{
                    padding: '10px 8px 6px',
                    font: "500 11px 'Geist Mono', monospace",
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: '#a19f96'
                  }}
                >
                  Nodes
                </div>
                {filteredNodes.map((n) => {
                  const key = 'n:' + n.id;
                  const c = COL[n.status as 'add' | 'del' | 'mod'];
                  let sub = '';
                  if (n.status === 'mod') {
                    const parts: string[] = [];
                    if (n.la !== n.lb) parts.push(`was “${n.la}”`);
                    if (n.sa !== n.sb) parts.push(`${n.sa} → ${n.sb}`);
                    sub = parts.join(' · ');
                  }
                  const title = n.status === 'del' ? nodeLabel(n.a) : nodeLabel(n.b);
                  const meta = n.id + (n.status === 'mod' ? '' : ' · ' + ((n.a || n.b)?.shape || 'rectangle'));
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => focusItem({ kind: 'node', id: n.id, key, status: n.status })}
                      className="hover-bg-f0eee8"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'grid',
                        gridTemplateColumns: '22px minmax(0, 1fr)',
                        gap: 10,
                        alignItems: 'start',
                        padding: 8,
                        border: 0,
                        borderRadius: 7,
                        cursor: 'pointer',
                        fontFamily: 'Geist, sans-serif',
                        background: sel === key ? '#ebe9e2' : 'transparent'
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 5,
                          display: 'grid',
                          placeItems: 'center',
                          font: "500 13px 'Geist Mono', monospace",
                          background: c.fill,
                          color: c.ink
                        }}
                      >
                        {c.sym}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: '#191917' }}>{title}</span>
                        <span style={{ font: "11.5px 'Geist Mono', monospace", color: '#6e6c64' }}>{meta}</span>
                        {sub && <span style={{ fontSize: 12, color: '#6e6c64' }}>{sub}</span>}
                      </span>
                    </button>
                  );
                })}
              </>
            )}

            {filteredEdges.length > 0 && (
              <>
                <div
                  style={{
                    padding: '14px 8px 6px',
                    font: "500 11px 'Geist Mono', monospace",
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: '#a19f96'
                  }}
                >
                  Connections
                </div>
                {filteredEdges.map((e) => {
                  const src = (e.b || e.a)!.e;
                  const key = 'e:' + e.key;
                  const c = COL[e.status as 'add' | 'del' | 'mod'];
                  let sub = cleanLabel(src.label) ? `“${cleanLabel(src.label)}”` : '';
                  if (e.status === 'mod' && e.a && e.b) {
                    const la = cleanLabel(e.a.e.label) || '';
                    const lb = cleanLabel(e.b.e.label) || '';
                    const parts: string[] = [];
                    if (la !== lb) {
                      parts.push(
                        la && lb ? `label “${la}” → “${lb}”` : lb ? `label added “${lb}”` : `label removed “${la}”`
                      );
                    }
                    if (edgeSig(e.a.e) !== edgeSig(e.b.e)) {
                      parts.push(`${edgeTypeName(e.a.e.t)} → ${edgeTypeName(e.b.e.t)}`);
                    }
                    sub = parts.join(' · ');
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        focusItem({
                          kind: 'edge',
                          pair: [src.from, src.to],
                          occ: (e.b || e.a)!.occ,
                          key,
                          status: e.status
                        })
                      }
                      className="hover-bg-f0eee8"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'grid',
                        gridTemplateColumns: '22px minmax(0, 1fr)',
                        gap: 10,
                        alignItems: 'start',
                        padding: 8,
                        border: 0,
                        borderRadius: 7,
                        cursor: 'pointer',
                        fontFamily: 'Geist, sans-serif',
                        background: sel === key ? '#ebe9e2' : 'transparent'
                      }}
                    >
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 5,
                          display: 'grid',
                          placeItems: 'center',
                          font: "500 13px 'Geist Mono', monospace",
                          background: c.fill,
                          color: c.ink
                        }}
                      >
                        {c.sym}
                      </span>
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span
                          style={{
                            font: "500 12.5px 'Geist Mono', monospace",
                            color: '#191917',
                            wordBreak: 'break-word'
                          }}
                        >
                          {src.from} → {src.to}
                        </span>
                        {sub && <span style={{ fontSize: 12, color: '#6e6c64' }}>{sub}</span>}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </div>

          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid #e3e1d9',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 12,
              color: '#6e6c64'
            }}
          >
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: '#e2f3e7',
                    border: '1.5px solid #1f8a4c'
                  }}
                />
                Added
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: '#fbe5e2',
                    border: '1.5px solid #c8372d'
                  }}
                />
                Removed
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: '#fbefd3',
                    border: '1.5px solid #b7791f'
                  }}
                />
                Changed
              </span>
            </div>
            <div>Scroll to zoom · drag to pan · drop a .mmd or .md file on a side</div>
          </div>
        </aside>
      </main>

      {/* Azure DevOps Connect & Pick Modal */}
      {modal && (
        <div
          onMouseDown={() => setModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(25,25,23,0.32)',
            display: 'grid',
            placeItems: 'center',
            padding: 24
          }}
        >
          {modal === 'connect' && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 520,
                maxHeight: 'calc(100vh - 48px)',
                background: '#fbfaf7',
                border: '1px solid #e3e1d9',
                borderRadius: 12,
                boxShadow: '0 20px 50px rgba(25,25,23,0.22)',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {/* Modal Stepper Header */}
              <div style={{ padding: '14px 16px 14px 20px', borderBottom: '1px solid #e3e1d9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 500 }}>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      color: stepDone ? '#6e6c64' : '#191917'
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        font: "500 11px 'Geist Mono', monospace",
                        background: stepDone ? '#1f8a4c' : '#191917',
                        color: '#fff'
                      }}
                    >
                      {stepDone ? '✓' : '1'}
                    </span>
                    Connect
                  </span>
                  <span style={{ width: 24, height: 1, background: '#dcd9cf' }} />
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      color: stepDone ? '#191917' : '#a19f96'
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        font: "500 11px 'Geist Mono', monospace",
                        background: stepDone ? '#191917' : '#e6e4dd',
                        color: stepDone ? '#fff' : '#8a887f'
                      }}
                    >
                      2
                    </span>
                    Choose file
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    title="Close"
                    className="hover-bg-ebe9e2"
                    style={{
                      width: 28,
                      height: 28,
                      border: 0,
                      background: 'transparent',
                      borderRadius: 6,
                      cursor: 'pointer',
                      font: '18px Geist, sans-serif',
                      color: '#6e6c64'
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Modal Body */}
              <div
                style={{
                  padding: '22px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 18,
                  minHeight: 0,
                  overflow: 'auto'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>
                    Connect to Azure DevOps
                  </span>
                  <span style={{ fontSize: 13, lineHeight: 1.5, color: '#6e6c64' }}>
                    Compare a Mermaid file on a branch against its target branch — the before and after of a pull
                    request.
                  </span>
                </div>

                {/* Auth Method Switcher (Personal Access Token vs Microsoft Entra ID SSO) */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 2,
                    padding: 3,
                    background: '#eceae4',
                    borderRadius: 8
                  }}
                >
                  {(
                    [
                      ['pat', 'Personal access token'],
                      ['sso', 'Microsoft Entra ID (SSO)']
                    ] as Array<[AuthMethod, string]>
                  ).map(([m, label]) => {
                    const active = authMethod === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          setAuthMethod(m);
                          setConnErr('');
                        }}
                        style={{
                          height: 28,
                          padding: '0 10px',
                          border: 0,
                          borderRadius: 6,
                          font: '500 12.5px Geist, sans-serif',
                          cursor: 'pointer',
                          background: active ? '#fff' : 'transparent',
                          color: active ? '#191917' : '#6e6c64',
                          boxShadow: active ? '0 1px 2px rgba(25,25,23,0.12)' : 'none'
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {authMethod === 'pat' ? (
                  <>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#3a3934' }}>Organization</span>
                      <span
                        style={{
                          display: 'flex',
                          height: 36,
                          border: '1px solid #e3e1d9',
                          borderRadius: 7,
                          background: '#fff',
                          overflow: 'hidden'
                        }}
                      >
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 10px',
                            background: '#f4f3ef',
                            borderRight: '1px solid #e3e1d9',
                            font: "12.5px 'Geist Mono', monospace",
                            color: '#6e6c64'
                          }}
                        >
                          dev.azure.com/
                        </span>
                        <input
                          value={org}
                          onChange={(e) => setOrg(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && canContinueConnect) handleConnect('live');
                          }}
                          placeholder="your-org"
                          spellCheck={false}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            border: 0,
                            outline: 'none',
                            padding: '0 10px',
                            font: "13px 'Geist Mono', monospace",
                            color: '#191917',
                            background: 'transparent'
                          }}
                        />
                      </span>
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#3a3934' }}>
                        Personal access token
                      </span>
                      <input
                        type="password"
                        value={pat}
                        onChange={(e) => setPat(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canContinueConnect) handleConnect('live');
                        }}
                        placeholder="Paste token"
                        spellCheck={false}
                        style={{
                          height: 36,
                          border: '1px solid #e3e1d9',
                          borderRadius: 7,
                          background: '#fff',
                          outline: 'none',
                          padding: '0 10px',
                          font: "13px 'Geist Mono', monospace",
                          color: '#191917'
                        }}
                      />
                      <span style={{ fontSize: 12, lineHeight: 1.5, color: '#6e6c64' }}>
                        Needs <strong style={{ color: '#191917', fontWeight: 600 }}>Code → Read</strong> scope. Kept
                        in memory for this tab only.
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    {!ssoConfigured && (
                      <div
                        style={{
                          padding: '12px 14px',
                          border: '1px solid #e9d3a6',
                          background: '#fdf7ea',
                          borderRadius: 8,
                          fontSize: 12.5,
                          lineHeight: 1.55,
                          color: '#5e3d0c',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600 }}>Single sign-on isn't set up yet</span>
                          <button
                            type="button"
                            onClick={() => setShowSsoConfig((v) => !v)}
                            style={{
                              border: 0,
                              background: 'transparent',
                              color: '#5e3d0c',
                              font: '500 12px Geist, sans-serif',
                              textDecoration: 'underline',
                              cursor: 'pointer',
                              padding: 0
                            }}
                          >
                            {showSsoConfig ? 'Hide setup' : 'Enter Client ID'}
                          </button>
                        </div>
                        <span>
                          An admin registers a single-page app in Microsoft Entra ID, adds the Azure DevOps{' '}
                          <span style={{ fontFamily: "'Geist Mono', monospace" }}>user_impersonation</span>{' '}
                          permission and this redirect URI, then enters the Client ID:
                        </span>
                        <span
                          style={{
                            font: "12px 'Geist Mono', monospace",
                            padding: '6px 8px',
                            background: '#fff',
                            border: '1px solid #e9d3a6',
                            borderRadius: 5,
                            wordBreak: 'break-all',
                            color: '#191917'
                          }}
                        >
                          {redirectUri}
                        </span>
                      </div>
                    )}

                    {(showSsoConfig || ssoConfigured) && (
                      <div
                        style={{
                          padding: '10px 12px',
                          border: '1px solid #e3e1d9',
                          borderRadius: 8,
                          background: '#fff',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8
                        }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8 }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#6e6c64' }}>
                              Entra Application (Client) ID
                            </span>
                            <input
                              type="text"
                              value={customClientId || propSsoClientId}
                              onChange={(e) => saveCustomSsoSettings(e.target.value, customTenantId)}
                              placeholder="00000000-0000-0000-0000-000000000000"
                              spellCheck={false}
                              style={{
                                height: 32,
                                border: '1px solid #e3e1d9',
                                borderRadius: 6,
                                padding: '0 8px',
                                font: "12px 'Geist Mono', monospace",
                                color: '#191917',
                                outline: 'none'
                              }}
                            />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#6e6c64' }}>Tenant ID</span>
                            <input
                              type="text"
                              value={customTenantId}
                              onChange={(e) => saveCustomSsoSettings(customClientId, e.target.value)}
                              placeholder="organizations"
                              spellCheck={false}
                              style={{
                                height: 32,
                                border: '1px solid #e3e1d9',
                                borderRadius: 6,
                                padding: '0 8px',
                                font: "12px 'Geist Mono', monospace",
                                color: '#191917',
                                outline: 'none'
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#3a3934' }}>Account</span>
                      {!account ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSignIn(false)}
                            style={{
                              height: 40,
                              border: '1px solid #191917',
                              background: ssoConfigured ? '#191917' : '#8a887f',
                              color: '#fff',
                              borderRadius: 7,
                              font: '500 13.5px Geist, sans-serif',
                              cursor: ssoConfigured ? 'pointer' : 'not-allowed',
                              opacity: ssoConfigured ? 1 : 0.6,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 10
                            }}
                          >
                            {signingIn ? 'Waiting for Microsoft sign-in…' : 'Sign in with Microsoft'}
                          </button>
                          <span style={{ fontSize: 12, lineHeight: 1.5, color: '#6e6c64' }}>
                            Uses your work account through Microsoft Entra ID. Access follows your Azure DevOps
                            permissions.
                          </span>
                        </>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '10px 12px',
                            border: '1px solid #e3e1d9',
                            borderRadius: 8,
                            background: '#fff'
                          }}
                        >
                          <span
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 16,
                              background: '#191917',
                              color: '#fff',
                              display: 'grid',
                              placeItems: 'center',
                              font: '500 12px Geist, sans-serif',
                              flex: 'none'
                            }}
                          >
                            {acctInitials}
                          </span>
                          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                            >
                              {acctName}
                            </span>
                            <span
                              style={{
                                font: "12px 'Geist Mono', monospace",
                                color: '#6e6c64',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis'
                              }}
                            >
                              {account.username}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSignIn(true)}
                            className="hover-bg-f4f3ef"
                            style={{
                              height: 28,
                              padding: '0 10px',
                              border: '1px solid #e3e1d9',
                              background: '#fff',
                              borderRadius: 6,
                              font: '500 12px Geist, sans-serif',
                              color: '#191917',
                              cursor: 'pointer',
                              flex: 'none'
                            }}
                          >
                            Switch
                          </button>
                          <button
                            type="button"
                            onClick={handleSignOut}
                            style={{
                              height: 28,
                              padding: '0 6px',
                              border: 0,
                              background: 'transparent',
                              font: '500 12px Geist, sans-serif',
                              color: '#6e6c64',
                              cursor: 'pointer',
                              flex: 'none'
                            }}
                          >
                            Sign out
                          </button>
                        </div>
                      )}
                    </div>

                    {account && (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#3a3934' }}>Organization</span>
                        {orgs.length > 0 ? (
                          <select
                            value={org}
                            onChange={(e) => setOrg(e.target.value)}
                            style={{
                              height: 36,
                              width: '100%',
                              padding: '0 10px',
                              border: '1px solid #e3e1d9',
                              borderRadius: 7,
                              background: '#fff',
                              font: "13px 'Geist Mono', monospace",
                              color: '#191917'
                            }}
                          >
                            {orgs.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          !orgsBusy && (
                            <span
                              style={{
                                display: 'flex',
                                height: 36,
                                border: '1px solid #e3e1d9',
                                borderRadius: 7,
                                background: '#fff',
                                overflow: 'hidden'
                              }}
                            >
                              <span
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '0 10px',
                                  background: '#f4f3ef',
                                  borderRight: '1px solid #e3e1d9',
                                  font: "12.5px 'Geist Mono', monospace",
                                  color: '#6e6c64'
                                }}
                              >
                                dev.azure.com/
                              </span>
                              <input
                                value={org}
                                onChange={(e) => setOrg(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && canContinueConnect) handleConnect('live');
                                }}
                                placeholder="your-org"
                                spellCheck={false}
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  border: 0,
                                  outline: 'none',
                                  padding: '0 10px',
                                  font: "13px 'Geist Mono', monospace",
                                  color: '#191917',
                                  background: 'transparent'
                                }}
                              />
                            </span>
                          )
                        )}
                        <span style={{ fontSize: 12, color: '#6e6c64' }}>
                          {orgsBusy
                            ? 'Finding your organizations…'
                            : orgs.length
                              ? `${orgs.length} organization${orgs.length > 1 ? 's' : ''} for this account`
                              : orgsFailed
                                ? 'Couldn’t list organizations automatically — type the name.'
                                : ''}
                        </span>
                      </label>
                    )}
                  </>
                )}

                {connErr && (
                  <div
                    style={{
                      padding: '10px 12px',
                      border: '1px solid #e9b7b1',
                      background: '#fdf3f2',
                      borderRadius: 8,
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: '#a12a21'
                    }}
                  >
                    {connErr}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  padding: '14px 20px',
                  borderTop: '1px solid #e3e1d9',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <button
                  type="button"
                  onClick={() => handleConnect('demo')}
                  style={{
                    height: 34,
                    padding: '0 4px',
                    border: 0,
                    background: 'transparent',
                    font: '500 13px Geist, sans-serif',
                    color: '#191917',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: 3,
                    textDecorationColor: '#cfccc2'
                  }}
                >
                  {connecting === 'demo' ? 'Loading demo…' : 'Try with demo data'}
                </button>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  style={{
                    height: 34,
                    padding: '0 14px',
                    border: '1px solid #e3e1d9',
                    background: '#fff',
                    borderRadius: 7,
                    font: '500 13px Geist, sans-serif',
                    color: '#191917',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConnect('live')}
                  style={{
                    height: 34,
                    padding: '0 16px',
                    border: '1px solid #191917',
                    background: '#191917',
                    borderRadius: 7,
                    font: '500 13px Geist, sans-serif',
                    color: '#fff',
                    cursor: canContinueConnect ? 'pointer' : 'not-allowed',
                    opacity: canContinueConnect ? 1 : 0.4
                  }}
                >
                  {connecting === 'live' ? 'Connecting…' : authMethod === 'pat' ? 'Connect' : 'Continue'}
                </button>
              </div>
            </div>
          )}

          {modal === 'pick' && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 720,
                maxHeight: 'calc(100vh - 48px)',
                background: '#fbfaf7',
                border: '1px solid #e3e1d9',
                borderRadius: 12,
                boxShadow: '0 20px 50px rgba(25,25,23,0.22)',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {/* Stepper Header */}
              <div style={{ padding: '14px 16px 14px 20px', borderBottom: '1px solid #e3e1d9', flex: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 500 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#6e6c64' }}>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        font: "500 11px 'Geist Mono', monospace",
                        background: '#1f8a4c',
                        color: '#fff'
                      }}
                    >
                      ✓
                    </span>
                    Connect
                  </span>
                  <span style={{ width: 24, height: 1, background: '#dcd9cf' }} />
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#191917' }}>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        font: "500 11px 'Geist Mono', monospace",
                        background: '#191917',
                        color: '#fff'
                      }}
                    >
                      2
                    </span>
                    Choose file
                  </span>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    title="Close"
                    className="hover-bg-ebe9e2"
                    style={{
                      width: 28,
                      height: 28,
                      border: 0,
                      background: 'transparent',
                      borderRadius: 6,
                      cursor: 'pointer',
                      font: '18px Geist, sans-serif',
                      color: '#6e6c64'
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Pick Modal Body */}
              <div
                style={{
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 18,
                  minHeight: 0,
                  overflow: 'auto'
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#3a3934' }}>Project</span>
                    <select
                      value={pick.project || ''}
                      onChange={(e) => pickProjectInternal(projects, e.target.value)}
                      style={{
                        height: 36,
                        width: '100%',
                        padding: '0 10px',
                        border: '1px solid #e3e1d9',
                        borderRadius: 7,
                        background: '#fff',
                        font: '13px Geist, sans-serif',
                        color: '#191917'
                      }}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#3a3934' }}>Repository</span>
                    <select
                      value={pick.repo || ''}
                      onChange={(e) => {
                        if (pick.project) {
                          pickRepoInternal(pick.project, pick.projectName || pick.project, repos, e.target.value);
                        }
                      }}
                      style={{
                        height: 36,
                        width: '100%',
                        padding: '0 10px',
                        border: '1px solid #e3e1d9',
                        borderRadius: 7,
                        background: '#fff',
                        font: '13px Geist, sans-serif',
                        color: '#191917'
                      }}
                    >
                      {repos.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
                    gap: 12,
                    alignItems: 'end',
                    padding: 14,
                    border: '1px solid #e3e1d9',
                    borderRadius: 10,
                    background: '#fff'
                  }}
                >
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: '#3a3934'
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          background: '#1f8a4c',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          font: "500 10.5px 'Geist Mono', monospace"
                        }}
                      >
                        B
                      </span>
                      Source branch · after
                    </span>
                    <select
                      value={pick.source || ''}
                      onChange={(e) => handleSetBranches({ source: e.target.value })}
                      style={{
                        height: 36,
                        width: '100%',
                        padding: '0 10px',
                        border: '1px solid #e3e1d9',
                        borderRadius: 7,
                        background: '#fff',
                        color: '#191917',
                        fontFamily: "'Geist Mono', monospace",
                        fontSize: 12.5
                      }}
                    >
                      {branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </label>

                  <span style={{ height: 36, display: 'grid', placeItems: 'center', fontSize: 12.5, color: '#6e6c64' }}>
                    into
                  </span>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: '#3a3934'
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          background: '#191917',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          font: "500 10.5px 'Geist Mono', monospace"
                        }}
                      >
                        A
                      </span>
                      Target branch · before
                    </span>
                    <select
                      value={pick.target || ''}
                      onChange={(e) => handleSetBranches({ target: e.target.value })}
                      style={{
                        height: 36,
                        width: '100%',
                        padding: '0 10px',
                        border: '1px solid #e3e1d9',
                        borderRadius: 7,
                        background: '#fff',
                        color: '#191917',
                        fontFamily: "'Geist Mono', monospace",
                        fontSize: 12.5
                      }}
                    >
                      {branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* Files list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#3a3934' }}>Mermaid files</span>
                    <span style={{ font: "12px 'Geist Mono', monospace", color: '#6e6c64' }}>
                      {files.length} total · {nChangedFiles} changed
                    </span>
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      onClick={() => setOnlyChanged((v) => !v)}
                      style={{
                        height: 28,
                        padding: '0 10px',
                        border: '1px solid #e3e1d9',
                        background: '#fff',
                        borderRadius: 6,
                        font: '500 12px Geist, sans-serif',
                        color: '#191917',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7
                      }}
                    >
                      <span
                        style={{
                          width: 24,
                          height: 14,
                          borderRadius: 7,
                          padding: 2,
                          display: 'flex',
                          background: onlyChanged ? '#191917' : '#d6d3c9',
                          justifyContent: onlyChanged ? 'flex-end' : 'flex-start'
                        }}
                      >
                        <span style={{ width: 10, height: 10, borderRadius: 5, background: '#fff' }} />
                      </span>
                      Changed only
                    </button>
                    <input
                      value={fileQuery}
                      onChange={(e) => setFileQuery(e.target.value)}
                      placeholder="Filter by path"
                      spellCheck={false}
                      style={{
                        height: 28,
                        width: 200,
                        border: '1px solid #e3e1d9',
                        borderRadius: 6,
                        background: '#fff',
                        outline: 'none',
                        padding: '0 9px',
                        font: "12.5px 'Geist Mono', monospace",
                        color: '#191917'
                      }}
                    />
                  </div>

                  <div
                    style={{
                      border: '1px solid #e3e1d9',
                      borderRadius: 10,
                      background: '#fff',
                      maxHeight: 280,
                      minHeight: 120,
                      overflow: 'auto',
                      padding: 4,
                      position: 'relative'
                    }}
                  >
                    {shownFiles.map((f) => {
                      const on = pick.path === f.path;
                      const c = f.change ? CH[f.change] : undefined;
                      return (
                        <button
                          key={f.path}
                          type="button"
                          onClick={() => setPick((s) => ({ ...s, path: f.path }))}
                          className="hover-bg-f4f3ef"
                          style={{
                            width: '100%',
                            display: 'grid',
                            gridTemplateColumns: '16px minmax(0, 1fr) auto',
                            gap: 10,
                            alignItems: 'center',
                            padding: '8px 10px',
                            border: 0,
                            borderRadius: 7,
                            cursor: 'pointer',
                            textAlign: 'left',
                            background: on ? '#ebe9e2' : 'transparent'
                          }}
                        >
                          <span
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: 7,
                              border: `1.5px solid ${on ? '#191917' : '#cfccc2'}`,
                              display: 'grid',
                              placeItems: 'center'
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                background: on ? '#191917' : 'transparent'
                              }}
                            />
                          </span>
                          <span
                            style={{
                              font: "12.5px 'Geist Mono', monospace",
                              color: '#191917',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis'
                            }}
                          >
                            {f.path.replace(/^\//, '')}
                          </span>
                          <span
                            style={{
                              padding: '2px 7px',
                              borderRadius: 4,
                              font: "500 11px 'Geist Mono', monospace",
                              background: c ? c.bg : '#f0eee8',
                              color: c ? c.ink : '#8a887f'
                            }}
                          >
                            {c ? c.label : 'unchanged'}
                          </span>
                        </button>
                      );
                    })}

                    {pickBusy && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(255,255,255,0.8)',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: 12.5,
                          color: '#6e6c64'
                        }}
                      >
                        {pickBusy}
                      </div>
                    )}

                    {!pickBusy && shownFiles.length === 0 && (
                      <div style={{ padding: '36px 16px', textAlign: 'center', fontSize: 12.5, color: '#6e6c64' }}>
                        {sameBr
                          ? 'Source and target are the same branch.'
                          : files.length
                            ? 'No files match.'
                            : 'No .mmd or .md files on these branches.'}
                      </div>
                    )}
                  </div>
                </div>

                {pickErr && (
                  <div
                    style={{
                      padding: '10px 12px',
                      border: '1px solid #e9b7b1',
                      background: '#fdf3f2',
                      borderRadius: 8,
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: '#a12a21'
                    }}
                  >
                    {pickErr}
                  </div>
                )}
              </div>

              {/* Pick Modal Footer */}
              <div
                style={{
                  padding: '14px 20px',
                  borderTop: '1px solid #e3e1d9',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flex: 'none'
                }}
              >
                <button
                  type="button"
                  onClick={() => setModal('connect')}
                  style={{
                    height: 34,
                    padding: '0 4px',
                    border: 0,
                    background: 'transparent',
                    font: '500 13px Geist, sans-serif',
                    color: '#6e6c64',
                    cursor: 'pointer'
                  }}
                >
                  ← Connection
                </button>
                <span
                  style={{
                    font: "12px 'Geist Mono', monospace",
                    color: '#6e6c64',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                    flex: 1,
                    textAlign: 'right'
                  }}
                >
                  {pick.path ? `${pick.path.replace(/^\//, '')}  ·  ${pick.source} → ${pick.target}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  style={{
                    height: 34,
                    padding: '0 14px',
                    border: '1px solid #e3e1d9',
                    background: '#fff',
                    borderRadius: 7,
                    font: '500 13px Geist, sans-serif',
                    color: '#191917',
                    cursor: 'pointer',
                    flex: 'none'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDoCompare}
                  style={{
                    height: 34,
                    padding: '0 16px',
                    border: '1px solid #191917',
                    background: '#191917',
                    borderRadius: 7,
                    font: '500 13px Geist, sans-serif',
                    color: '#fff',
                    flex: 'none',
                    cursor: canCompare ? 'pointer' : 'not-allowed',
                    opacity: canCompare ? 1 : 0.4
                  }}
                >
                  Compare
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

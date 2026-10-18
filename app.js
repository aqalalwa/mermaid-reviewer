(() => {
'use strict';

const COL = {
  add: { fill: '#e2f3e7', stroke: '#1f8a4c', ink: '#146b39', sym: '+' },
  del: { fill: '#fbe5e2', stroke: '#c8372d', ink: '#a12a21', sym: '−' },
  mod: { fill: '#fbefd3', stroke: '#b7791f', ink: '#7a5010', sym: '~' }
};

const SHAPES = [
  ['(((', [')))'], 'double circle'],
  ['((', ['))'], 'circle'],
  ['([', ['])'], 'stadium'],
  ['[[', [']]'], 'subroutine'],
  ['[(', [')]'], 'cylinder'],
  ['{{', ['}}'], 'hexagon'],
  ['[/', ['/]', '\\]'], 'slanted'],
  ['[\\', ['\\]', '/]'], 'slanted'],
  ['[', [']'], 'rectangle'],
  ['(', [')'], 'rounded'],
  ['{', ['}'], 'diamond'],
  ['>', [']'], 'flag']
];

const SAMPLE_A = `flowchart TD
  start([Customer opens cart]) --> review[Review items]
  review --> login{Signed in?}
  login -->|No| guest[Guest checkout]
  login -->|Yes| address[Shipping address]
  guest --> address
  address --> payment[Card payment]
  payment --> confirm[Order confirmed]
  confirm --> email[Send receipt email]`;

const SAMPLE_B = `flowchart TD
  start([Customer opens cart]) --> review[Review cart]
  review --> promo[Apply promo code]
  promo --> login{Signed in?}
  login -->|No| guest[Guest checkout]
  login -->|Yes| address[Shipping address]
  guest --> address
  address --> payment{Payment method}
  payment -->|Card| card[Card payment]
  payment -->|Wallet| wallet[Apple / Google Pay]
  card --> confirm[Order confirmed]
  wallet --> confirm
  confirm --> notify[Send receipt + SMS]`;

function parseNode(s, i) {
  const m = /^[A-Za-z0-9_\u00C0-\uFFFF]+(?:-(?![-.>=])[A-Za-z0-9_\u00C0-\uFFFF]+)*/.exec(s.slice(i));
  if (!m || /^(end|subgraph)$/.test(m[0])) return null;
  const id = m[0];
  i += id.length;
  let shape = null, text = null, open = null, close = null;
  for (const [o, cs, name] of SHAPES) {
    if (!s.startsWith(o, i)) continue;
    const j = i + o.length;
    let end = -1, cl = null;
    if (s[j] === '"') {
      const q = s.indexOf('"', j + 1);
      if (q > -1) {
        for (const c of cs) {
          if (s.startsWith(c, q + 1)) {
            end = q + 1;
            cl = c;
            break;
          }
        }
      }
    }
    if (end < 0) {
      for (const c of cs) {
        const k = s.indexOf(c, j);
        if (k > -1 && (end < 0 || k < end)) {
          end = k;
          cl = c;
        }
      }
    }
    if (end < 0) continue;
    text = s.slice(j, end);
    open = o;
    close = cl;
    shape = name;
    i = end + cl.length;
    break;
  }
  const cm = /^:::[\w-]+/.exec(s.slice(i));
  if (cm) i += cm[0].length;
  return { id, shape, open, close, text, i };
}

function parseEdge(s, i) {
  const r = s.slice(i);
  let m = /^(<?)(--|==|-\.)(?![->=.ox])\s*(.+?)\s*(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+|-{2,}[ox]|={2,}[ox])(?=\s|[A-Za-z0-9_])/.exec(r);
  if (m) return { op: m[1] + m[2] + m[4], label: m[3].trim(), i: i + m[0].length };
  m = /^<?(?:-{2,}|={2,}|-\.+-|~{3,})[>ox]?/.exec(r);
  if (!m) return null;
  let j = i + m[0].length, label = '';
  const lm = /^\s*\|([^|]*)\|/.exec(s.slice(j));
  if (lm) {
    label = lm[1].trim();
    j += lm[0].length;
  }
  return { op: m[0], label, i: j };
}

function edgeType(op) {
  const line = op.includes('~') ? 'invisible' : op.includes('.') ? 'dotted' : op.includes('=') ? 'thick' : 'solid';
  const end = />$/.test(op) ? 'arrow' : /o$/.test(op) ? 'circle' : /x$/.test(op) ? 'cross' : 'open';
  return { line, end, bi: op.startsWith('<') };
}

function opFor(t, forceDotted) {
  const line = forceDotted ? 'dotted' : t.line;
  if (line === 'invisible') return '~~~';
  const tail = { arrow: '>', circle: 'o', cross: 'x', open: '' }[t.end];
  let op = line === 'dotted' ? (tail ? '-.-' + tail : '-.-') : line === 'thick' ? (tail ? '==' + tail : '===') : (tail ? '--' + tail : '---');
  return (t.bi && tail ? '<' : '') + op;
}

function cleanLabel(t) {
  if (t == null) return null;
  return t
    .replace(/^"(.*)"$/s, '$1')
    .replace(/^`(.*)`$/s, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseStatement(s, nodes, order, edges) {
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const add = (n) => {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, { id: n.id, shape: null, text: null });
      order.push(n.id);
    }
    if (n.shape) {
      Object.assign(nodes.get(n.id), { shape: n.shape, open: n.open, close: n.close, text: n.text });
    }
  };
  const group = () => {
    const g = [];
    for (;;) {
      ws();
      const n = parseNode(s, i);
      if (!n) break;
      i = n.i;
      add(n);
      g.push(n.id);
      ws();
      if (s[i] === '&') {
        i++;
        continue;
      }
      break;
    }
    return g;
  };
  let prev = group();
  if (!prev.length) return;
  while (i < s.length) {
    ws();
    const e = parseEdge(s, i);
    if (!e) break;
    i = e.i;
    const next = group();
    if (!next.length) break;
    for (const a of prev) {
      for (const b of next) {
        edges.push({ from: a, to: b, t: edgeType(e.op), label: e.label });
      }
    }
    prev = next;
  }
}

function parseFlow(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const nodes = new Map(), order = [], edges = [];
  let started = false, fm = false, dir = 'TD';
  for (const raw of lines) {
    const line = raw.replace(/%%.*$/, '').trim();
    if (!started && line === '---') {
      fm = !fm;
      continue;
    }
    if (fm || !line) continue;
    if (!started) {
      started = true;
      const h = /^(flowchart|graph)\b\s*(\w+)?/i.exec(line);
      if (h) {
        dir = h[2] || 'TD';
        continue;
      }
      return { isFlow: false, type: line.split(/\s/)[0] };
    }
    for (let st of line.split(';')) {
      st = st.trim();
      if (!st || /^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr|subgraph|end)\b/.test(st)) continue;
      parseStatement(st, nodes, order, edges);
    }
  }
  return { isFlow: started, type: 'flowchart', dir, nodes, order, edges };
}

const nodeLabel = (n) => (n ? (cleanLabel(n.text) ?? n.id) : '');
const edgeSig = (e) => `${e.t.line}/${e.t.end}/${e.t.bi}`;
const edgeTypeName = (t) => `${t.line}${t.end === 'arrow' ? ' arrow' : t.end === 'open' ? ' line' : ' ' + t.end}`;

function keyEdges(list) {
  const cnt = {}, map = new Map();
  list.forEach((e, idx) => {
    const b = e.from + '→' + e.to;
    const k = (cnt[b] = (cnt[b] || 0) + 1);
    map.set(b + '#' + k, { e, idx, occ: k - 1 });
  });
  return map;
}

function computeDiff(A, B) {
  const nodes = [];
  const ids = [...B.order, ...A.order.filter((id) => !B.nodes.has(id))];
  for (const id of ids) {
    const a = A.nodes.get(id), b = B.nodes.get(id);
    if (a && !b) nodes.push({ id, status: 'del', a });
    else if (!a && b) nodes.push({ id, status: 'add', b });
    else {
      const la = nodeLabel(a), lb = nodeLabel(b);
      const sa = a.shape || 'rectangle', sb = b.shape || 'rectangle';
      nodes.push({ id, status: la !== lb || sa !== sb ? 'mod' : 'same', a, b, la, lb, sa, sb });
    }
  }
  const ka = keyEdges(A.edges), kb = keyEdges(B.edges), edges = [];
  for (const [k, vb] of kb) {
    const va = ka.get(k);
    if (!va) edges.push({ key: k, status: 'add', b: vb });
    else {
      const isMod = cleanLabel(va.e.label) !== cleanLabel(vb.e.label) || edgeSig(va.e) !== edgeSig(vb.e);
      edges.push({ key: k, status: isMod ? 'mod' : 'same', a: va, b: vb });
    }
  }
  for (const [k, va] of ka) {
    if (!kb.has(k)) edges.push({ key: k, status: 'del', a: va });
  }
  return { nodes, edges };
}

const CLASSDEFS = [
  'classDef mdAdd fill:#e2f3e7,stroke:#1f8a4c,stroke-width:2px,color:#0f4f2a',
  'classDef mdDel fill:#fbe5e2,stroke:#c8372d,stroke-width:2px,color:#7d1f18',
  'classDef mdMod fill:#fbefd3,stroke:#b7791f,stroke-width:2px,color:#5e3d0c',
  'classDef mdGhost fill:#fdf3f2,stroke:#c8372d,stroke-width:1.5px,stroke-dasharray:5 4,color:#a12a21',
  'classDef mdDim opacity:0.38'
];

const LINK = {
  add: 'stroke:#1f8a4c,stroke-width:2.5px',
  del: 'stroke:#c8372d,stroke-width:2.5px',
  mod: 'stroke:#b7791f,stroke-width:2.5px',
  ghost: 'stroke:#c8372d,stroke-width:2px,stroke-dasharray:6 4',
  dim: 'stroke:#cfccc2'
};

function decorate(src, nodeCls, linkCls) {
  const out = [src.replace(/\s+$/, ''), ...CLASSDEFS];
  for (const [cls, ids] of Object.entries(nodeCls)) {
    if (ids.length) out.push(`class ${ids.join(',')} ${cls}`);
  }
  for (const [k, idx] of Object.entries(linkCls)) {
    if (idx.length) out.push(`linkStyle ${idx.join(',')} ${LINK[k]}`);
  }
  return out.join('\n');
}

function lineDiff(a, b) {
  const A = a.replace(/\r/g, '').split('\n');
  const B = b.replace(/\r/g, '').split('\n');
  const n = A.length, m = B.length, ops = [];
  if (n * m > 4e6) {
    for (let i = 0; i < Math.max(n, m); i++) {
      ops.push(A[i] === B[i] ? { t: 'eq', a: i, b: i } : { t: 'mix', a: i < n ? i : null, b: i < m ? i : null });
    }
  } else {
    const W = m + 1, dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = A[i].trimEnd() === B[j].trimEnd()
          ? dp[(i + 1) * W + j + 1] + 1
          : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i].trimEnd() === B[j].trimEnd()) {
        ops.push({ t: 'eq', a: i++, b: j++ });
      } else if (j < m && (i >= n || dp[i * W + j + 1] >= dp[(i + 1) * W + j])) {
        ops.push({ t: 'add', b: j++ });
      } else {
        ops.push({ t: 'del', a: i++ });
      }
    }
  }
  const rows = [];
  const E = '#efede7';
  const mk = (ia, ib, kind) => ({
    la: ia == null ? '' : ia + 1,
    ta: ia == null ? '' : A[ia],
    lb: ib == null ? '' : ib + 1,
    tb: ib == null ? '' : B[ib],
    bA: ia == null ? E : kind === 'eq' ? '#fff' : '#fbe5e2',
    gA: ia == null ? E : kind === 'eq' ? '#fff' : '#f6d3cf',
    cA: kind === 'eq' ? '#3a3934' : '#7d1f18',
    bB: ib == null ? E : kind === 'eq' ? '#fff' : '#e2f3e7',
    gB: ib == null ? E : kind === 'eq' ? '#fff' : '#cbe9d4',
    cB: kind === 'eq' ? '#3a3934' : '#0f4f2a'
  });
  for (let k = 0; k < ops.length;) {
    if (ops[k].t === 'eq') {
      rows.push(mk(ops[k].a, ops[k].b, 'eq'));
      k++;
      continue;
    }
    if (ops[k].t === 'mix') {
      rows.push(mk(ops[k].a, ops[k].b, 'x'));
      k++;
      continue;
    }
    const dels = [], adds = [];
    while (k < ops.length && ops[k].t !== 'eq' && ops[k].t !== 'mix') {
      (ops[k].t === 'del' ? dels : adds).push(ops[k]);
      k++;
    }
    for (let r = 0; r < Math.max(dels.length, adds.length); r++) {
      rows.push(mk(dels[r] ? dels[r].a : null, adds[r] ? adds[r].b : null, 'x'));
    }
  }
  return rows;
}

// Application State
const state = {
  srcA: SAMPLE_A,
  srcB: SAMPLE_B,
  nameA: 'checkout-v1.mmd',
  nameB: 'checkout-v2.mmd',
  view: 'split',
  sync: true,
  dimUnchanged: false,
  filter: 'all',
  sel: null,
  editA: false,
  editB: false,
  dragA: false,
  dragB: false,
  dragging: null,
  loading: true,
  errA: '',
  errB: '',
  errO: '',
  t: {
    a: { x: 0, y: 0, s: 1 },
    b: { x: 0, y: 0, s: 1 },
    o: { x: 0, y: 0, s: 1 }
  }
};

// DOM References
const dom = {
  viewTabs: document.getElementById('view-tabs'),
  statAdd: document.getElementById('stat-add'),
  statDel: document.getElementById('stat-del'),
  statMod: document.getElementById('stat-mod'),
  btnSync: document.getElementById('btn-sync'),
  syncTrack: document.getElementById('sync-track'),
  btnSwap: document.getElementById('btn-swap'),

  viewSplit: document.getElementById('view-split'),
  viewOverlay: document.getElementById('view-overlay'),
  viewSource: document.getElementById('view-source'),

  nameA: document.getElementById('name-a'),
  btnEditA: document.getElementById('btn-edit-a'),
  btnOpenA: document.getElementById('btn-open-a'),
  fileA: document.getElementById('file-a'),
  paneA: document.getElementById('pane-a'),
  svgA: document.getElementById('svg-a'),
  zoomBoxA: document.getElementById('zoom-box-a'),
  zoomOutA: document.getElementById('zoom-out-a'),
  pctA: document.getElementById('pct-a'),
  zoomInA: document.getElementById('zoom-in-a'),
  fitA: document.getElementById('fit-a'),
  errA: document.getElementById('err-a'),
  loadingA: document.getElementById('loading-a'),
  dropA: document.getElementById('drop-a'),
  editorA: document.getElementById('editor-a'),

  nameB: document.getElementById('name-b'),
  btnEditB: document.getElementById('btn-edit-b'),
  btnOpenB: document.getElementById('btn-open-b'),
  fileB: document.getElementById('file-b'),
  paneB: document.getElementById('pane-b'),
  svgB: document.getElementById('svg-b'),
  zoomBoxB: document.getElementById('zoom-box-b'),
  zoomOutB: document.getElementById('zoom-out-b'),
  pctB: document.getElementById('pct-b'),
  zoomInB: document.getElementById('zoom-in-b'),
  fitB: document.getElementById('fit-b'),
  errB: document.getElementById('err-b'),
  loadingB: document.getElementById('loading-b'),
  dropB: document.getElementById('drop-b'),
  editorB: document.getElementById('editor-b'),

  zoomOutO: document.getElementById('zoom-out-o'),
  pctO: document.getElementById('pct-o'),
  zoomInO: document.getElementById('zoom-in-o'),
  fitO: document.getElementById('fit-o'),
  paneO: document.getElementById('pane-o'),
  svgO: document.getElementById('svg-o'),
  errO: document.getElementById('err-o'),

  srcNameA: document.getElementById('src-name-a'),
  srcNameB: document.getElementById('src-name-b'),
  sourceRows: document.getElementById('source-rows'),

  statsTotal: document.getElementById('stats-total'),
  filterPills: document.getElementById('filter-pills'),
  notFlowCard: document.getElementById('not-flow-card'),
  diagType: document.getElementById('diag-type'),
  identicalMsg: document.getElementById('identical-msg'),
  nodesSection: document.getElementById('nodes-section'),
  nodeRows: document.getElementById('node-rows'),
  edgesSection: document.getElementById('edges-section'),
  edgeRows: document.getElementById('edge-rows')
};

const sizes = {};
let fitted = {};
let seq = 0;
let q = Promise.resolve();
let timer = null;
let mm = null;
let tmp = null;
let drag = null;
let needRetry = false;
let retries = 0;
let cachedDiffKey = null;
let cachedDiff = null;

function pane(k) {
  return { a: dom.paneA, b: dom.paneB, o: dom.paneO }[k];
}

function svgEl(k) {
  return { a: dom.svgA, b: dom.svgB, o: dom.svgO }[k];
}

function getDiff() {
  const { srcA, srcB, dimUnchanged: dim } = state;
  const key = srcA + '\u0000' + srcB + dim;
  if (cachedDiffKey === key) return cachedDiff;

  const A = parseFlow(srcA);
  const B = parseFlow(srcB);
  const d = { A, B, flow: A.isFlow && B.isFlow && A.type === 'flowchart' && B.type === 'flowchart' };
  d.rows = lineDiff(srcA, srcB);

  if (!d.flow) {
    d.srcA = srcA;
    d.srcB = srcB;
    d.srcO = null;
    d.nodes = [];
    d.edges = [];
  } else {
    const { nodes, edges } = computeDiff(A, B);
    d.nodes = nodes;
    d.edges = edges;
    const pick = (st) => nodes.filter((n) => n.status === st).map((n) => n.id);
    const same = pick('same');

    d.srcA = decorate(
      srcA,
      { mdDel: pick('del'), mdMod: pick('mod'), mdDim: dim ? same : [] },
      {
        del: edges.filter((e) => e.status === 'del').map((e) => e.a.idx),
        mod: edges.filter((e) => e.status === 'mod').map((e) => e.a.idx),
        dim: dim ? edges.filter((e) => e.status === 'same').map((e) => e.a.idx) : []
      }
    );

    d.srcB = decorate(
      srcB,
      { mdAdd: pick('add'), mdMod: pick('mod'), mdDim: dim ? same : [] },
      {
        add: edges.filter((e) => e.status === 'add').map((e) => e.b.idx),
        mod: edges.filter((e) => e.status === 'mod').map((e) => e.b.idx),
        dim: dim ? edges.filter((e) => e.status === 'same').map((e) => e.b.idx) : []
      }
    );

    const L = [`flowchart ${B.dir}`];
    for (const n of nodes) {
      const nd = n.b || n.a;
      L.push('  ' + n.id + (nd.shape ? nd.open + nd.text + nd.close : ''));
    }
    const lk = { add: [], del: [], mod: [], dim: [] };
    edges.forEach((e, i) => {
      const src = (e.b || e.a).e;
      const lab = cleanLabel(src.label);
      L.push(`  ${src.from} ${opFor(src.t, e.status === 'del')}${lab ? '|"' + lab.replace(/"/g, '#quot;') + '"|' : ''} ${src.to}`);
      if (e.status === 'same') {
        if (dim) lk.dim.push(i);
      } else {
        lk[e.status].push(i);
      }
    });

    d.srcO = decorate(
      L.join('\n'),
      { mdAdd: pick('add'), mdGhost: pick('del'), mdMod: pick('mod'), mdDim: dim ? same : [] },
      { add: lk.add, ghost: lk.del, mod: lk.mod, dim: lk.dim }
    );
    d.edges.forEach((e, i) => (e.oIdx = i));
  }

  cachedDiffKey = key;
  cachedDiff = d;
  return d;
}

function updateTransformUI() {
  ['a', 'b', 'o'].forEach((k) => {
    const tk = state.t[k];
    const el = svgEl(k);
    if (el) {
      el.style.transform = `translate(${tk.x}px, ${tk.y}px) scale(${tk.s})`;
    }
    const p = pane(k);
    if (p) {
      p.classList.toggle('dragging', state.dragging === k);
    }
  });
  dom.pctA.textContent = Math.round(state.t.a.s * 100) + '%';
  dom.pctB.textContent = Math.round(state.t.b.s * 100) + '%';
  dom.pctO.textContent = Math.round(state.t.o.s * 100) + '%';
}

function updateUI() {
  const d = getDiff();

  // Views visibility
  dom.viewSplit.style.display = state.view === 'split' ? 'grid' : 'none';
  dom.viewOverlay.style.display = state.view === 'overlay' ? 'flex' : 'none';
  dom.viewSource.style.display = state.view === 'source' ? 'flex' : 'none';

  // View tabs
  for (const btn of dom.viewTabs.querySelectorAll('.view-tab')) {
    btn.classList.toggle('active', btn.dataset.view === state.view);
  }

  // Sync toggle
  dom.syncTrack.classList.toggle('off', !state.sync);

  // Filenames
  dom.nameA.textContent = state.nameA;
  dom.nameB.textContent = state.nameB;
  dom.srcNameA.textContent = state.nameA;
  dom.srcNameB.textContent = state.nameB;

  // Editors
  dom.btnEditA.classList.toggle('active', state.editA);
  dom.btnEditB.classList.toggle('active', state.editB);
  dom.editorA.classList.toggle('hidden', !state.editA);
  dom.editorB.classList.toggle('hidden', !state.editB);
  if (document.activeElement !== dom.editorA && dom.editorA.value !== state.srcA) {
    dom.editorA.value = state.srcA;
  }
  if (document.activeElement !== dom.editorB && dom.editorB.value !== state.srcB) {
    dom.editorB.value = state.srcB;
  }

  // Loading & Drag overlays & Errors
  dom.loadingA.classList.toggle('hidden', !state.loading);
  dom.loadingB.classList.toggle('hidden', !state.loading);
  dom.dropA.classList.toggle('hidden', !state.dragA);
  dom.dropB.classList.toggle('hidden', !state.dragB);

  dom.errA.textContent = state.errA;
  dom.errA.classList.toggle('hidden', !state.errA);
  dom.errB.textContent = state.errB;
  dom.errB.classList.toggle('hidden', !state.errB);
  dom.errO.textContent = state.errO;
  dom.errO.classList.toggle('hidden', !state.errO);

  // Transforms & percentages
  updateTransformUI();

  // Stats
  const nodesCh = d.nodes.filter((n) => n.status !== 'same');
  const edgesCh = d.edges.filter((e) => e.status !== 'same');
  const all = [...nodesCh, ...edgesCh];
  const cnt = (s) => all.filter((x) => x.status === s).length;
  const stats = { add: cnt('add'), del: cnt('del'), mod: cnt('mod'), total: all.length };

  dom.statAdd.textContent = `+${stats.add} added`;
  dom.statDel.textContent = `−${stats.del} removed`;
  dom.statMod.textContent = `~${stats.mod} changed`;
  dom.statsTotal.textContent = String(stats.total);

  // Filter pills
  const fdefs = [
    ['all', 'All', stats.total],
    ['add', 'Added', stats.add],
    ['del', 'Removed', stats.del],
    ['mod', 'Changed', stats.mod]
  ];
  dom.filterPills.innerHTML = '';
  for (const [id, label, n] of fdefs) {
    const on = state.filter === id;
    const c = COL[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-pill';
    btn.style.background = on ? (c ? c.fill : '#191917') : '#fff';
    btn.style.color = on ? (c ? c.ink : '#fff') : '#3a3934';
    btn.style.borderColor = on ? (c ? c.stroke : '#191917') : '#e3e1d9';
    btn.innerHTML = `${label}<span class="filter-pill-count">${n}</span>`;
    btn.addEventListener('click', () => {
      state.filter = id;
      updateUI();
    });
    dom.filterPills.appendChild(btn);
  }

  // Sidebar content
  const notFlow = !d.flow;
  const diagType = d.A.isFlow === false ? d.A.type : (d.B.type || '');
  dom.notFlowCard.classList.toggle('hidden', !notFlow);
  dom.diagType.textContent = diagType;

  const identical = d.flow && all.length === 0;
  dom.identicalMsg.classList.toggle('hidden', !identical);

  const pass = (s) => state.filter === 'all' || state.filter === s;
  const filteredNodes = nodesCh.filter((n) => pass(n.status));
  const filteredEdges = edgesCh.filter((e) => pass(e.status));

  dom.nodesSection.classList.toggle('hidden', filteredNodes.length === 0);
  dom.nodeRows.innerHTML = '';
  for (const n of filteredNodes) {
    const key = 'n:' + n.id;
    let sub = '';
    if (n.status === 'mod') {
      const parts = [];
      if (n.la !== n.lb) parts.push(`was “${n.la}”`);
      if (n.sa !== n.sb) parts.push(`${n.sa} → ${n.sb}`);
      sub = parts.join(' · ');
    }
    const title = n.status === 'del' ? nodeLabel(n.a) : nodeLabel(n.b);
    const meta = n.id + (n.status === 'mod' ? '' : ' · ' + ((n.a || n.b).shape || 'rectangle'));

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'change-item' + (state.sel === key ? ' selected' : '');

    const symEl = document.createElement('span');
    symEl.className = 'change-sym';
    symEl.style.background = COL[n.status].fill;
    symEl.style.color = COL[n.status].ink;
    symEl.textContent = COL[n.status].sym;

    const bodyEl = document.createElement('span');
    bodyEl.className = 'change-body';

    const titleEl = document.createElement('span');
    titleEl.className = 'change-node-title';
    titleEl.textContent = title;

    const metaEl = document.createElement('span');
    metaEl.className = 'change-node-meta';
    metaEl.textContent = meta;

    bodyEl.appendChild(titleEl);
    bodyEl.appendChild(metaEl);

    if (sub) {
      const subEl = document.createElement('span');
      subEl.className = 'change-sub';
      subEl.textContent = sub;
      bodyEl.appendChild(subEl);
    }

    btn.appendChild(symEl);
    btn.appendChild(bodyEl);
    btn.addEventListener('click', () => focusItem({ kind: 'node', id: n.id, key, status: n.status }));
    dom.nodeRows.appendChild(btn);
  }

  dom.edgesSection.classList.toggle('hidden', filteredEdges.length === 0);
  dom.edgeRows.innerHTML = '';
  for (const e of filteredEdges) {
    const src = (e.b || e.a).e;
    const key = 'e:' + e.key;
    let sub = cleanLabel(src.label) ? `“${cleanLabel(src.label)}”` : '';
    if (e.status === 'mod') {
      const la = cleanLabel(e.a.e.label) || '';
      const lb = cleanLabel(e.b.e.label) || '';
      const parts = [];
      if (la !== lb) {
        parts.push(la && lb ? `label “${la}” → “${lb}”` : lb ? `label added “${lb}”` : `label removed “${la}”`);
      }
      if (edgeSig(e.a.e) !== edgeSig(e.b.e)) {
        parts.push(`${edgeTypeName(e.a.e.t)} → ${edgeTypeName(e.b.e.t)}`);
      }
      sub = parts.join(' · ');
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'change-item' + (state.sel === key ? ' selected' : '');

    const symEl = document.createElement('span');
    symEl.className = 'change-sym';
    symEl.style.background = COL[e.status].fill;
    symEl.style.color = COL[e.status].ink;
    symEl.textContent = COL[e.status].sym;

    const bodyEl = document.createElement('span');
    bodyEl.className = 'change-body';

    const titleEl = document.createElement('span');
    titleEl.className = 'change-edge-title';
    titleEl.textContent = `${src.from} → ${src.to}`;
    bodyEl.appendChild(titleEl);

    if (sub) {
      const subEl = document.createElement('span');
      subEl.className = 'change-sub';
      subEl.textContent = sub;
      bodyEl.appendChild(subEl);
    }

    btn.appendChild(symEl);
    btn.appendChild(bodyEl);
    btn.addEventListener('click', () =>
      focusItem({ kind: 'edge', pair: [src.from, src.to], occ: (e.b || e.a).occ, key, status: e.status })
    );
    dom.edgeRows.appendChild(btn);
  }

  // Source Diff rows
  dom.sourceRows.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const r of d.rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'source-row';

    const lnA = document.createElement('span');
    lnA.className = 'source-ln';
    lnA.style.background = r.gA;
    lnA.textContent = r.la;

    const codeA = document.createElement('span');
    codeA.className = 'source-code source-code-a';
    codeA.style.background = r.bA;
    codeA.style.color = r.cA;
    codeA.textContent = r.ta;

    const lnB = document.createElement('span');
    lnB.className = 'source-ln';
    lnB.style.background = r.gB;
    lnB.textContent = r.lb;

    const codeB = document.createElement('span');
    codeB.className = 'source-code';
    codeB.style.background = r.bB;
    codeB.style.color = r.cB;
    codeB.textContent = r.tb;

    rowEl.appendChild(lnA);
    rowEl.appendChild(codeA);
    rowEl.appendChild(lnB);
    rowEl.appendChild(codeB);
    frag.appendChild(rowEl);
  }
  dom.sourceRows.appendChild(frag);
}

function schedule(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    q = q.then(() => renderAll()).catch(() => {});
  }, ms);
}

async function renderAll() {
  if (!mm) return;
  needRetry = false;
  const d = getDiff();
  await renderInto('a', d.srcA, 'errA');
  await renderInto('b', d.srcB, 'errB');
  if (d.srcO) {
    await renderInto('o', d.srcO, 'errO');
  } else {
    const el = svgEl('o');
    if (el) el.innerHTML = '';
    sizes.o = null;
    state.errO = 'The merged view is available when both files are flowcharts. Use Split or Source for other diagram types.';
  }
  if (!needRetry) retries = 0;
  fitVisible();
  updateUI();
}

async function renderInto(k, code, errKey) {
  const el = svgEl(k);
  if (!el) return;
  try {
    if (!tmp) {
      tmp = document.createElement('div');
      tmp.style.cssText = 'position:absolute;left:-20000px;top:0;width:2400px;visibility:visible;';
      document.body.appendChild(tmp);
    }
    const { svg } = await mm.render('mdd' + (++seq), code, tmp);
    tmp.innerHTML = '';
    el.innerHTML = svg;
    const s = el.querySelector('svg');
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
      w = parseFloat(s.getAttribute('width')) || 400;
      h = parseFloat(s.getAttribute('height')) || 300;
    }
    s.removeAttribute('style');
    s.setAttribute('width', w);
    s.setAttribute('height', h);
    s.style.display = 'block';
    s.style.overflow = 'visible';
    sizes[k] = { w, h };
    if (state[errKey]) state[errKey] = '';
  } catch (e) {
    el.innerHTML = '';
    sizes[k] = null;
    document.querySelectorAll('body > [id^="dmdd"]').forEach((n) => n.remove());
    if (tmp) tmp.innerHTML = '';
    let syntax = false;
    try {
      await mm.parse(code);
    } catch (_) {
      syntax = true;
    }
    if (!syntax) {
      needRetry = true;
      if (state[errKey]) state[errKey] = '';
      if (document.visibilityState === 'visible' && (retries = (retries || 0) + 1) < 6) {
        setTimeout(() => schedule(0), 400);
      }
      return;
    }
    state[errKey] = 'Syntax error\n' + String((e && e.message) || e).slice(0, 400);
    document.querySelectorAll('body > [id^="dmdd"]').forEach((n) => n.remove());
  }
}

function calcFit(k) {
  const p = pane(k), sz = sizes[k];
  if (!p || !sz || !sz.w || !sz.h) return null;
  const W = p.clientWidth, H = p.clientHeight;
  if (!W || !H) return null;
  return { W, H, sz, s: Math.min((W - 56) / sz.w, (H - 56) / sz.h, 1.3) };
}

function place(f, s) {
  return { s, x: (f.W - f.sz.w * s) / 2, y: Math.max(28, (f.H - f.sz.h * s) / 2) };
}

function fit(k) {
  const f = calcFit(k);
  if (!f) return;
  fitted[k] = true;
  state.t[k] = place(f, f.s);
  updateTransformUI();
}

function fitSplit() {
  const fa = calcFit('a'), fb = calcFit('b');
  if (state.sync && fa && fb) {
    const s = Math.min(fa.s, fb.s);
    fitted.a = fitted.b = true;
    state.t.a = place(fa, s);
    state.t.b = place(fb, s);
    updateTransformUI();
  } else {
    fit('a');
    fit('b');
  }
}

function fitVisible() {
  const v = state.view;
  if (v === 'split') {
    if (!fitted.a || !fitted.b) fitSplit();
  } else if (v === 'overlay' && !fitted.o) {
    fit('o');
  }
}

function linked(k) {
  return k !== 'o' && state.sync && state.view === 'split' ? ['a', 'b'] : [k];
}

function zoomAt(k, f, px, py) {
  const keys = linked(k);
  keys.forEach((kk) => {
    const c = state.t[kk];
    const s = Math.min(6, Math.max(0.1, c.s * f));
    const r = s / c.s;
    state.t[kk] = { s, x: px - (px - c.x) * r, y: py - (py - c.y) * r };
  });
  updateTransformUI();
}

function zoomBtn(k, f) {
  const p = pane(k);
  if (p) zoomAt(k, f, p.clientWidth / 2, p.clientHeight / 2);
}

function findEl(k, item) {
  const root = svgEl(k);
  if (!root) return null;
  if (item.kind === 'node') {
    const esc = item.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('flowchart-' + esc + '-\\d+$');
    return [...root.querySelectorAll('g.node')].find((n) => re.test(n.id)) || null;
  }
  const [from, to] = item.pair;
  const ms = [...root.querySelectorAll('path[id]')].filter(
    (p) => p.id.includes(`L_${from}_${to}_`) || p.id.includes(`L-${from}-${to}-`)
  );
  return ms[item.occ] || ms[0] || null;
}

function focusItem(item) {
  const v = state.view;
  if (v === 'source') {
    state.view = 'split';
    updateUI();
    requestAnimationFrame(() => {
      fitVisible();
      setTimeout(() => focusItem(item), 60);
    });
    return;
  }
  state.sel = item.key;
  updateUI();

  const keys =
    v === 'overlay'
      ? ['o']
      : [item.status === 'del' ? 'a' : 'b', ...(item.status === 'mod' || item.status === 'same' ? ['a'] : [])];
  const ks = v === 'split' ? ['a', 'b'] : keys;

  ks.forEach((k) => {
    const el = findEl(k, item);
    const p = pane(k);
    if (!el || !p) return;
    const r = p.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - (e.left + e.width / 2);
    const dy = r.top + r.height / 2 - (e.top + e.height / 2);
    state.t[k] = { ...state.t[k], x: state.t[k].x + dx, y: state.t[k].y + dy };
    updateTransformUI();
    try {
      el.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], {
        duration: 450,
        iterations: 3,
        delay: 120
      });
    } catch (_) {}
  });
}

function loadFile(side, file) {
  if (!file) return;
  file.text().then((t) => {
    if (/\.(md|markdown)$/i.test(file.name)) {
      const m = /```mermaid[^\n]*\n([\s\S]*?)```/.exec(t);
      if (m) t = m[1];
    }
    fitted = {};
    if (side === 'a') {
      state.srcA = t;
      state.nameA = file.name;
      state.dragA = false;
    } else {
      state.srcB = t;
      state.nameB = file.name;
      state.dragB = false;
    }
    updateUI();
    schedule(0);
  });
}

function setupEvents() {
  // View switching
  dom.viewTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-tab');
    if (!btn) return;
    state.view = btn.dataset.view;
    updateUI();
    requestAnimationFrame(() => fitVisible());
  });

  // Sync toggle
  dom.btnSync.addEventListener('click', () => {
    state.sync = !state.sync;
    updateUI();
  });

  // Swap
  dom.btnSwap.addEventListener('click', () => {
    fitted = {};
    const tmpSrc = state.srcA;
    state.srcA = state.srcB;
    state.srcB = tmpSrc;
    const tmpName = state.nameA;
    state.nameA = state.nameB;
    state.nameB = tmpName;
    updateUI();
    schedule(0);
  });

  // Edit toggles & live textareas
  dom.btnEditA.addEventListener('click', () => {
    fitted.a = fitted.b = false;
    state.editA = !state.editA;
    updateUI();
    requestAnimationFrame(() => fitVisible());
  });

  dom.btnEditB.addEventListener('click', () => {
    fitted.a = fitted.b = false;
    state.editB = !state.editB;
    updateUI();
    requestAnimationFrame(() => fitVisible());
  });

  dom.editorA.addEventListener('input', (e) => {
    state.srcA = e.target.value;
    updateUI();
    schedule(250);
  });

  dom.editorB.addEventListener('input', (e) => {
    state.srcB = e.target.value;
    updateUI();
    schedule(250);
  });

  // Open file buttons
  dom.btnOpenA.addEventListener('click', () => dom.fileA.click());
  dom.btnOpenB.addEventListener('click', () => dom.fileB.click());

  dom.fileA.addEventListener('change', (e) => {
    loadFile('a', e.target.files[0]);
    e.target.value = '';
  });

  dom.fileB.addEventListener('change', (e) => {
    loadFile('b', e.target.files[0]);
    e.target.value = '';
  });

  // Stop propagation on floating zoom boxes
  dom.zoomBoxA.addEventListener('mousedown', (e) => e.stopPropagation());
  dom.zoomBoxB.addEventListener('mousedown', (e) => e.stopPropagation());

  // Zoom & Fit buttons
  dom.zoomInA.addEventListener('click', () => zoomBtn('a', 1.25));
  dom.zoomOutA.addEventListener('click', () => zoomBtn('a', 0.8));
  dom.fitA.addEventListener('click', () => (state.sync ? fitSplit() : fit('a')));

  dom.zoomInB.addEventListener('click', () => zoomBtn('b', 1.25));
  dom.zoomOutB.addEventListener('click', () => zoomBtn('b', 0.8));
  dom.fitB.addEventListener('click', () => (state.sync ? fitSplit() : fit('b')));

  dom.zoomInO.addEventListener('click', () => zoomBtn('o', 1.25));
  dom.zoomOutO.addEventListener('click', () => zoomBtn('o', 0.8));
  dom.fitO.addEventListener('click', () => fit('o'));

  // Panning and wheel zoom on panes
  ['a', 'b', 'o'].forEach((k) => {
    const el = pane(k);
    if (!el) return;
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomAt(k, Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false }
    );
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      drag = { k, x: e.clientX, y: e.clientY };
      state.dragging = k;
      updateTransformUI();
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const keys = linked(drag.k);
    keys.forEach((k) => {
      state.t[k] = { ...state.t[k], x: state.t[k].x + dx, y: state.t[k].y + dy };
    });
    updateTransformUI();
  });

  window.addEventListener('mouseup', () => {
    if (drag) {
      drag = null;
      state.dragging = null;
      updateTransformUI();
    }
  });

  // Drag and drop files on panes A and B
  const bindDnd = (side, el, key) => {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!state[key]) {
        state[key] = true;
        updateUI();
      }
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) {
        state[key] = false;
        updateUI();
      }
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      state[key] = false;
      updateUI();
      loadFile(side, e.dataTransfer.files[0]);
    });
  };
  bindDnd('a', dom.paneA, 'dragA');
  bindDnd('b', dom.paneB, 'dragB');

  // Resize handling
  window.addEventListener('resize', () => {
    ['a', 'b', 'o'].forEach((k) => (fitted[k] = false));
    fitVisible();
  });

  const ro = new ResizeObserver((entries) => {
    for (const en of entries) {
      const k = en.target === dom.paneA ? 'a' : en.target === dom.paneB ? 'b' : 'o';
      if (en.contentRect.width > 0 && sizes[k] && !fitted[k]) {
        if (k === 'o') fit('o');
        else fitSplit();
      }
    }
  });
  ['a', 'b', 'o'].forEach((k) => pane(k) && ro.observe(pane(k)));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && needRetry) {
      retries = 0;
      schedule(0);
    }
  });
}

async function init() {
  setupEvents();
  updateUI();
  try {
    const m = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
    mm = m.default;
    mm.initialize({
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
    try {
      await document.fonts.ready;
    } catch (_) {}
    state.loading = false;
    updateUI();
    schedule(0);
  } catch (e) {
    state.loading = false;
    state.errA = 'Could not load Mermaid: ' + e.message;
    updateUI();
  }
}

init();
})();

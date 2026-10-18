import {
  ComputedDiffResult,
  DiffEdge,
  DiffNode,
  EdgeTypeInfo,
  KeyedEdge,
  LineDiffRow,
  ParsedEdge,
  ParsedFlow,
  ParsedNode
} from '../types';

export const COL = {
  add: { fill: '#e2f3e7', stroke: '#1f8a4c', ink: '#146b39', sym: '+' },
  del: { fill: '#fbe5e2', stroke: '#c8372d', ink: '#a12a21', sym: '−' },
  mod: { fill: '#fbefd3', stroke: '#b7791f', ink: '#7a5010', sym: '~' }
} as const;

export const SHAPES: Array<[string, string[], string]> = [
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

export function parseNode(s: string, i: number): (ParsedNode & { i: number }) | null {
  const m = /^[A-Za-z0-9_\u00C0-\uFFFF]+(?:-(?![-.>=])[A-Za-z0-9_\u00C0-\uFFFF]+)*/.exec(s.slice(i));
  if (!m || /^(end|subgraph)$/.test(m[0])) return null;
  const id = m[0];
  i += id.length;
  let shape: string | null = null;
  let text: string | null = null;
  let open: string | null = null;
  let close: string | null = null;

  for (const [o, cs, name] of SHAPES) {
    if (!s.startsWith(o, i)) continue;
    const j = i + o.length;
    let end = -1;
    let cl: string | null = null;
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
    if (end < 0 || !cl) continue;
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

export function parseEdge(s: string, i: number): { op: string; label: string; i: number } | null {
  const r = s.slice(i);
  let m =
    /^(<?)(--|==|-\.)(?![->=.ox])\s*(.+?)\s*(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+|-{2,}[ox]|={2,}[ox])(?=\s|[A-Za-z0-9_])/.exec(
      r
    );
  if (m) return { op: m[1] + m[2] + m[4], label: m[3].trim(), i: i + m[0].length };
  m = /^<?(?:-{2,}|={2,}|-\.+-|~{3,})[>ox]?/.exec(r);
  if (!m) return null;
  let j = i + m[0].length;
  let label = '';
  const lm = /^\s*\|([^|]*)\|/.exec(s.slice(j));
  if (lm) {
    label = lm[1].trim();
    j += lm[0].length;
  }
  return { op: m[0], label, i: j };
}

export function edgeType(op: string): EdgeTypeInfo {
  const line = op.includes('~')
    ? 'invisible'
    : op.includes('.')
      ? 'dotted'
      : op.includes('=')
        ? 'thick'
        : 'solid';
  const end = />$/.test(op) ? 'arrow' : /o$/.test(op) ? 'circle' : /x$/.test(op) ? 'cross' : 'open';
  return { line, end, bi: op.startsWith('<') };
}

export function opFor(t: EdgeTypeInfo, forceDotted: boolean): string {
  const line = forceDotted ? 'dotted' : t.line;
  if (line === 'invisible') return '~~~';
  const tail = { arrow: '>', circle: 'o', cross: 'x', open: '' }[t.end];
  const op =
    line === 'dotted'
      ? tail
        ? '-.-' + tail
        : '-.-'
      : line === 'thick'
        ? tail
          ? '==' + tail
          : '==='
        : tail
          ? '--' + tail
          : '---';
  return (t.bi && tail ? '<' : '') + op;
}

export function cleanLabel(t: string | null | undefined): string | null {
  if (t == null) return null;
  return t
    .replace(/^"(.*)"$/s, '$1')
    .replace(/^`(.*)`$/s, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseStatement(
  s: string,
  nodes: Map<string, ParsedNode>,
  order: string[],
  edges: ParsedEdge[]
): void {
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const add = (n: ParsedNode) => {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, { id: n.id, shape: null, text: null });
      order.push(n.id);
    }
    if (n.shape) {
      const existing = nodes.get(n.id)!;
      Object.assign(existing, { shape: n.shape, open: n.open, close: n.close, text: n.text });
    }
  };
  const group = () => {
    const g: string[] = [];
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

export function parseFlow(src: string): ParsedFlow {
  const lines = src.replace(/\r/g, '').split('\n');
  const nodes = new Map<string, ParsedNode>();
  const order: string[] = [];
  const edges: ParsedEdge[] = [];
  let started = false;
  let fm = false;
  let dir = 'TD';

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
      if (!st || /^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr|subgraph|end)\b/.test(st)) {
        continue;
      }
      parseStatement(st, nodes, order, edges);
    }
  }
  return { isFlow: started, type: 'flowchart', dir, nodes, order, edges };
}

export const nodeLabel = (n?: ParsedNode): string => (n ? (cleanLabel(n.text) ?? n.id) : '');
export const edgeSig = (e: ParsedEdge): string => `${e.t.line}/${e.t.end}/${e.t.bi}`;
export const edgeTypeName = (t: EdgeTypeInfo): string =>
  `${t.line}${t.end === 'arrow' ? ' arrow' : t.end === 'open' ? ' line' : ' ' + t.end}`;

export function keyEdges(list: ParsedEdge[]): Map<string, KeyedEdge> {
  const cnt: Record<string, number> = {};
  const map = new Map<string, KeyedEdge>();
  list.forEach((e, idx) => {
    const b = e.from + '→' + e.to;
    const k = (cnt[b] = (cnt[b] || 0) + 1);
    map.set(b + '#' + k, { e, idx, occ: k - 1 });
  });
  return map;
}

export function computeDiff(A: ParsedFlow, B: ParsedFlow): { nodes: DiffNode[]; edges: DiffEdge[] } {
  const nodes: DiffNode[] = [];
  const aNodes = A.nodes || new Map<string, ParsedNode>();
  const bNodes = B.nodes || new Map<string, ParsedNode>();
  const aOrder = A.order || [];
  const bOrder = B.order || [];

  const ids = [...bOrder, ...aOrder.filter((id) => !bNodes.has(id))];
  for (const id of ids) {
    const a = aNodes.get(id);
    const b = bNodes.get(id);
    if (a && !b) nodes.push({ id, status: 'del', a });
    else if (!a && b) nodes.push({ id, status: 'add', b });
    else if (a && b) {
      const la = nodeLabel(a);
      const lb = nodeLabel(b);
      const sa = a.shape || 'rectangle';
      const sb = b.shape || 'rectangle';
      nodes.push({ id, status: la !== lb || sa !== sb ? 'mod' : 'same', a, b, la, lb, sa, sb });
    }
  }

  const ka = keyEdges(A.edges || []);
  const kb = keyEdges(B.edges || []);
  const edges: DiffEdge[] = [];

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

export const CLASSDEFS = [
  'classDef mdAdd fill:#e2f3e7,stroke:#1f8a4c,stroke-width:2px,color:#0f4f2a',
  'classDef mdDel fill:#fbe5e2,stroke:#c8372d,stroke-width:2px,color:#7d1f18',
  'classDef mdMod fill:#fbefd3,stroke:#b7791f,stroke-width:2px,color:#5e3d0c',
  'classDef mdGhost fill:#fdf3f2,stroke:#c8372d,stroke-width:1.5px,stroke-dasharray:5 4,color:#a12a21',
  'classDef mdDim opacity:0.38'
];

export const LINK: Record<string, string> = {
  add: 'stroke:#1f8a4c,stroke-width:2.5px',
  del: 'stroke:#c8372d,stroke-width:2.5px',
  mod: 'stroke:#b7791f,stroke-width:2.5px',
  ghost: 'stroke:#c8372d,stroke-width:2px,stroke-dasharray:6 4',
  dim: 'stroke:#cfccc2'
};

export function decorate(
  src: string,
  nodeCls: Record<string, string[]>,
  linkCls: Record<string, number[]>
): string {
  const out = [src.replace(/\s+$/, ''), ...CLASSDEFS];
  for (const [cls, ids] of Object.entries(nodeCls)) {
    if (ids.length) out.push(`class ${ids.join(',')} ${cls}`);
  }
  for (const [k, idx] of Object.entries(linkCls)) {
    if (idx.length) out.push(`linkStyle ${idx.join(',')} ${LINK[k]}`);
  }
  return out.join('\n');
}

export function lineDiff(a: string, b: string): LineDiffRow[] {
  const A = a.replace(/\r/g, '').split('\n');
  const B = b.replace(/\r/g, '').split('\n');
  const n = A.length;
  const m = B.length;
  const ops: Array<{ t: 'eq' | 'mix' | 'add' | 'del'; a?: number | null; b?: number | null }> = [];

  if (n * m > 4e6) {
    for (let i = 0; i < Math.max(n, m); i++) {
      ops.push(
        A[i] === B[i]
          ? { t: 'eq', a: i, b: i }
          : { t: 'mix', a: i < n ? i : null, b: i < m ? i : null }
      );
    }
  } else {
    const W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] =
          A[i].trimEnd() === B[j].trimEnd()
            ? dp[(i + 1) * W + j + 1] + 1
            : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
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

  const rows: LineDiffRow[] = [];
  const E = '#efede7';
  const mk = (ia: number | null | undefined, ib: number | null | undefined, kind: 'eq' | 'x'): LineDiffRow => ({
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

  for (let k = 0; k < ops.length; ) {
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
    const dels: typeof ops = [];
    const adds: typeof ops = [];
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

export const isMermaidPath = (p: string): boolean => /\.(mmd|mermaid|md|markdown)$/i.test(p);

export function mermaidBlocks(path: string, text: string | null): string[] {
  if (text == null) return [];
  if (!/\.(md|markdown)$/i.test(path)) return [text];
  const re = /`{3}mermaid[^\n]*\n([\s\S]*?)`{3}/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

export const CH: Record<string, { label: string; bg: string; ink: string }> = {
  add: { label: 'added', bg: '#e2f3e7', ink: '#146b39' },
  edit: { label: 'modified', bg: '#fbefd3', ink: '#7a5010' },
  delete: { label: 'deleted', bg: '#fbe5e2', ink: '#a12a21' }
};

export const firstLine = (s: string): string =>
  (s || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('%%') && l !== '---') || 'flowchart TD';

export function buildFullDiff(rawSrcA: string, rawSrcB: string, dim: boolean): ComputedDiffResult {
  const blankA = !rawSrcA.trim() && !!rawSrcB.trim();
  const blankB = !rawSrcB.trim() && !!rawSrcA.trim();
  const srcA = blankA ? firstLine(rawSrcB) : rawSrcA;
  const srcB = blankB ? firstLine(rawSrcA) : rawSrcB;

  const A = parseFlow(srcA);
  const B = parseFlow(srcB);
  const flow = A.isFlow && B.isFlow && A.type === 'flowchart' && B.type === 'flowchart';
  const rows = lineDiff(blankA ? '' : srcA, blankB ? '' : srcB);

  if (!flow) {
    return {
      A,
      B,
      blankA,
      blankB,
      flow: false,
      rows,
      srcA,
      srcB,
      srcO: null,
      nodes: [],
      edges: []
    };
  }

  const { nodes, edges } = computeDiff(A, B);
  const pick = (st: string) => nodes.filter((n) => n.status === st).map((n) => n.id);
  const same = pick('same');

  const decA = decorate(
    srcA,
    { mdDel: pick('del'), mdMod: pick('mod'), mdDim: dim ? same : [] },
    {
      del: edges.filter((e) => e.status === 'del' && e.a).map((e) => e.a!.idx),
      mod: edges.filter((e) => e.status === 'mod' && e.a).map((e) => e.a!.idx),
      dim: dim ? edges.filter((e) => e.status === 'same' && e.a).map((e) => e.a!.idx) : []
    }
  );

  const decB = decorate(
    srcB,
    { mdAdd: pick('add'), mdMod: pick('mod'), mdDim: dim ? same : [] },
    {
      add: edges.filter((e) => e.status === 'add' && e.b).map((e) => e.b!.idx),
      mod: edges.filter((e) => e.status === 'mod' && e.b).map((e) => e.b!.idx),
      dim: dim ? edges.filter((e) => e.status === 'same' && e.b).map((e) => e.b!.idx) : []
    }
  );

  const L = [`flowchart ${B.dir || 'TD'}`];
  for (const n of nodes) {
    const nd = (n.b || n.a)!;
    L.push('  ' + n.id + (nd.shape ? (nd.open || '') + (nd.text || '') + (nd.close || '') : ''));
  }
  const lk: Record<'add' | 'del' | 'mod' | 'dim', number[]> = { add: [], del: [], mod: [], dim: [] };
  edges.forEach((e, i) => {
    const src = (e.b || e.a)!.e;
    const lab = cleanLabel(src.label);
    L.push(
      `  ${src.from} ${opFor(src.t, e.status === 'del')}${
        lab ? '|"' + lab.replace(/"/g, '#quot;') + '"|' : ''
      } ${src.to}`
    );
    if (e.status === 'same') {
      if (dim) lk.dim.push(i);
    } else {
      lk[e.status].push(i);
    }
    e.oIdx = i;
  });

  const decO = decorate(
    L.join('\n'),
    { mdAdd: pick('add'), mdGhost: pick('del'), mdMod: pick('mod'), mdDim: dim ? same : [] },
    { add: lk.add, ghost: lk.del, mod: lk.mod, dim: lk.dim }
  );

  return {
    A,
    B,
    blankA,
    blankB,
    flow: true,
    rows,
    srcA: decA,
    srcB: decB,
    srcO: decO,
    nodes,
    edges
  };
}

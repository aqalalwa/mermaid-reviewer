import { AdoApi, AdoProject, AdoRepo } from '../types';

export const SAMPLE_A = `flowchart TD
  start([Customer opens cart]) --> review[Review items]
  review --> login{Signed in?}
  login -->|No| guest[Guest checkout]
  login -->|Yes| address[Shipping address]
  guest --> address
  address --> payment[Card payment]
  payment --> confirm[Order confirmed]
  confirm --> email[Send receipt email]`;

export const SAMPLE_B = `flowchart TD
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FENCE = '```';
const md = (title: string, blocks: Array<[string, string]>) =>
  '# ' +
  title +
  '\n\n' +
  blocks.map(([h, b]) => '## ' + h + '\n\n' + FENCE + 'mermaid\n' + b + '\n' + FENCE + '\n').join('\n');

const PROMO = SAMPLE_A.replace(
  'review --> login{Signed in?}',
  'review --> promo[Apply promo code]\n  promo --> login{Signed in?}'
);
const REFUND_A =
  'flowchart TD\n  req([Refund requested]) --> check{Within 30 days?}\n  check -->|Yes| approve[Auto-approve]\n  check -->|No| manual[Manual review]\n  manual --> approve\n  approve --> payout[Issue refund]';
const FRAUD =
  'flowchart TD\n  order([Order placed]) --> score[Risk score]\n  score --> high{Score over 80?}\n  high -->|Yes| hold[Hold for review]\n  high -->|No| ship[Release to fulfilment]\n  hold --> ship';
const CTX_A =
  'flowchart LR\n  web[Web app] --> api[Checkout API]\n  api --> pay[Payments]\n  api --> inv[(Inventory DB)]';
const CTX_B = CTX_A + '\n  api --> wallet[Wallet provider]';
const EVT_A =
  'flowchart LR\n  api[Checkout API] --> bus{{Event bus}}\n  bus --> mail[Email worker]';
const EVT_B = EVT_A + '\n  bus --> sms[SMS worker]\n  bus --> analytics[Analytics]';
const SEQ =
  'sequenceDiagram\n  participant U as User\n  participant G as Gateway\n  U->>G: POST /login\n  G-->>U: 200 + session';
const SVC_A =
  'flowchart LR\n  gw[API gateway] --> orders[Orders]\n  gw --> users[Users]\n  orders --> db[(Postgres)]\n  users --> db';
const SVC_B =
  'flowchart LR\n  gw[API gateway] --> orders[Orders]\n  gw --> users[Users]\n  orders --> odb[(Orders DB)]\n  users --> udb[(Users DB)]\n  orders -.-> cache[(Redis)]';
const DEP =
  'flowchart TD\n  pr([Pull request]) --> ci[Build + test]\n  ci --> stage[Staging]\n  stage --> prod[Production]';
const LOGIN_A =
  'flowchart TD\n  enter([Enter email]) --> pw[Password]\n  pw --> ok{Valid?}\n  ok -->|Yes| home[Dashboard]\n  ok -->|No| pw';
const LOGIN_B =
  'flowchart TD\n  enter([Enter email]) --> pw[Password]\n  pw --> ok{Valid?}\n  ok -->|Yes| mfa[One-time code]\n  mfa --> home[Dashboard]\n  ok -->|No| pw\n  mfa -->|Expired| pw';

const R1: Record<string, string> = {
  '/docs/flows/checkout.mmd': SAMPLE_A,
  '/docs/flows/refunds.mmd': REFUND_A,
  '/docs/README.md': md('Checkout service', [
    ['Context', CTX_A],
    ['Events', EVT_A]
  ]),
  '/docs/sequence/login.mmd': SEQ
};

export const DEMO: {
  projects: AdoProject[];
  repos: Record<string, AdoRepo[]>;
  trees: Record<string, Record<string, Record<string, string>>>;
} = {
  projects: [
    { id: 'p1', name: 'Commerce Platform' },
    { id: 'p2', name: 'Identity' }
  ],
  repos: {
    p1: [
      { id: 'r1', name: 'checkout-service', defaultBranch: 'main' },
      { id: 'r2', name: 'architecture-docs', defaultBranch: 'main' }
    ],
    p2: [{ id: 'r3', name: 'auth-gateway', defaultBranch: 'main' }]
  },
  trees: {
    r1: {
      main: R1,
      'feature/wallet-payments': {
        ...R1,
        '/docs/flows/checkout.mmd': SAMPLE_B,
        '/docs/flows/fraud-check.mmd': FRAUD,
        '/docs/README.md': md('Checkout service', [
          ['Context', CTX_B],
          ['Events', EVT_B]
        ])
      },
      'feature/promo-codes': { ...R1, '/docs/flows/checkout.mmd': PROMO },
      'release/2026.10': R1
    },
    r2: {
      main: { '/architecture/services.mmd': SVC_A, '/architecture/deploy.mmd': DEP },
      'docs/split-databases': { '/architecture/services.mmd': SVC_B, '/architecture/deploy.mmd': DEP }
    },
    r3: {
      main: { '/docs/login-flow.mmd': LOGIN_A },
      'feature/mfa': { '/docs/login-flow.mmd': LOGIN_B }
    }
  }
};

export const demoApi: AdoApi = {
  projects: async () => {
    await wait(350);
    return DEMO.projects;
  },
  repos: async (p: string) => {
    await wait(200);
    return DEMO.repos[p] || [];
  },
  branches: async (_p: string, r: string) => {
    await wait(200);
    return Object.keys(DEMO.trees[r] || {});
  },
  files: async (_p: string, r: string, b: string) => {
    await wait(160);
    return Object.keys((DEMO.trees[r] || {})[b] || {});
  },
  changes: async (_p: string, r: string, base: string, tgt: string) => {
    const A = DEMO.trees[r]?.[base] || {};
    const B = DEMO.trees[r]?.[tgt] || {};
    const m: Record<string, string> = {};
    new Set([...Object.keys(A), ...Object.keys(B)]).forEach((k) => {
      if (A[k] !== B[k]) m[k] = 'edit';
    });
    return m;
  },
  content: async (_p: string, r: string, b: string, path: string) => {
    await wait(220);
    const t = ((DEMO.trees[r] || {})[b] || {})[path];
    return t == null ? null : t;
  }
};

export type ViewMode = 'split' | 'overlay' | 'source';
export type DiffFilter = 'all' | 'add' | 'del' | 'mod';
export type DiffStatus = 'add' | 'del' | 'mod' | 'same';
export type PaneKey = 'a' | 'b' | 'o';
export type AuthMethod = 'pat' | 'sso';

export interface TransformState {
  x: number;
  y: number;
  s: number;
}

export interface ParsedNode {
  id: string;
  shape: string | null;
  open?: string | null;
  close?: string | null;
  text: string | null;
  i?: number;
}

export interface EdgeTypeInfo {
  line: 'invisible' | 'dotted' | 'thick' | 'solid';
  end: 'arrow' | 'circle' | 'cross' | 'open';
  bi: boolean;
}

export interface ParsedEdge {
  from: string;
  to: string;
  t: EdgeTypeInfo;
  label: string;
}

export interface KeyedEdge {
  e: ParsedEdge;
  idx: number;
  occ: number;
}

export interface ParsedFlow {
  isFlow: boolean;
  type: string;
  dir?: string;
  nodes?: Map<string, ParsedNode>;
  order?: string[];
  edges?: ParsedEdge[];
}

export interface DiffNode {
  id: string;
  status: DiffStatus;
  a?: ParsedNode;
  b?: ParsedNode;
  la?: string;
  lb?: string;
  sa?: string;
  sb?: string;
}

export interface DiffEdge {
  key: string;
  status: DiffStatus;
  a?: KeyedEdge;
  b?: KeyedEdge;
  oIdx?: number;
}

export interface LineDiffRow {
  la: number | string;
  ta: string;
  lb: number | string;
  tb: string;
  bA: string;
  gA: string;
  cA: string;
  bB: string;
  gB: string;
  cB: string;
}

export interface ComputedDiffResult {
  A: ParsedFlow;
  B: ParsedFlow;
  blankA: boolean;
  blankB: boolean;
  flow: boolean;
  rows: LineDiffRow[];
  srcA: string;
  srcB: string;
  srcO: string | null;
  nodes: DiffNode[];
  edges: DiffEdge[];
}

export interface FocusTarget {
  kind: 'node' | 'edge';
  id?: string;
  pair?: [string, string];
  occ?: number;
  key: string;
  status: DiffStatus;
}

export interface AdoProject {
  id: string;
  name: string;
}

export interface AdoRepo {
  id: string;
  name: string;
  defaultBranch: string;
}

export type FileChangeKind = 'add' | 'edit' | 'delete' | null;

export interface AdoFileEntry {
  path: string;
  change: FileChangeKind;
}

export interface AdoApi {
  projects(): Promise<AdoProject[]>;
  repos(projectId: string): Promise<AdoRepo[]>;
  branches(projectId: string, repoId: string): Promise<string[]>;
  files(projectId: string, repoId: string, branch: string): Promise<string[]>;
  changes(projectId: string, repoId: string, baseBranch: string, targetBranch: string): Promise<Record<string, string>>;
  content(projectId: string, repoId: string, branch: string, path: string): Promise<string | null>;
}

export interface AdoPickState {
  project?: string;
  projectName?: string;
  repo?: string;
  repoName?: string;
  source?: string;
  target?: string;
  path?: string | null;
}

export interface AdoActiveSession extends AdoPickState {
  mode: 'demo' | 'live';
  authMethod?: AuthMethod;
  org: string;
}

export interface MermaidDiffProps {
  defaultView?: ViewMode;
  syncPanZoom?: boolean;
  dimUnchanged?: boolean;
  adoDemoOnLoad?: boolean;
  ssoClientId?: string;
  ssoTenantId?: string;
}

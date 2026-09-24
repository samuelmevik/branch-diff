export type DiffStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?';

export interface FileDiff {
  relPath: string;
  oldRelPath?: string;
  status: DiffStatus;
  insertions: number;
  deletions: number;
  isBinary: boolean;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
}

export type DiffMode = 'mergeBase' | 'direct';
export type ViewMode = 'tree' | 'flat';

export interface DiffSummary {
  filesCount: number;
  insertions: number;
  deletions: number;
}

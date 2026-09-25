import * as vscode from 'vscode';
import * as path from 'path';
import { DiffMode, DiffStatus, FileDiff, RepoState, ViewMode } from '../git/types';
import { GitService } from '../git/gitService';

export type TreeElement = RepositoryTreeItem | SummaryItem | MessageItem | DirectoryItem | ChangedFileItem;

export class RepositoryTreeItem extends vscode.TreeItem {
  constructor(public readonly repoState: RepoState) {
    super(repoState.displayName, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'repository';
    this.iconPath = new vscode.ThemeIcon('repo');
    const ins = repoState.changedFiles.reduce((acc, f) => acc + f.insertions, 0);
    const del = repoState.changedFiles.reduce((acc, f) => acc + f.deletions, 0);
    const base = repoState.baseBranch || '(no base)';
    const modeTag = repoState.diffMode === 'mergeBase' ? 'PR' : 'Direct';

    this.description = `${base} ⟵ ${repoState.currentBranch} (${repoState.changedFiles.length} files: +${ins}, -${del})`;
    this.tooltip = `Repository: ${repoState.displayName}\nPath: ${repoState.repoRoot}\nComparison: ${repoState.currentBranch} against ${base}\nMode: ${modeTag}\nTotal: ${repoState.changedFiles.length} files (+${ins}, -${del})`;
  }
}

export class SummaryItem extends vscode.TreeItem {
  constructor(
    public readonly currentBranch: string,
    public readonly baseBranch: string,
    public readonly mode: DiffMode,
    public readonly filesCount: number,
    public readonly totalInsertions: number,
    public readonly totalDeletions: number,
    public readonly repoRoot?: string
  ) {
    super(
      `${baseBranch} ⟵ ${currentBranch}`,
      vscode.TreeItemCollapsibleState.None
    );

    const modeLabel = mode === 'mergeBase' ? 'PR Mode (merge-base)' : 'Direct Diff';
    this.description = `${filesCount} files (+${totalInsertions}, -${totalDeletions})`;
    this.tooltip = `Comparing current branch "${currentBranch}" against base "${baseBranch}"\nMode: ${modeLabel}\nTotal: ${filesCount} files (+${totalInsertions}, -${totalDeletions})`;
    this.iconPath = new vscode.ThemeIcon('git-compare');
    this.contextValue = 'summary';

    this.command = {
      command: 'branchDiff.selectBaseBranch',
      title: 'Change Base Branch',
      arguments: [this]
    };
  }
}

export class MessageItem extends vscode.TreeItem {
  constructor(
    message: string,
    commandId?: string,
    commandTitle?: string,
    iconId: string = 'info',
    commandArgs?: any[]
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(iconId);
    if (commandId) {
      this.command = {
        command: commandId,
        title: commandTitle || message,
        arguments: commandArgs
      };
    }
  }
}

export class DirectoryItem extends vscode.TreeItem {
  public readonly children: (DirectoryItem | ChangedFileItem)[] = [];

  constructor(public readonly dirName: string, public readonly fullPath: string) {
    super(dirName, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = vscode.ThemeIcon.Folder;
    this.contextValue = 'directory';
  }
}

export class ChangedFileItem extends vscode.TreeItem {
  constructor(
    public readonly fileDiff: FileDiff,
    public readonly repoRoot: string,
    public readonly baseBranch: string,
    public readonly displayMode: ViewMode
  ) {
    const filename = path.posix.basename(fileDiff.relPath);
    const label = displayMode === 'flat' ? fileDiff.relPath : filename;

    super(label, vscode.TreeItemCollapsibleState.None);

    this.resourceUri = vscode.Uri.file(path.join(repoRoot, fileDiff.relPath));
    this.contextValue = 'file';

    const statText = fileDiff.isBinary
      ? 'binary'
      : `+${fileDiff.insertions}, -${fileDiff.deletions}`;
    this.description = `[${fileDiff.status}] ${statText}`;

    const statusMap: Record<DiffStatus, string> = {
      'M': 'Modified',
      'A': 'Added',
      'D': 'Deleted',
      'R': 'Renamed',
      'C': 'Copied',
      'U': 'Unmerged',
      '?': 'Untracked'
    };

    const statusName = statusMap[fileDiff.status] || fileDiff.status;
    this.tooltip = `${fileDiff.relPath}\nStatus: ${statusName}\nStats: ${statText}`;

    // Select appropriate ThemeIcon with decoration color
    this.iconPath = this.getIconForStatus(fileDiff.status);

    // Clicking the item opens the editable diff
    this.command = {
      command: 'branchDiff.openDiff',
      title: 'Open Diff',
      arguments: [this]
    };
  }

  private getIconForStatus(status: DiffStatus): vscode.ThemeIcon {
    switch (status) {
      case 'A':
      case '?':
        return new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
      case 'D':
        return new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
      case 'R':
      case 'C':
        return new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.renamedResourceForeground'));
      case 'M':
      default:
        return new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    }
  }
}

export class ChangedFilesTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repos: Map<string, RepoState> = new Map();
  private defaultDiffMode: DiffMode = 'mergeBase';
  private viewMode: ViewMode = 'tree';
  private isInitializing: boolean = false;
  private treeView?: vscode.TreeView<TreeElement>;

  constructor() {
    const config = vscode.workspace.getConfiguration('branchDiff');
    this.defaultDiffMode = (config.get<string>('diffMode') as DiffMode) || 'mergeBase';
    this.viewMode = (config.get<string>('viewMode') as ViewMode) || 'tree';
  }

  public setTreeView(treeView: vscode.TreeView<TreeElement>): void {
    this.treeView = treeView;
  }

  public getPrimaryRepo(): RepoState | undefined {
    const first = this.repos.values().next();
    return first.done ? undefined : first.value;
  }

  public getRepoRoot(): string | null {
    return this.getPrimaryRepo()?.repoRoot || null;
  }

  public getRepoRoots(): string[] {
    return Array.from(this.repos.keys());
  }

  public getRepos(): RepoState[] {
    return Array.from(this.repos.values());
  }

  public getRepo(repoRoot: string): RepoState | undefined {
    return this.repos.get(GitService.normalizePath(repoRoot));
  }

  public getRepoForPath(filePath: string): RepoState | undefined {
    const normPath = GitService.normalizePath(filePath).toLowerCase();
    let bestMatch: RepoState | undefined;
    let bestLen = -1;

    for (const repo of this.repos.values()) {
      const repoNorm = repo.repoRoot.toLowerCase();
      if (
        normPath === repoNorm ||
        normPath.startsWith(repoNorm + path.sep.toLowerCase()) ||
        normPath.startsWith(repoNorm + '/')
      ) {
        if (repoNorm.length > bestLen) {
          bestLen = repoNorm.length;
          bestMatch = repo;
        }
      }
    }

    return bestMatch || this.getPrimaryRepo();
  }

  public resolveRepoRoot(target?: any): string | undefined {
    const unwrapped = Array.isArray(target) ? target[0] : target;
    if (typeof unwrapped === 'string') return unwrapped;
    if (unwrapped instanceof RepositoryTreeItem) return unwrapped.repoState.repoRoot;
    if (unwrapped instanceof SummaryItem && unwrapped.repoRoot) return unwrapped.repoRoot;
    if (unwrapped instanceof ChangedFileItem) return unwrapped.repoRoot;
    if (unwrapped?.repoState?.repoRoot) return unwrapped.repoState.repoRoot;
    if (unwrapped?.repoRoot) return unwrapped.repoRoot;
    if (unwrapped instanceof vscode.Uri) return this.getRepoForPath(unwrapped.fsPath)?.repoRoot;
    return undefined;
  }

  public getCurrentBranch(repoRoot?: string): string {
    if (repoRoot) {
      return this.getRepo(repoRoot)?.currentBranch || '';
    }
    return this.getPrimaryRepo()?.currentBranch || '';
  }

  public getBaseBranch(repoRoot?: string): string {
    if (repoRoot) {
      return this.getRepo(repoRoot)?.baseBranch || '';
    }
    return this.getPrimaryRepo()?.baseBranch || '';
  }

  public getDiffMode(repoRoot?: string): DiffMode {
    if (repoRoot) {
      return this.getRepo(repoRoot)?.diffMode || this.defaultDiffMode;
    }
    return this.getPrimaryRepo()?.diffMode || this.defaultDiffMode;
  }

  public getViewMode(): ViewMode {
    return this.viewMode;
  }

  public async setBaseBranch(repoRoot: string, branch: string): Promise<void> {
    const repo = this.getRepo(repoRoot);
    if (repo) {
      repo.baseBranch = branch;
      await this.loadDiffForRepo(repo.repoRoot);
      this.updateTreeViewMetadata();
      this._onDidChangeTreeData.fire();
    }
  }

  public setDiffMode(mode: DiffMode, repoRoot?: string): void {
    if (repoRoot) {
      const repo = this.getRepo(repoRoot);
      if (repo) {
        repo.diffMode = mode;
      }
    } else {
      this.defaultDiffMode = mode;
      for (const repo of this.repos.values()) {
        repo.diffMode = mode;
      }
    }
    this.refresh(repoRoot);
  }

  public toggleViewMode(): void {
    this.viewMode = this.viewMode === 'tree' ? 'flat' : 'tree';
    this._onDidChangeTreeData.fire();
  }

  public getChangedFiles(repoRoot?: string): FileDiff[] {
    if (repoRoot) {
      return this.getRepo(repoRoot)?.changedFiles || [];
    }
    const all: FileDiff[] = [];
    for (const r of this.repos.values()) {
      all.push(...r.changedFiles);
    }
    return all;
  }

  public getFileDiff(relPath: string, repoRoot?: string): FileDiff | undefined {
    const norm = relPath.replace(/\\/g, '/');
    if (repoRoot) {
      return this.getRepo(repoRoot)?.changedFiles.find(
        (f) => f.relPath === norm || (f.oldRelPath && f.oldRelPath === norm)
      );
    }
    for (const r of this.repos.values()) {
      const found = r.changedFiles.find(
        (f) => f.relPath === norm || (f.oldRelPath && f.oldRelPath === norm)
      );
      if (found) return found;
    }
    return undefined;
  }

  public async getComparisonRef(repoRoot?: string): Promise<string> {
    const repo = repoRoot ? this.getRepo(repoRoot) : this.getPrimaryRepo();
    if (!repo || !repo.baseBranch) {
      return '';
    }
    if (repo.diffMode === 'mergeBase') {
      const mergeBase = await GitService.getMergeBase(repo.repoRoot, repo.baseBranch, 'HEAD');
      if (mergeBase) {
        return mergeBase;
      }
    }
    return repo.baseBranch;
  }

  private getRepoDisplayName(repoRoot: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders || [];
    const normRepo = GitService.normalizePath(repoRoot);

    for (const wf of workspaceFolders) {
      const normWf = GitService.normalizePath(wf.uri.fsPath);
      if (normRepo.toLowerCase() === normWf.toLowerCase()) {
        return wf.name;
      }
      if (normRepo.toLowerCase().startsWith(normWf.toLowerCase() + path.sep.toLowerCase())) {
        const rel = path.relative(normWf, normRepo).replace(/\\/g, '/');
        return `${wf.name}/${rel}`;
      }
    }
    return path.basename(repoRoot);
  }

  private async detectBaseBranch(repoRoot: string, currentBranch: string): Promise<string> {
    const config = vscode.workspace.getConfiguration('branchDiff');
    const configuredDefault = config.get<string>('defaultBaseBranch')?.trim();

    if (configuredDefault && (await GitService.refExists(repoRoot, configuredDefault))) {
      return configuredDefault;
    }

    const candidateBases = ['main', 'master', 'origin/main', 'origin/master', 'develop'];
    for (const candidate of candidateBases) {
      if (candidate !== currentBranch && (await GitService.refExists(repoRoot, candidate))) {
        return candidate;
      }
    }

    const allBranches = await GitService.getBranches(repoRoot);
    const other = allBranches.find((b) => b.name !== currentBranch && !b.isCurrent);
    return other ? other.name : '';
  }

  public async initialize(knownRoots: string[] = []): Promise<void> {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders || [];
      if (workspaceFolders.length === 0 && knownRoots.length === 0) {
        this.repos.clear();
        this.updateTreeViewMetadata();
        this._onDidChangeTreeData.fire();
        return;
      }

      const wsRoots = workspaceFolders.map((w) => w.uri.fsPath);
      const discoveredRoots = await GitService.findRepositories(wsRoots, knownRoots);

      const newRepos = new Map<string, RepoState>();

      for (const root of discoveredRoots) {
        const normRoot = GitService.normalizePath(root);
        const existing = this.repos.get(normRoot);

        const currentBranch = await GitService.getCurrentBranch(normRoot);
        let baseBranch = existing?.baseBranch || '';
        if (!baseBranch || !(await GitService.refExists(normRoot, baseBranch))) {
          baseBranch = await this.detectBaseBranch(normRoot, currentBranch);
        }

        const diffMode = existing?.diffMode || this.defaultDiffMode;
        const displayName = this.getRepoDisplayName(normRoot);

        newRepos.set(normRoot, {
          repoRoot: normRoot,
          displayName,
          currentBranch,
          baseBranch,
          diffMode,
          changedFiles: existing?.changedFiles || [],
          isLoading: false
        });
      }

      this.repos = newRepos;
      await this.loadAllDiffs();
    } finally {
      this.isInitializing = false;
      this.updateTreeViewMetadata();
      this._onDidChangeTreeData.fire();
    }
  }

  public async refresh(targetRepoRoot?: string): Promise<void> {
    if (this.repos.size === 0) {
      await this.initialize();
      return;
    }

    if (targetRepoRoot) {
      const norm = GitService.normalizePath(targetRepoRoot);
      const repo = this.repos.get(norm);
      if (repo) {
        repo.currentBranch = await GitService.getCurrentBranch(norm);
        await this.loadDiffForRepo(norm);
      }
    } else {
      for (const repo of this.repos.values()) {
        repo.currentBranch = await GitService.getCurrentBranch(repo.repoRoot);
      }
      await this.loadAllDiffs();
    }

    this.updateTreeViewMetadata();
    this._onDidChangeTreeData.fire();
  }

  public async loadDiffForRepo(repoRoot: string): Promise<void> {
    const repo = this.repos.get(GitService.normalizePath(repoRoot));
    if (!repo) return;

    if (!repo.baseBranch) {
      repo.changedFiles = [];
      return;
    }

    repo.isLoading = true;
    try {
      const allRoots = Array.from(this.repos.keys());
      const nestedInside = allRoots.filter(
        (r) =>
          r !== repo.repoRoot &&
          r.toLowerCase().startsWith(repo.repoRoot.toLowerCase() + path.sep.toLowerCase())
      );

      repo.changedFiles = await GitService.getDiffFiles(
        repo.repoRoot,
        repo.baseBranch,
        repo.diffMode,
        nestedInside
      );
    } catch (err: any) {
      console.error(`Failed to load diff files for ${repo.displayName}:`, err);
      repo.changedFiles = [];
      repo.error = err?.message || String(err);
    } finally {
      repo.isLoading = false;
    }
  }

  public async loadAllDiffs(): Promise<void> {
    const roots = Array.from(this.repos.keys());
    await Promise.all(roots.map((r) => this.loadDiffForRepo(r)));
  }

  private updateTreeViewMetadata(): void {
    if (!this.treeView) return;

    if (this.repos.size === 0) {
      this.treeView.description = 'No repository';
      this.treeView.badge = undefined;
      return;
    }

    if (this.repos.size === 1) {
      const repo = this.getPrimaryRepo()!;
      if (!repo.baseBranch) {
        this.treeView.description = 'Select a base branch';
        this.treeView.badge = undefined;
        return;
      }

      const modeTag = repo.diffMode === 'mergeBase' ? 'PR' : 'Direct';
      this.treeView.description = `${repo.baseBranch} ⟵ ${repo.currentBranch} [${modeTag}]`;
      const count = repo.changedFiles.length;
      this.treeView.badge =
        count > 0 ? { value: count, tooltip: `${count} changed files` } : undefined;
      return;
    }

    const totalFiles = Array.from(this.repos.values()).reduce(
      (sum, r) => sum + r.changedFiles.length,
      0
    );
    this.treeView.description = `${this.repos.size} repos (${totalFiles} changed files)`;
    this.treeView.badge =
      totalFiles > 0
        ? { value: totalFiles, tooltip: `${totalFiles} changed files across ${this.repos.size} repositories` }
        : undefined;
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (this.repos.size === 0) {
      return [
        new MessageItem('No Git repository detected in workspace', undefined, undefined, 'warning')
      ];
    }

    if (element instanceof DirectoryItem) {
      return element.children;
    }

    // Single repository layout (direct view)
    if (this.repos.size === 1) {
      return element ? [] : this.getRepoChildren(this.getPrimaryRepo()!);
    }

    // Multiple repositories layout: top level lists all repos
    if (!element) {
      return Array.from(this.repos.values()).map((repo) => new RepositoryTreeItem(repo));
    }

    // Children of a specific repository item
    if (element instanceof RepositoryTreeItem) {
      return this.getRepoChildren(element.repoState);
    }

    return [];
  }

  private getRepoChildren(repo: RepoState): TreeElement[] {
    const totalIns = repo.changedFiles.reduce((acc, f) => acc + f.insertions, 0);
    const totalDel = repo.changedFiles.reduce((acc, f) => acc + f.deletions, 0);

    const items: TreeElement[] = [
      new SummaryItem(
        repo.currentBranch,
        repo.baseBranch,
        repo.diffMode,
        repo.changedFiles.length,
        totalIns,
        totalDel,
        repo.repoRoot
      )
    ];

    if (!repo.baseBranch) {
      items.push(
        new MessageItem(
          'Click to select a base branch...',
          'branchDiff.selectBaseBranch',
          'Select Base Branch',
          'git-branch',
          [repo.repoRoot]
        )
      );
      return items;
    }

    if (repo.changedFiles.length === 0) {
      items.push(
        new MessageItem(
          `No changes between ${repo.currentBranch} and ${repo.baseBranch}`,
          undefined,
          undefined,
          'check'
        )
      );
      return items;
    }

    items.push(...this.addFilesToTree(repo.changedFiles, repo.repoRoot, repo.baseBranch));
    return items;
  }

  private addFilesToTree(
    files: FileDiff[],
    repoRoot: string,
    baseBranch: string
  ): TreeElement[] {
    if (this.viewMode === 'flat') {
      return files.map((file) => new ChangedFileItem(file, repoRoot, baseBranch, 'flat'));
    }

    const rootDir = new DirectoryItem('', '');
    for (const file of files) {
      const parts = file.relPath.split('/');
      let currentDir = rootDir;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        let subDir = currentDir.children.find(
          (c): c is DirectoryItem => c instanceof DirectoryItem && c.dirName === part
        );

        if (!subDir) {
          const fullSubDirPath = path.posix.join(currentDir.fullPath, part);
          subDir = new DirectoryItem(part, fullSubDirPath);
          currentDir.children.push(subDir);
        }
        currentDir = subDir;
      }

      currentDir.children.push(
        new ChangedFileItem(file, repoRoot, baseBranch, 'tree')
      );
    }

    return rootDir.children;
  }
}

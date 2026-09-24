import * as vscode from 'vscode';
import * as path from 'path';
import { DiffMode, DiffStatus, FileDiff, ViewMode } from '../git/types';
import { GitService } from '../git/gitService';

export type TreeElement = SummaryItem | MessageItem | DirectoryItem | ChangedFileItem;

export class SummaryItem extends vscode.TreeItem {
  constructor(
    public readonly currentBranch: string,
    public readonly baseBranch: string,
    public readonly mode: DiffMode,
    public readonly filesCount: number,
    public readonly totalInsertions: number,
    public readonly totalDeletions: number
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
      title: 'Change Base Branch'
    };
  }
}

export class MessageItem extends vscode.TreeItem {
  constructor(message: string, commandId?: string, commandTitle?: string, iconId: string = 'info') {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(iconId);
    if (commandId) {
      this.command = {
        command: commandId,
        title: commandTitle || message
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

  private repoRoot: string | null = null;
  private currentBranch: string = '';
  private baseBranch: string = '';
  private diffMode: DiffMode = 'mergeBase';
  private viewMode: ViewMode = 'tree';
  private changedFiles: FileDiff[] = [];
  private isLoading: boolean = false;

  private treeView?: vscode.TreeView<TreeElement>;

  constructor() {
    const config = vscode.workspace.getConfiguration('branchDiff');
    this.diffMode = (config.get<string>('diffMode') as DiffMode) || 'mergeBase';
    this.viewMode = (config.get<string>('viewMode') as ViewMode) || 'tree';
  }

  public setTreeView(treeView: vscode.TreeView<TreeElement>): void {
    this.treeView = treeView;
  }

  public getRepoRoot(): string | null {
    return this.repoRoot;
  }

  public getCurrentBranch(): string {
    return this.currentBranch;
  }

  public getBaseBranch(): string {
    return this.baseBranch;
  }

  public getDiffMode(): DiffMode {
    return this.diffMode;
  }

  public getViewMode(): ViewMode {
    return this.viewMode;
  }

  public setBaseBranch(branch: string): void {
    this.baseBranch = branch;
    this.refresh();
  }

  public setDiffMode(mode: DiffMode): void {
    this.diffMode = mode;
    this.refresh();
  }

  public toggleViewMode(): void {
    this.viewMode = this.viewMode === 'tree' ? 'flat' : 'tree';
    this._onDidChangeTreeData.fire();
  }

  public async initialize(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.repoRoot = null;
      this._onDidChangeTreeData.fire();
      return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    this.repoRoot = await GitService.findRepoRoot(rootPath);
    if (!this.repoRoot) {
      this._onDidChangeTreeData.fire();
      return;
    }

    this.currentBranch = await GitService.getCurrentBranch(this.repoRoot);

    // Auto-detect base branch if none set
    if (!this.baseBranch) {
      const config = vscode.workspace.getConfiguration('branchDiff');
      const configuredDefault = config.get<string>('defaultBaseBranch')?.trim();

      if (configuredDefault && (await GitService.refExists(this.repoRoot, configuredDefault))) {
        this.baseBranch = configuredDefault;
      } else {
        // Try common base branches
        const candidateBases = ['main', 'master', 'origin/main', 'origin/master', 'develop'];
        for (const candidate of candidateBases) {
          if (candidate !== this.currentBranch && (await GitService.refExists(this.repoRoot, candidate))) {
            this.baseBranch = candidate;
            break;
          }
        }

        // If none found, pick the first other branch if available
        if (!this.baseBranch) {
          const allBranches = await GitService.getBranches(this.repoRoot);
          const other = allBranches.find((b) => b.name !== this.currentBranch && !b.isCurrent);
          if (other) {
            this.baseBranch = other.name;
          }
        }
      }
    }

    await this.loadDiff();
  }

  public async refresh(): Promise<void> {
    if (!this.repoRoot) {
      await this.initialize();
      return;
    }

    this.currentBranch = await GitService.getCurrentBranch(this.repoRoot);
    await this.loadDiff();
  }

  private async loadDiff(): Promise<void> {
    if (!this.repoRoot || !this.baseBranch) {
      this.changedFiles = [];
      this.updateTreeViewMetadata(0);
      this._onDidChangeTreeData.fire();
      return;
    }

    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    try {
      this.changedFiles = await GitService.getDiffFiles(
        this.repoRoot,
        this.baseBranch,
        this.diffMode
      );
      this.updateTreeViewMetadata(this.changedFiles.length);
    } catch (err) {
      console.error('Failed to load diff files:', err);
      this.changedFiles = [];
      this.updateTreeViewMetadata(0);
    } finally {
      this.isLoading = false;
      this._onDidChangeTreeData.fire();
    }
  }

  private updateTreeViewMetadata(filesCount: number): void {
    if (!this.treeView) return;

    if (!this.baseBranch) {
      this.treeView.description = 'Select a base branch';
      this.treeView.badge = undefined;
      return;
    }

    const modeTag = this.diffMode === 'mergeBase' ? 'PR' : 'Direct';
    this.treeView.description = `${this.baseBranch} ⟵ ${this.currentBranch} [${modeTag}]`;
    this.treeView.badge = filesCount > 0 ? { value: filesCount, tooltip: `${filesCount} changed files` } : undefined;
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!this.repoRoot) {
      return [
        new MessageItem('No Git repository detected in workspace', undefined, undefined, 'warning')
      ];
    }

    if (!this.baseBranch) {
      return [
        new MessageItem(
          'Click to select a base branch to compare...',
          'branchDiff.selectBaseBranch',
          'Select Base Branch',
          'git-branch'
        )
      ];
    }

    if (element instanceof DirectoryItem) {
      return element.children;
    }

    if (!element) {
      const items: TreeElement[] = [];

      // Summary Header Item
      let totalIns = 0;
      let totalDel = 0;
      for (const f of this.changedFiles) {
        totalIns += f.insertions;
        totalDel += f.deletions;
      }

      items.push(
        new SummaryItem(
          this.currentBranch,
          this.baseBranch,
          this.diffMode,
          this.changedFiles.length,
          totalIns,
          totalDel
        )
      );

      if (this.changedFiles.length === 0) {
        items.push(
          new MessageItem(
            `No changes between ${this.currentBranch} and ${this.baseBranch}`,
            undefined,
            undefined,
            'check'
          )
        );
        return items;
      }

      if (this.viewMode === 'flat') {
        for (const file of this.changedFiles) {
          items.push(new ChangedFileItem(file, this.repoRoot, this.baseBranch, 'flat'));
        }
        return items;
      }

      // Build hierarchical folder tree
      const rootDir = new DirectoryItem('', '');
      for (const file of this.changedFiles) {
        this.addFileToTree(rootDir, file);
      }

      items.push(...rootDir.children);
      return items;
    }

    return [];
  }

  private addFileToTree(rootDir: DirectoryItem, file: FileDiff): void {
    if (!this.repoRoot) return;

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
      new ChangedFileItem(file, this.repoRoot, this.baseBranch, 'tree')
    );
  }
}

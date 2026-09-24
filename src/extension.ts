import * as vscode from 'vscode';
import { BRANCH_DIFF_SCHEME, BranchContentProvider } from './providers/branchContentProvider';
import { ChangedFilesTreeProvider } from './providers/changedFilesTreeProvider';
import { selectBaseBranch } from './commands/selectBranch';
import { openDiff, openWorkingFile } from './commands/openDiff';

export async function activate(context: vscode.ExtensionContext) {
  // 1. Register virtual document provider for base branch file snapshots
  const branchContentProvider = new BranchContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      BRANCH_DIFF_SCHEME,
      branchContentProvider
    )
  );

  // 2. Create TreeDataProvider and register TreeView
  const treeProvider = new ChangedFilesTreeProvider();
  const treeView = vscode.window.createTreeView('branchDiff.changedFilesView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });
  treeProvider.setTreeView(treeView);
  context.subscriptions.push(treeView);

  // 3. Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('branchDiff.selectBaseBranch', async () => {
      await selectBaseBranch(treeProvider);
    }),

    vscode.commands.registerCommand('branchDiff.refresh', async () => {
      await treeProvider.refresh();
      vscode.window.setStatusBarMessage('$(sync~spin) Branch diff refreshed', 2000);
    }),

    vscode.commands.registerCommand('branchDiff.toggleDiffMode', async () => {
      const currentMode = treeProvider.getDiffMode();
      const newMode = currentMode === 'mergeBase' ? 'direct' : 'mergeBase';
      treeProvider.setDiffMode(newMode);
      const label = newMode === 'mergeBase' ? 'PR Mode (merge-base)' : 'Direct Diff (base tip)';
      vscode.window.showInformationMessage(`Diff mode switched to: ${label}`);
    }),

    vscode.commands.registerCommand('branchDiff.toggleViewMode', () => {
      treeProvider.toggleViewMode();
    }),

    vscode.commands.registerCommand('branchDiff.openDiff', async (item) => {
      await openDiff(item, treeProvider);
    }),

    vscode.commands.registerCommand('branchDiff.openFile', async (item) => {
      await openWorkingFile(item, treeProvider);
    })
  );

  // 4. Initialize Diff data
  await treeProvider.initialize();

  // 5. Auto-refresh handlers
  let debounceTimeout: NodeJS.Timeout | undefined;
  const triggerDebouncedRefresh = () => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    debounceTimeout = setTimeout(() => {
      treeProvider.refresh();
    }, 600);
  };

  // Refresh when files are saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      triggerDebouncedRefresh();
    })
  );

  // Refresh when workspace folders change
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await treeProvider.initialize();
    })
  );

  // Fallback watcher for Git HEAD and index changes (e.g., git checkout, git commit in terminal)
  const repoRoot = treeProvider.getRepoRoot();
  if (repoRoot) {
    const gitHeadPattern = new vscode.RelativePattern(repoRoot, '.git/{HEAD,refs/heads/**,refs/remotes/**,index}');
    const gitWatcher = vscode.workspace.createFileSystemWatcher(gitHeadPattern);
    gitWatcher.onDidChange(() => triggerDebouncedRefresh());
    gitWatcher.onDidCreate(() => triggerDebouncedRefresh());
    gitWatcher.onDidDelete(() => triggerDebouncedRefresh());
    context.subscriptions.push(gitWatcher);
  }

  // Hook into built-in VS Code Git extension if available
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (gitExt) {
      const gitApi = gitExt.exports?.getAPI?.(1);
      if (gitApi) {
        gitApi.onDidOpenRepository((_repo: any) => triggerDebouncedRefresh());
        gitApi.onDidChangeState(() => triggerDebouncedRefresh());
        if (gitApi.repositories?.length > 0) {
          gitApi.repositories[0].state.onDidChange(() => triggerDebouncedRefresh());
        }
      }
    }
  } catch (err) {
    console.debug('Could not bind to vscode.git extension:', err);
  }
}

export function deactivate() { }

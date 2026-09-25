import * as vscode from 'vscode';
import { BRANCH_DIFF_SCHEME, BranchContentProvider } from './providers/branchContentProvider';
import { ChangedFilesTreeProvider } from './providers/changedFilesTreeProvider';
import { selectBaseBranch } from './commands/selectBranch';
import { switchBranches } from './commands/switchBranches';
import { openDiff, openWorkingFile } from './commands/openDiff';
import { revertFileChanges } from './commands/revertFile';

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
    vscode.commands.registerCommand('branchDiff.selectBaseBranch', async (item) => {
      await selectBaseBranch(treeProvider, item);
    }),

    vscode.commands.registerCommand('branchDiff.switchBranches', async (item) => {
      await switchBranches(treeProvider, item);
    }),

    vscode.commands.registerCommand('branchDiff.refresh', async (item) => {
      const targetRepoRoot = treeProvider.resolveRepoRoot(item);
      await treeProvider.refresh(targetRepoRoot);
      vscode.window.setStatusBarMessage('$(sync~spin) Branch diff refreshed', 2000);
    }),

    vscode.commands.registerCommand('branchDiff.toggleDiffMode', async (item) => {
      const targetRepoRoot = treeProvider.resolveRepoRoot(item);
      const currentMode = treeProvider.getDiffMode(targetRepoRoot);
      const newMode = currentMode === 'mergeBase' ? 'direct' : 'mergeBase';
      treeProvider.setDiffMode(newMode, targetRepoRoot);
      const label = newMode === 'mergeBase' ? 'PR Mode (merge-base)' : 'Direct Diff (base tip)';
      const repo = targetRepoRoot ? treeProvider.getRepo(targetRepoRoot) : undefined;
      const prefix = repo ? `[${repo.displayName}] ` : '';
      vscode.window.showInformationMessage(`${prefix}Diff mode switched to: ${label}`);
    }),

    vscode.commands.registerCommand('branchDiff.toggleViewMode', () => {
      treeProvider.toggleViewMode();
    }),

    vscode.commands.registerCommand('branchDiff.openDiff', async (item) => {
      await openDiff(item, treeProvider);
    }),

    vscode.commands.registerCommand('branchDiff.openFile', async (item) => {
      await openWorkingFile(item, treeProvider);
    }),

    vscode.commands.registerCommand('branchDiff.revertFile', async (item) => {
      await revertFileChanges(item, treeProvider);
    })
  );

  // 4. File Watcher Management
  let fileWatchers: vscode.FileSystemWatcher[] = [];
  const updateWatchers = () => {
    for (const w of fileWatchers) {
      w.dispose();
    }
    fileWatchers = [];

    for (const repoRoot of treeProvider.getRepoRoots()) {
      try {
        const gitHeadPattern = new vscode.RelativePattern(
          repoRoot,
          '.git/{HEAD,refs/heads/**,refs/remotes/**,index}'
        );
        const watcher = vscode.workspace.createFileSystemWatcher(gitHeadPattern);
        watcher.onDidChange(() => triggerDebouncedRefresh());
        watcher.onDidCreate(() => triggerDebouncedRefresh());
        watcher.onDidDelete(() => triggerDebouncedRefresh());
        fileWatchers.push(watcher);
      } catch (err) {
        console.debug('Failed to watch repo:', repoRoot, err);
      }
    }
  };

  context.subscriptions.push({
    dispose: () => {
      for (const w of fileWatchers) {
        w.dispose();
      }
      fileWatchers = [];
    }
  });

  // 5. Debounced refresh handler
  let debounceTimeout: NodeJS.Timeout | undefined;
  const triggerDebouncedRefresh = () => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    debounceTimeout = setTimeout(() => {
      treeProvider.refresh();
    }, 600);
  };

  const reinitAndWatch = async () => {
    const knownRoots = gitApi?.repositories?.map((r: any) => r.rootUri.fsPath) || [];
    await treeProvider.initialize(knownRoots);
    updateWatchers();
  };

  // 6. Hook into built-in VS Code Git extension if available
  let gitApi: any;
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (gitExt) {
      gitApi = gitExt.exports?.getAPI?.(1);
      if (gitApi) {
        gitApi.onDidOpenRepository(async () => {
          await reinitAndWatch();
        });
        gitApi.onDidChangeState(() => triggerDebouncedRefresh());
        for (const repo of gitApi.repositories || []) {
          repo.state.onDidChange(() => triggerDebouncedRefresh());
        }
      }
    }
  } catch (err) {
    console.debug('Could not bind to vscode.git extension:', err);
  }

  // 7. Initial load
  await reinitAndWatch();

  // 8. Event listeners
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      triggerDebouncedRefresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await reinitAndWatch();
    })
  );
}

export function deactivate() { }

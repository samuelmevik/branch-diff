import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { ChangedFilesTreeProvider } from '../providers/changedFilesTreeProvider';

export async function selectBaseBranch(
  treeProvider: ChangedFilesTreeProvider,
  target?: any
): Promise<void> {
  const allRepos = treeProvider.getRepos();
  if (allRepos.length === 0) {
    vscode.window.showWarningMessage('No Git repository detected in the current workspace.');
    return;
  }

  let targetRepoRoot = treeProvider.resolveRepoRoot(target);

  if (!targetRepoRoot) {
    if (allRepos.length === 1) {
      targetRepoRoot = allRepos[0].repoRoot;
    } else {
      interface RepoPickItem extends vscode.QuickPickItem {
        repoRoot: string;
      }

      const repoItems: RepoPickItem[] = allRepos.map((r) => ({
        label: `$(repo) ${r.displayName}`,
        description: r.baseBranch
          ? `Current base: ${r.baseBranch} (${r.currentBranch})`
          : `No base branch (${r.currentBranch})`,
        repoRoot: r.repoRoot
      }));

      const pickedRepo = await vscode.window.showQuickPick(repoItems, {
        placeHolder: 'Select a repository to choose its base branch'
      });

      if (!pickedRepo) {
        return;
      }
      targetRepoRoot = pickedRepo.repoRoot;
    }
  }

  const repo = treeProvider.getRepo(targetRepoRoot);
  if (!repo) {
    vscode.window.showErrorMessage('Selected repository was not found.');
    return;
  }

  const branches = await GitService.getBranches(repo.repoRoot);
  const currentBranch = repo.currentBranch;
  const activeBase = repo.baseBranch;

  interface BranchQuickPickItem extends vscode.QuickPickItem {
    branchName: string;
  }

  const items: BranchQuickPickItem[] = branches.map((b) => {
    let description = '';
    if (b.isCurrent) {
      description = '(Current Branch - HEAD)';
    } else if (b.name === activeBase) {
      description = '(Currently Selected Base)';
    } else if (b.isRemote) {
      description = '(Remote Branch)';
    }

    return {
      label: b.isRemote ? `$(cloud) ${b.name}` : `$(git-branch) ${b.name}`,
      description,
      branchName: b.name
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `Select base branch to compare in "${repo.displayName}" (Current: ${currentBranch})`,
    matchOnDescription: true
  });

  if (selected) {
    await treeProvider.setBaseBranch(repo.repoRoot, selected.branchName);
    vscode.window.showInformationMessage(
      `[${repo.displayName}] Comparing ${currentBranch} against base branch: ${selected.branchName}`
    );
  }
}

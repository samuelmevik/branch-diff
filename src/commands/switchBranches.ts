import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { ChangedFilesTreeProvider } from '../providers/changedFilesTreeProvider';

export async function switchBranches(
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
          ? `Current: ${r.currentBranch} ⟷ Base: ${r.baseBranch}`
          : `No base branch selected (${r.currentBranch})`,
        repoRoot: r.repoRoot
      }));

      const pickedRepo = await vscode.window.showQuickPick(repoItems, {
        placeHolder: 'Select a repository to swap its head and base branches'
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

  const currentBranch = repo.currentBranch;
  const baseBranch = repo.baseBranch;

  if (!baseBranch) {
    vscode.window.showWarningMessage(
      `No base branch selected for "${repo.displayName}". Please select a base branch first.`
    );
    return;
  }

  if (currentBranch === baseBranch) {
    vscode.window.showInformationMessage(
      `Current branch and base branch are both "${currentBranch}". Nothing to swap.`
    );
    return;
  }

  // Determine branch to checkout (resolve origin/ prefix to local branch if one exists)
  let branchToCheckout = baseBranch;
  if (branchToCheckout.startsWith('origin/')) {
    const localCandidate = branchToCheckout.replace(/^origin\//, '');
    const branches = await GitService.getBranches(repo.repoRoot);
    if (branches.some((b) => !b.isRemote && b.name === localCandidate)) {
      branchToCheckout = localCandidate;
    }
  }

  try {
    await GitService.checkout(repo.repoRoot, branchToCheckout);
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `Failed to switch to branch "${branchToCheckout}" in "${repo.displayName}": ${err?.message || err}`
    );
    return;
  }

  // Swap base branch: previous HEAD becomes the new base branch
  await treeProvider.setBaseBranch(repo.repoRoot, currentBranch);
  await treeProvider.refresh(repo.repoRoot);

  vscode.window.showInformationMessage(
    `[${repo.displayName}] Swapped branches: now on "${branchToCheckout}" (comparing against "${currentBranch}").`
  );
}

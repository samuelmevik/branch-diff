import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { ChangedFilesTreeProvider } from '../providers/changedFilesTreeProvider';

export async function selectBaseBranch(treeProvider: ChangedFilesTreeProvider): Promise<void> {
  const repoRoot = treeProvider.getRepoRoot();
  if (!repoRoot) {
    vscode.window.showWarningMessage('No Git repository detected in the current workspace.');
    return;
  }

  const branches = await GitService.getBranches(repoRoot);
  const currentBranch = treeProvider.getCurrentBranch();
  const activeBase = treeProvider.getBaseBranch();

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
    placeHolder: `Select base branch to compare against (Current: ${currentBranch})`,
    matchOnDescription: true
  });

  if (selected) {
    treeProvider.setBaseBranch(selected.branchName);
    vscode.window.showInformationMessage(
      `Comparing ${currentBranch} against base branch: ${selected.branchName}`
    );
  }
}

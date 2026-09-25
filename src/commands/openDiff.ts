import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BranchContentProvider } from '../providers/branchContentProvider';
import { ChangedFileItem, ChangedFilesTreeProvider } from '../providers/changedFilesTreeProvider';

export async function openDiff(
  item: ChangedFileItem | vscode.Uri | undefined,
  treeProvider: ChangedFilesTreeProvider
): Promise<void> {
  let repoRoot: string | undefined;
  let baseBranch: string | undefined;
  let relPath: string | undefined;
  let status: string = 'M';

  if (item instanceof ChangedFileItem) {
    repoRoot = item.repoRoot;
    baseBranch = item.baseBranch;
    relPath = item.fileDiff.relPath;
    status = item.fileDiff.status;
  } else {
    const targetUri = item instanceof vscode.Uri ? item : vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      vscode.window.showInformationMessage('No active file to compare.');
      return;
    }
    const repo = treeProvider.getRepoForPath(targetUri.fsPath);
    if (!repo) {
      vscode.window.showWarningMessage('File does not belong to any detected Git repository.');
      return;
    }
    repoRoot = repo.repoRoot;
    baseBranch = repo.baseBranch;
    relPath = path.relative(repoRoot, targetUri.fsPath).replace(/\\/g, '/');
  }

  if (!repoRoot || !baseBranch) {
    vscode.window.showWarningMessage('Please select a base branch first.');
    return;
  }

  const filename = path.posix.basename(relPath);
  const localFileUri = vscode.Uri.file(path.join(repoRoot, relPath));
  const localExists = fs.existsSync(localFileUri.fsPath);

  // Left URI: base branch version
  const leftUri = BranchContentProvider.encodeUri(repoRoot, baseBranch, relPath);

  // Right URI: if file exists locally, use real file URI so user can edit directly in diff editor!
  const rightUri = (status === 'D' || !localExists)
    ? BranchContentProvider.encodeUri(repoRoot, 'empty', relPath)
    : localFileUri;

  const title = `${filename} (${baseBranch} ⟷ Working Tree)`;

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
    preview: true,
    preserveFocus: false
  });
}

export async function openWorkingFile(
  item: ChangedFileItem | undefined,
  _treeProvider: ChangedFilesTreeProvider
): Promise<void> {
  if (!item) return;

  const localFileUri = vscode.Uri.file(path.join(item.repoRoot, item.fileDiff.relPath));
  if (fs.existsSync(localFileUri.fsPath)) {
    await vscode.window.showTextDocument(localFileUri);
  } else {
    vscode.window.showWarningMessage(`File does not exist in working tree: ${item.fileDiff.relPath}`);
  }
}

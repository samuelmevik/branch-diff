import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChangedFileItem } from '../providers/changedFilesTreeProvider';
import { BranchContentProvider } from '../providers/branchContentProvider';
import { GitService } from '../git/gitService';
import { ChangedFilesTreeProvider } from '../providers/changedFilesTreeProvider';

export async function openDiff(
  item: ChangedFileItem | vscode.Uri | undefined,
  treeProvider: ChangedFilesTreeProvider
): Promise<void> {
  const repoRoot = treeProvider.getRepoRoot();
  const baseBranch = treeProvider.getBaseBranch();

  if (!repoRoot || !baseBranch) {
    vscode.window.showWarningMessage('Please select a base branch first.');
    return;
  }

  let relPath: string;
  let status: string = 'M';

  if (item instanceof ChangedFileItem) {
    relPath = item.fileDiff.relPath;
    status = item.fileDiff.status;
  } else if (item instanceof vscode.Uri) {
    relPath = path.relative(repoRoot, item.fsPath).replace(/\\/g, '/');
  } else {
    // If called from palette without arguments, check active editor
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showInformationMessage('No active file to compare.');
      return;
    }
    relPath = path.relative(repoRoot, activeEditor.document.uri.fsPath).replace(/\\/g, '/');
  }

  const filename = path.posix.basename(relPath);
  const localFileUri = vscode.Uri.file(path.join(repoRoot, relPath));
  const localExists = fs.existsSync(localFileUri.fsPath);

  // Left URI: base branch version
  const leftUri = BranchContentProvider.encodeUri(repoRoot, baseBranch, relPath);

  // Right URI: if file exists locally, use real file URI so user can edit directly in diff editor!
  let rightUri: vscode.Uri;
  if (status === 'D' || !localExists) {
    // File was deleted in working tree; show empty on right
    rightUri = BranchContentProvider.encodeUri(repoRoot, 'empty', relPath);
  } else {
    // Real file on disk: FULLY EDITABLE in VS Code Diff Editor!
    rightUri = localFileUri;
  }

  const title = `${filename} (${baseBranch} ⟷ Working Tree)`;

  await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
    preview: true,
    preserveFocus: false
  });
}

export async function openWorkingFile(
  item: ChangedFileItem | undefined,
  treeProvider: ChangedFilesTreeProvider
): Promise<void> {
  const repoRoot = treeProvider.getRepoRoot();
  if (!repoRoot || !item) return;

  const localFileUri = vscode.Uri.file(path.join(repoRoot, item.fileDiff.relPath));
  if (fs.existsSync(localFileUri.fsPath)) {
    await vscode.window.showTextDocument(localFileUri);
  } else {
    vscode.window.showWarningMessage(`File does not exist in working tree: ${item.fileDiff.relPath}`);
  }
}

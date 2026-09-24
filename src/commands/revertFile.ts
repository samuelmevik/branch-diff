import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from '../git/gitService';
import { ChangedFileItem, ChangedFilesTreeProvider } from '../providers/changedFilesTreeProvider';
import { FileDiff } from '../git/types';

export async function revertFileChanges(
  item: ChangedFileItem | vscode.Uri | undefined,
  treeProvider: ChangedFilesTreeProvider
): Promise<void> {
  const repoRoot = treeProvider.getRepoRoot();
  const baseBranch = treeProvider.getBaseBranch();

  if (!repoRoot || !baseBranch) {
    vscode.window.showWarningMessage('Please select a base branch first.');
    return;
  }

  let fileDiff: FileDiff | undefined;

  if (item instanceof ChangedFileItem) {
    fileDiff = item.fileDiff;
  } else if (item instanceof vscode.Uri) {
    const rel = path.relative(repoRoot, item.fsPath).replace(/\\/g, '/');
    fileDiff = treeProvider.getFileDiff(rel);
    if (!fileDiff) {
      fileDiff = {
        relPath: rel,
        status: 'M',
        insertions: 0,
        deletions: 0,
        isBinary: false
      };
    }
  } else {
    // If invoked without arguments (e.g. from Command Palette), check active editor
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showInformationMessage('No active file selected to revert.');
      return;
    }
    const rel = path.relative(repoRoot, activeEditor.document.uri.fsPath).replace(/\\/g, '/');
    fileDiff = treeProvider.getFileDiff(rel);
    if (!fileDiff) {
      fileDiff = {
        relPath: rel,
        status: 'M',
        insertions: 0,
        deletions: 0,
        isBinary: false
      };
    }
  }

  const filename = path.posix.basename(fileDiff.relPath);

  // Prompt confirmation to avoid accidental data loss
  const confirm = await vscode.window.showWarningMessage(
    `Are you sure you want to revert all changes to "${filename}"?`,
    {
      modal: true,
      detail: `This will restore the file to the state in "${baseBranch}" and discard all changes.`
    },
    'Revert Changes'
  );

  if (confirm !== 'Revert Changes') {
    return;
  }

  const fullPath = path.join(repoRoot, fileDiff.relPath);
  const targetNormPath = path.normalize(fullPath).toLowerCase();

  // If there's an open dirty document for this file, save it first so checkout cleanly overwrites
  const openDoc = vscode.workspace.textDocuments.find(
    (doc) => path.normalize(doc.uri.fsPath).toLowerCase() === targetNormPath
  );
  if (openDoc && openDoc.isDirty) {
    await openDoc.save();
  }

  // Close open diff tabs for this file so user is not left viewing an empty/stale diff
  try {
    for (const tabGroup of vscode.window.tabGroups.all) {
      for (const tab of tabGroup.tabs) {
        if (tab.input instanceof vscode.TabInputTextDiff) {
          const modPath = path.normalize(tab.input.modified.fsPath).toLowerCase();
          if (modPath === targetNormPath) {
            await vscode.window.tabGroups.close(tab);
          }
        } else if (tab.input instanceof vscode.TabInputText) {
          if (fileDiff.status === 'A' || fileDiff.status === '?' || fileDiff.status === 'C') {
            const docPath = path.normalize(tab.input.uri.fsPath).toLowerCase();
            if (docPath === targetNormPath) {
              await vscode.window.tabGroups.close(tab);
            }
          }
        }
      }
    }
  } catch (err) {
    console.debug('Error closing tabs for reverted file:', err);
  }

  const comparisonRef = await treeProvider.getComparisonRef();
  if (!comparisonRef) {
    vscode.window.showErrorMessage('Unable to determine base reference for comparison.');
    return;
  }

  try {
    await GitService.revertFile(repoRoot, comparisonRef, fileDiff);
    await treeProvider.refresh();
    vscode.window.setStatusBarMessage(`$(check) Reverted all changes to ${filename}`, 3500);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to revert "${filename}": ${err?.message || err}`);
  }
}

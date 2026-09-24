import * as vscode from 'vscode';
import { GitService } from '../git/gitService';

export const BRANCH_DIFF_SCHEME = 'branch-diff';

export class BranchContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  public static encodeUri(repoRoot: string, ref: string, relPath: string): vscode.Uri {
    // Normalise relPath
    const normalizedPath = relPath.replace(/\\/g, '/');
    const query = new URLSearchParams({
      repoRoot,
      ref,
      path: normalizedPath
    }).toString();

    // Use path with original filename extension so VS Code auto-detects syntax highlighting!
    return vscode.Uri.from({
      scheme: BRANCH_DIFF_SCHEME,
      path: `/${normalizedPath}`,
      query
    });
  }

  public static decodeUri(uri: vscode.Uri): { repoRoot: string; ref: string; relPath: string } | null {
    try {
      const params = new URLSearchParams(uri.query);
      const repoRoot = params.get('repoRoot');
      const ref = params.get('ref');
      const relPath = params.get('path');

      if (!repoRoot || !ref || !relPath) {
        return null;
      }

      return { repoRoot, ref, relPath };
    } catch {
      return null;
    }
  }

  public async provideTextDocumentContent(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): Promise<string> {
    const decoded = BranchContentProvider.decodeUri(uri);
    if (!decoded || decoded.ref === 'empty') {
      return '';
    }

    return await GitService.getFileContentAtRef(decoded.repoRoot, decoded.ref, decoded.relPath);
  }

  public refresh(uri?: vscode.Uri): void {
    if (uri) {
      this._onDidChange.fire(uri);
    }
  }
}

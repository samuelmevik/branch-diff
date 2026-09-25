import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { BranchInfo, DiffMode, DiffStatus, FileDiff } from './types';

export class GitService {
  /**
   * Executes a git command and returns the stdout string.
   */
  private static exec(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.execFile(
        'git',
        args,
        {
          cwd,
          maxBuffer: 20 * 1024 * 1024,
          windowsHide: true,
          encoding: 'utf8'
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve(stdout);
          }
        }
      );
    });
  }

  /**
   * Executes a git command and returns raw Buffer (for binary data or strict byte access).
   */
  private static execBuffer(args: string[], cwd: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      cp.execFile(
        'git',
        args,
        {
          cwd,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
          encoding: 'buffer'
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr.toString('utf8') || error.message));
          } else {
            resolve(stdout as Buffer);
          }
        }
      );
    });
  }

  public static normalizePath(p: string): string {
    let norm = path.normalize(p);
    if (process.platform === 'win32' && norm.length >= 2 && norm[1] === ':') {
      norm = norm[0].toLowerCase() + norm.slice(1);
    }
    if (norm.length > 3 && (norm.endsWith('/') || norm.endsWith('\\'))) {
      norm = norm.slice(0, -1);
    }
    return norm;
  }

  private static readonly IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    '.hg',
    '.svn',
    '.vscode',
    '.idea',
    'dist',
    'out',
    'build',
    'target',
    'vendor',
    '.cache',
    '.next',
    '.nuxt',
    'coverage',
    '.turbo',
    '.venv',
    'env',
    'venv',
    '__pycache__'
  ]);

  /**
   * Finds the root of the git repository for a given directory.
   */
  public static async findRepoRoot(dir: string): Promise<string | null> {
    try {
      const output = await this.exec(['rev-parse', '--show-toplevel'], dir);
      const trimmed = output.trim();
      return trimmed ? this.normalizePath(trimmed) : null;
    } catch {
      return null;
    }
  }

  /**
   * Discovers submodule paths registered in .gitmodules
   */
  public static async getSubmodulePaths(repoRoot: string): Promise<string[]> {
    const gitmodulesFile = path.join(repoRoot, '.gitmodules');
    if (!fs.existsSync(gitmodulesFile)) {
      return [];
    }

    const submodules: string[] = [];
    try {
      const output = await this.exec(
        ['config', '--file', '.gitmodules', '--get-regexp', 'path'],
        repoRoot
      );
      const lines = output.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const subRelPath = parts[1];
          const subAbsPath = this.normalizePath(path.join(repoRoot, subRelPath));
          if (fs.existsSync(subAbsPath)) {
            submodules.push(subAbsPath);
          }
        }
      }
    } catch {
      // Ignore git config errors
    }
    return submodules;
  }

  /**
   * Scans a directory recursively for Git repositories (.git folders or .git files for submodules/worktrees)
   */
  private static async scanDirectoryForGitRepos(
    currentDir: string,
    depth: number,
    maxDepth: number,
    discovered: Set<string>
  ): Promise<void> {
    if (depth >= maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Check if this directory itself contains a .git entry
    const hasGit = entries.some(
      (e) => e.name === '.git' && (e.isDirectory() || e.isFile())
    );

    if (hasGit) {
      const root = await this.findRepoRoot(currentDir);
      if (root) {
        discovered.add(this.normalizePath(root));
      }
    }

    // Recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (this.IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        const subDirPath = path.join(currentDir, entry.name);
        await this.scanDirectoryForGitRepos(subDirPath, depth + 1, maxDepth, discovered);
      }
    }
  }

  /**
   * Discovers all git repositories inside workspace roots and any explicitly provided known roots.
   */
  public static async findRepositories(
    workspaceRoots: string[],
    knownRoots: string[] = [],
    maxDepth: number = 4
  ): Promise<string[]> {
    const discovered = new Set<string>();

    const addIfRepo = async (dir: string) => {
      const norm = this.normalizePath(dir);
      if (discovered.has(norm)) return;
      const root = await this.findRepoRoot(dir);
      if (root) {
        discovered.add(this.normalizePath(root));
      }
    };

    // 1. Add known roots (e.g. from VS Code git extension)
    for (const kr of knownRoots) {
      await addIfRepo(kr);
    }

    // 2. Scan workspace roots
    for (const wsRoot of workspaceRoots) {
      if (!fs.existsSync(wsRoot)) continue;
      await addIfRepo(wsRoot);
      await this.scanDirectoryForGitRepos(wsRoot, 0, maxDepth, discovered);
    }

    // 3. For all discovered repos, check submodules
    const currentList = Array.from(discovered);
    for (const repoRoot of currentList) {
      const submodules = await this.getSubmodulePaths(repoRoot);
      for (const sm of submodules) {
        await addIfRepo(sm);
      }
    }

    // Sort: shorter paths first (parents before children), then alphabetical
    return Array.from(discovered).sort((a, b) => {
      const depthA = a.split(/[/\\]/).length;
      const depthB = b.split(/[/\\]/).length;
      if (depthA !== depthB) return depthA - depthB;
      return a.localeCompare(b);
    });
  }

  /**
   * Gets the current branch name or short commit hash.
   */
  public static async getCurrentBranch(repoRoot: string): Promise<string> {
    try {
      const branch = (await this.exec(['symbolic-ref', '--short', 'HEAD'], repoRoot)).trim();
      if (branch) {
        return branch;
      }
    } catch {
      // Detached HEAD or error
    }

    try {
      return (await this.exec(['rev-parse', '--short', 'HEAD'], repoRoot)).trim();
    } catch {
      return 'HEAD';
    }
  }

  /**
   * Lists all local and remote branches.
   */
  public static async getBranches(repoRoot: string): Promise<BranchInfo[]> {
    try {
      const output = await this.exec(
        ['for-each-ref', '--format=%(refname:short)|%(refname)|%(HEAD)', 'refs/heads/', 'refs/remotes/'],
        repoRoot
      );

      const lines = output.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const branches: BranchInfo[] = [];

      for (const line of lines) {
        const [shortName, fullName, isHead] = line.split('|');
        if (!shortName || shortName.endsWith('/HEAD')) {
          continue;
        }

        const isRemote = fullName ? fullName.startsWith('refs/remotes/') : false;
        branches.push({
          name: shortName,
          isRemote,
          isCurrent: isHead?.trim() === '*'
        });
      }

      // Sort: current first, local branches alphabetically, then remote branches
      branches.sort((a, b) => {
        if (a.isCurrent) return -1;
        if (b.isCurrent) return 1;
        if (!a.isRemote && b.isRemote) return -1;
        if (a.isRemote && !b.isRemote) return 1;
        return a.name.localeCompare(b.name);
      });

      return branches;
    } catch {
      return [];
    }
  }

  /**
   * Finds the merge-base between two references.
   */
  public static async getMergeBase(repoRoot: string, base: string, head: string = 'HEAD'): Promise<string | null> {
    try {
      const output = await this.exec(['merge-base', base, head], repoRoot);
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Gets the list of changed files between base branch and working tree.
   */
  public static async getDiffFiles(
    repoRoot: string,
    baseBranch: string,
    mode: DiffMode,
    nestedRepoPaths: string[] = []
  ): Promise<FileDiff[]> {
    let comparisonRef = baseBranch;

    if (mode === 'mergeBase') {
      const mergeBase = await this.getMergeBase(repoRoot, baseBranch, 'HEAD');
      if (mergeBase) {
        comparisonRef = mergeBase;
      }
    }

    // Convert nested repo paths to relative paths inside repoRoot
    const normalizedRepoRoot = this.normalizePath(repoRoot);
    const nestedRels = nestedRepoPaths
      .map((np) => {
        const norm = this.normalizePath(np);
        if (norm.toLowerCase().startsWith(normalizedRepoRoot.toLowerCase())) {
          return path.relative(normalizedRepoRoot, norm).replace(/\\/g, '/').replace(/\/+$/, '');
        }
        return '';
      })
      .filter((r) => r.length > 0 && !r.startsWith('..'));

    const isInsideNestedRepo = (rel: string) => {
      const clean = rel.replace(/\/+$/, '');
      return nestedRels.some((nr) => clean === nr || clean.startsWith(nr + '/'));
    };

    // 1. Get name-status with rename detection (-M)
    // Comparing comparisonRef to working tree (no second ref means working tree)
    const nameStatusOutput = await this.exec(
      ['diff', '--name-status', '-M', comparisonRef],
      repoRoot
    ).catch(() => '');

    // 2. Get numstat with rename detection
    const numstatOutput = await this.exec(
      ['diff', '--numstat', '-M', comparisonRef],
      repoRoot
    ).catch(() => '');

    // Parse numstat: "<insertions>\t<deletions>\t<path>"
    const statMap = new Map<string, { ins: number; del: number; isBinary: boolean }>();
    for (const line of numstatOutput.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const insStr = parts[0];
        const delStr = parts[1];
        // Handle renamed paths in numstat, e.g. "path/{old => new}/file.ts" or "new"
        const filePath = parts[parts.length - 1];
        const isBinary = insStr === '-' || delStr === '-';
        statMap.set(filePath, {
          ins: isBinary ? 0 : parseInt(insStr, 10) || 0,
          del: isBinary ? 0 : parseInt(delStr, 10) || 0,
          isBinary
        });
      }
    }

    // Parse name-status:
    // M\tpath
    // A\tpath
    // D\tpath
    // R100\toldPath\tnewPath
    const files: FileDiff[] = [];
    const lines = nameStatusOutput.split(/\r?\n/).filter((l) => l.trim().length > 0);

    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;

      const rawStatus = parts[0].trim();
      const statusLetter = rawStatus[0].toUpperCase() as DiffStatus;

      let relPath: string;
      let oldRelPath: string | undefined;

      if (statusLetter === 'R' && parts.length >= 3) {
        oldRelPath = parts[1].replace(/\\/g, '/');
        relPath = parts[2].replace(/\\/g, '/');
      } else {
        relPath = parts[1].replace(/\\/g, '/');
      }

      if (isInsideNestedRepo(relPath)) {
        continue;
      }

      // Find matching stats
      const stats = statMap.get(relPath) ||
        (oldRelPath ? statMap.get(`${oldRelPath} => ${relPath}`) : undefined) ||
        { ins: 0, del: 0, isBinary: false };

      files.push({
        relPath,
        oldRelPath,
        status: statusLetter,
        insertions: stats.ins,
        deletions: stats.del,
        isBinary: stats.isBinary
      });
    }

    // Check for untracked files in the working directory
    try {
      const untrackedOutput = await this.exec(
        ['ls-files', '--others', '--exclude-standard'],
        repoRoot
      );
      const untrackedLines = untrackedOutput.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const rawPath of untrackedLines) {
        const normPath = rawPath.replace(/\\/g, '/');
        if (isInsideNestedRepo(normPath)) {
          continue;
        }
        if (!files.some((f) => f.relPath === normPath)) {
          files.push({
            relPath: normPath,
            status: 'A',
            insertions: 0,
            deletions: 0,
            isBinary: false
          });
        }
      }
    } catch {
      // Ignore if untracked lookup fails
    }

    // Sort by path
    files.sort((a, b) => a.relPath.localeCompare(b.relPath));

    return files;
  }

  /**
   * Shows file content at a given ref (branch or commit).
   * Returns empty string if the file doesn't exist at that ref (e.g. newly added file).
   */
  public static async getFileContentAtRef(
    repoRoot: string,
    ref: string,
    relPath: string
  ): Promise<string> {
    // Normalise to forward slash for git pathspec
    const gitPath = relPath.replace(/\\/g, '/');
    try {
      const buffer = await this.execBuffer(['show', `${ref}:${gitPath}`], repoRoot);
      return buffer.toString('utf8');
    } catch {
      // File does not exist in ref (e.g. newly created file)
      return '';
    }
  }

  /**
   * Checks if a ref exists in the repository.
   */
  public static async refExists(repoRoot: string, ref: string): Promise<boolean> {
    try {
      await this.exec(['rev-parse', '--verify', ref], repoRoot);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reverts all changes to a file so that it matches the comparison ref.
   */
  public static async revertFile(
    repoRoot: string,
    comparisonRef: string,
    fileDiff: FileDiff
  ): Promise<void> {
    const { relPath, oldRelPath, status } = fileDiff;
    const fullPath = path.join(repoRoot, relPath);

    switch (status) {
      case 'A':
      case '?':
      case 'C': {
        // File was added, untracked, or copied: remove it from git index and working tree
        try {
          await this.exec(['rm', '-f', '--', relPath], repoRoot);
        } catch {
          // If untracked, git rm fails; proceed to remove from filesystem
        }

        if (fs.existsSync(fullPath)) {
          const stat = await fs.promises.stat(fullPath);
          if (stat.isDirectory()) {
            await fs.promises.rm(fullPath, { recursive: true, force: true });
          } else {
            await fs.promises.unlink(fullPath);
          }
        }
        break;
      }

      case 'R': {
        // File was renamed: restore old path from comparisonRef, remove renamed path
        if (oldRelPath) {
          await this.exec(['checkout', comparisonRef, '--', oldRelPath], repoRoot);
        }

        try {
          await this.exec(['rm', '-f', '--', relPath], repoRoot);
        } catch {
          // Ignore if git rm fails
        }

        if (fs.existsSync(fullPath)) {
          await fs.promises.unlink(fullPath).catch(() => { });
        }
        break;
      }

      case 'D':
      case 'M':
      case 'U':
      default: {
        // File was modified, deleted, or unmerged: restore it from comparisonRef
        await this.exec(['checkout', comparisonRef, '--', relPath], repoRoot);
        break;
      }
    }
  }

  /**
   * Checks out a branch or ref in the given repository.
   */
  public static async checkout(repoRoot: string, branchName: string): Promise<string> {
    return await this.exec(['checkout', branchName], repoRoot);
  }
}


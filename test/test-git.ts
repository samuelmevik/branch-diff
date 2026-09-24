import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { GitService } from '../src/git/gitService';

function run(cmd: string, cwd: string) {
  cp.execSync(cmd, { cwd, stdio: 'pipe' });
}

async function testGitService() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-diff-test-'));
  console.log(`Setting up test repo at: ${tmpDir}`);

  try {
    // 1. Initialize git repo
    run('git init -b main', tmpDir);
    run('git config user.name "Test User"', tmpDir);
    run('git config user.email "test@example.com"', tmpDir);

    // Initial commit on main
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'line 1 on main\nline 2\n');
    fs.writeFileSync(path.join(tmpDir, 'to-delete.txt'), 'delete me\n');
    run('git add .', tmpDir);
    run('git commit -m "Initial commit on main"', tmpDir);

    // 2. Create feature branch
    run('git checkout -b feature/awesome', tmpDir);

    // Modify file1.txt
    fs.writeFileSync(path.join(tmpDir, 'file1.txt'), 'line 1 on main (MODIFIED)\nline 2\nline 3 added\n');
    // Add file2.ts
    fs.writeFileSync(path.join(tmpDir, 'file2.ts'), 'export const hello = "world";\n');
    // Delete to-delete.txt
    fs.unlinkSync(path.join(tmpDir, 'to-delete.txt'));

    // Check git status / repo root
    const root = await GitService.findRepoRoot(tmpDir);
    console.log(`Repo root: ${root}`);
    if (!root) throw new Error('Repo root not found!');

    const currentBranch = await GitService.getCurrentBranch(tmpDir);
    console.log(`Current branch: ${currentBranch}`);
    if (currentBranch !== 'feature/awesome') throw new Error(`Expected feature/awesome, got ${currentBranch}`);

    const branches = await GitService.getBranches(tmpDir);
    console.log(`Branches:`, branches);
    if (!branches.some(b => b.name === 'main')) throw new Error('Branch main not found');

    const mergeBase = await GitService.getMergeBase(tmpDir, 'main', 'HEAD');
    console.log(`Merge base: ${mergeBase}`);
    if (!mergeBase) throw new Error('Merge base not found');

    const diffFiles = await GitService.getDiffFiles(tmpDir, 'main', 'mergeBase');
    console.log(`Diff files:`, JSON.stringify(diffFiles, null, 2));

    const file1 = diffFiles.find(f => f.relPath === 'file1.txt');
    if (!file1 || file1.status !== 'M') throw new Error('file1.txt should be Modified (M)');

    const file2 = diffFiles.find(f => f.relPath === 'file2.ts');
    if (!file2 || file2.status !== 'A') throw new Error('file2.ts should be Added (A)');

    const deleted = diffFiles.find(f => f.relPath === 'to-delete.txt');
    if (!deleted || deleted.status !== 'D') throw new Error('to-delete.txt should be Deleted (D)');

    // Test file content at ref
    const file1BaseContent = await GitService.getFileContentAtRef(tmpDir, 'main', 'file1.txt');
    console.log(`file1 base content:\n${file1BaseContent}`);
    if (!file1BaseContent.includes('line 1 on main\n')) throw new Error('Incorrect base content');

    const file2BaseContent = await GitService.getFileContentAtRef(tmpDir, 'main', 'file2.ts');
    if (file2BaseContent !== '') throw new Error('file2 should have empty base content');

    console.log('✅ ALL GIT SERVICE TESTS PASSED SUCCESSFULLY!');
  } finally {
    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}

testGitService().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

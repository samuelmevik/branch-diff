import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import { GitService } from '../src/git/gitService';

function run(cmd: string, cwd: string): string {
  return cp.execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf8' });
}

async function runNestedTests() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-git-test-suite-'));
  console.log('Testing nested git repos in:', tmpDir);

  try {
    // 1. Initialize Root Parent Repo
    const rootRepo = path.join(tmpDir, 'workspace');
    fs.mkdirSync(rootRepo, { recursive: true });
    run('git init -b main', rootRepo);
    run('git config user.name "Parent Dev"', rootRepo);
    run('git config user.email "parent@test.com"', rootRepo);
    fs.writeFileSync(path.join(rootRepo, 'root-file.txt'), 'root initial\n');
    run('git add .', rootRepo);
    run('git commit -m "Root initial commit"', rootRepo);

    // 2. Create Nested Repo A (e.g. packages/frontend)
    const nestedA = path.join(rootRepo, 'packages', 'frontend');
    fs.mkdirSync(nestedA, { recursive: true });
    run('git init -b main', nestedA);
    run('git config user.name "Frontend Dev"', nestedA);
    run('git config user.email "frontend@test.com"', nestedA);
    fs.writeFileSync(path.join(nestedA, 'App.tsx'), 'export const App = () => null;\n');
    run('git add .', nestedA);
    run('git commit -m "Frontend initial commit"', nestedA);

    // 3. Create Nested Repo B (e.g. services/backend)
    const nestedB = path.join(rootRepo, 'services', 'backend');
    fs.mkdirSync(nestedB, { recursive: true });
    run('git init -b master', nestedB);
    run('git config user.name "Backend Dev"', nestedB);
    run('git config user.email "backend@test.com"', nestedB);
    fs.writeFileSync(path.join(nestedB, 'server.go'), 'package main\n');
    run('git add .', nestedB);
    run('git commit -m "Backend initial commit"', nestedB);

    // 4. Test Discovery
    const discovered = await GitService.findRepositories([rootRepo]);
    console.log('Discovered repositories:', discovered);

    const normRoot = GitService.normalizePath(rootRepo);
    const normA = GitService.normalizePath(nestedA);
    const normB = GitService.normalizePath(nestedB);

    if (!discovered.includes(normRoot)) {
      throw new Error(`Root repo not discovered: ${normRoot}`);
    }
    if (!discovered.includes(normA)) {
      throw new Error(`Nested repo A not discovered: ${normA}`);
    }
    if (!discovered.includes(normB)) {
      throw new Error(`Nested repo B not discovered: ${normB}`);
    }

    // 5. Test branches in each repo
    const rootBranch = await GitService.getCurrentBranch(normRoot);
    const aBranch = await GitService.getCurrentBranch(normA);
    const bBranch = await GitService.getCurrentBranch(normB);

    if (rootBranch !== 'main') throw new Error(`Expected root branch main, got ${rootBranch}`);
    if (aBranch !== 'main') throw new Error(`Expected repo A branch main, got ${aBranch}`);
    if (bBranch !== 'master') throw new Error(`Expected repo B branch master, got ${bBranch}`);

    // 6. Checkout feature branch and make modifications in nested repo A
    run('git checkout -b feature/login', normA);
    fs.writeFileSync(path.join(normA, 'App.tsx'), 'export const App = () => <h1>Login</h1>;\n');
    fs.writeFileSync(path.join(normA, 'Login.tsx'), 'export const Login = () => null;\n');

    // Make modifications in root repo
    fs.writeFileSync(path.join(normRoot, 'root-file.txt'), 'root modified\n');
    fs.writeFileSync(path.join(normRoot, 'new-root-file.txt'), 'new root\n');

    // Make modifications in nested repo B
    fs.writeFileSync(path.join(normB, 'server.go'), 'package main\nfunc main() {}\n');

    // 7. Test Diff Filtering:
    // Root repo should only see root-file.txt and new-root-file.txt, NOT packages/frontend or services/backend
    const rootDiff = await GitService.getDiffFiles(normRoot, 'main', 'direct', [normA, normB]);
    console.log('Root repo diff files:', rootDiff);

    if (rootDiff.some(f => f.relPath.includes('frontend') || f.relPath.includes('backend'))) {
      throw new Error('Root repo diff contains nested repository paths!');
    }
    if (!rootDiff.some(f => f.relPath === 'root-file.txt' && f.status === 'M')) {
      throw new Error('Root repo missing modified root-file.txt');
    }
    if (!rootDiff.some(f => f.relPath === 'new-root-file.txt' && f.status === 'A')) {
      throw new Error('Root repo missing new-root-file.txt');
    }

    // 8. Test Nested Repo A diff
    const aDiff = await GitService.getDiffFiles(normA, 'main', 'mergeBase', []);
    console.log('Repo A diff files:', aDiff);

    const aModified = aDiff.find(f => f.relPath === 'App.tsx');
    if (!aModified || aModified.status !== 'M') {
      throw new Error('Repo A missing modified App.tsx');
    }
    const aAdded = aDiff.find(f => f.relPath === 'Login.tsx');
    if (!aAdded || aAdded.status !== 'A') {
      throw new Error('Repo A missing added Login.tsx');
    }

    // 9. Test file content at ref in nested repo A
    const appBaseContent = await GitService.getFileContentAtRef(normA, 'main', 'App.tsx');
    if (!appBaseContent.includes('export const App = () => null;')) {
      throw new Error('Incorrect base content for App.tsx at main');
    }

    // 10. Test revert in nested repo A
    console.log('Testing revert in nested repo A...');
    await GitService.revertFile(normA, 'main', aModified);
    const contentAfterRevert = fs.readFileSync(path.join(normA, 'App.tsx'), 'utf8');
    if (!contentAfterRevert.includes('export const App = () => null;')) {
      throw new Error('Failed to revert App.tsx in nested repo A!');
    }

    console.log('Testing revert of newly added file in nested repo A...');
    await GitService.revertFile(normA, 'main', aAdded);
    if (fs.existsSync(path.join(normA, 'Login.tsx'))) {
      throw new Error('Added file was not removed upon revert!');
    }

    // 11. Test Nested Repo B diff
    const bDiff = await GitService.getDiffFiles(normB, 'master', 'direct', []);
    console.log('Repo B diff files:', bDiff);
    if (!bDiff.some(f => f.relPath === 'server.go' && f.status === 'M')) {
      throw new Error('Repo B missing modified server.go');
    }

    console.log('✅ ALL NESTED GIT TESTS PASSED WITH 100% SUCCESS!');
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { }
  }
}

runNestedTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

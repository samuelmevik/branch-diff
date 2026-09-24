# Branch Diff & PR Review (VS Code Extension)

A VS Code extension that brings the GitHub Pull Request review experience directly into your editor—with the ability to compare your current working branch against any branch (local or remote) and **edit your code directly within the diff view**.

---

## Features

- 🌿 **Pick Any Base Branch**: Compare your current working branch against `main`, `develop`, feature branches, or remote branches (`origin/main`).
- ✏️ **Interactive & Editable Diff View**:
  - The left pane shows a read-only snapshot of the file from your chosen base branch.
  - The right pane is your actual working workspace file: **fully editable, with syntax highlighting, IntelliSense, and instant `Ctrl+S` saving**.
- 📂 **Changed Files Sidebar (Activity Bar)**:
  - View all changed files with GitHub-style status badges:
    - `[M]` Modified
    - `[A]` Added
    - `[D]` Deleted
    - `[R]` Renamed
  - Additions and deletions breakdown (`+15, -4`).
  - Toggle between **Directory Tree** view and **Flat File List**.
- 🔀 **Pull Request Mode (Three-dot Merge-base)**:
  - By default, compares changes made since diverging from the base branch (`git diff <base>...HEAD`), exactly like GitHub PRs.
  - One-click toggle to **Direct Diff** (`git diff <base>..HEAD`) if you prefer comparing directly against the base branch tip.
- ⚡ **Auto-refresh**:
  - Changes update automatically whenever you save edits in the diff editor or switch branches in git.

---

## How to Use

1. Click the **Branch Diff** icon (`$(git-pull-request)`) in the Activity Bar.
2. If a base branch is not yet selected, click **Select a base branch to compare...** or use the branch button in the view header.
3. Select your desired base branch from the QuickPick menu (e.g. `main` or `origin/main`).
4. Click on any file in the **Changed Files** list to open the side-by-side editable diff.
5. Make edits directly on the right pane and press `Ctrl+S` (or `Cmd+S` on macOS) to save!

---

## Commands & Shortcuts

| Command                       | Title                         | Action                                                 |
| ----------------------------- | ----------------------------- | ------------------------------------------------------ |
| `branchDiff.selectBaseBranch` | Select Base Branch to Compare | Choose target/base branch via QuickPick                |
| `branchDiff.refresh`          | Refresh Changes               | Re-scans git diff and reloads changed files            |
| `branchDiff.toggleViewMode`   | Toggle Tree/Flat View         | Switches between directory hierarchy and flat list     |
| `branchDiff.toggleDiffMode`   | Toggle Diff Mode              | Toggles between PR Mode (`merge-base`) and Direct Diff |
| `branchDiff.openDiff`         | Open Diff                     | Opens side-by-side editable diff editor                |
| `branchDiff.openFile`         | Open Working File             | Opens the regular working file directly                |

---

## Extension Settings

This extension contributes the following settings:

- `branchDiff.defaultBaseBranch`: Default base branch to compare against (leave empty to auto-detect `main`/`master`).
- `branchDiff.diffMode`: Comparison mode: `mergeBase` (PR mode) or `direct` (base tip diff).
- `branchDiff.viewMode`: Default file view mode: `tree` (directory structure) or `flat` (file list).

---

## Testing & Development

To test the extension locally:
1. Open this repository in VS Code.
2. Press `F5` to start debugging. This launches an **Extension Development Host** window with the extension loaded.
3. Open any git repository in that window and test comparing branches!

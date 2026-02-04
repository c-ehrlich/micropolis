import { execFileSync } from 'node:child_process';

/**
 * Git hook setup for this repo.
 *
 * Mirrors the common "hooks in repo + core.hooksPath" approach:
 * - Hooks live in `.githooks/` so they can be versioned.
 * - `core.hooksPath` is set to `.githooks` so `git commit` runs them.
 *
 * The hook itself runs `pnpm check` and blocks commits on any failures.
 */
function main() {
  if (process.env.CITY_SKIP_GITHOOKS === '1') {
    return;
  }

  let repoRoot = null;
  try {
    repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return;
  }

  let existing = '';
  try {
    existing = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    existing = '';
  }

  if (existing && existing !== '.githooks') {
    process.stdout.write(
      `Skipping git hooks setup: core.hooksPath is already set to "${existing}".\n`,
    );
    return;
  }

  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
  } catch {
    process.stdout.write(
      [
        'Warning: failed to set core.hooksPath to enable repo githooks.',
        'To enable the pre-commit hook manually, run:',
        '  git config core.hooksPath .githooks',
      ].join('\n') + '\n',
    );
  }
}

main();

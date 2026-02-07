import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Package automation metadata for integration layers that correspond to Micropolis
 * scripting/resource/integration surfaces under `ref/micropolis/spec/*.md`.
 *
 * This orchestrator is intentionally different from Micropolis C runtime code:
 * it automates Codex task execution over plan checklists rather than sim behavior.
 */
const DEFAULT_PACKAGES = [
  {
    id: 'sim-assets',
    packagePath: 'packages/sim-assets',
    planPath: 'packages/sim-assets/PLAN.md',
    todoPath: 'packages/sim-assets/TODO.md',
    branch: 'codex/auto-sim-assets',
    worktreePath: '.worktrees/auto-sim-assets',
  },
  {
    id: 'sim-scripting',
    packagePath: 'packages/sim-scripting',
    planPath: 'packages/sim-scripting/PLAN.md',
    todoPath: 'packages/sim-scripting/TODO.md',
    branch: 'codex/auto-sim-scripting',
    worktreePath: '.worktrees/auto-sim-scripting',
  },
  {
    id: 'sim-integration',
    packagePath: 'packages/sim-integration',
    planPath: 'packages/sim-integration/PLAN.md',
    todoPath: 'packages/sim-integration/TODO.md',
    branch: 'codex/auto-sim-integration',
    worktreePath: '.worktrees/auto-sim-integration',
  },
];

/**
 * Default quality gates for each completed automation task.
 *
 * These are intentionally stricter than a 1:1 Micropolis command flow and are used
 * to ensure workspace integrity before commit/push/PR updates.
 */
const DEFAULT_CHECKS = ['pnpm typecheck', 'pnpm lint', 'pnpm format', 'pnpm test'];

/**
 * Returns today's date string for plan execution logs.
 *
 * Not a Micropolis C port; this is orchestration metadata for markdown updates.
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Parses CLI arguments for the automation orchestrator.
 *
 * Not from Micropolis C sources; this configures Codex CLI automation behavior.
 */
function parseArgs(argv) {
  const args = {
    command: 'run',
    once: false,
    dryRun: false,
    maxIterations: Number.POSITIVE_INFINITY,
    maxRuntimeMinutes: 24 * 60,
    maxRetriesPerTask: 3,
    baseRef: 'main',
    includeTests: true,
    skipPush: false,
    skipPr: false,
    model: null,
    checks: [...DEFAULT_CHECKS],
  };

  const tokens = [...argv];
  if (tokens[0] && !tokens[0].startsWith('--')) {
    args.command = tokens.shift();
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token === '--') {
      continue;
    }

    if (token === '--once') {
      args.once = true;
      continue;
    }
    if (token === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (token === '--skip-push') {
      args.skipPush = true;
      continue;
    }
    if (token === '--skip-pr') {
      args.skipPr = true;
      continue;
    }
    if (token === '--no-tests') {
      args.includeTests = false;
      continue;
    }
    if (token === '--max-iterations') {
      args.maxIterations = Number(tokens[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--max-runtime-minutes') {
      args.maxRuntimeMinutes = Number(tokens[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--max-retries-per-task') {
      args.maxRetriesPerTask = Number(tokens[i + 1]);
      i += 1;
      continue;
    }
    if (token === '--base-ref') {
      args.baseRef = tokens[i + 1];
      i += 1;
      continue;
    }
    if (token === '--model') {
      args.model = tokens[i + 1];
      i += 1;
      continue;
    }
    if (token === '--checks') {
      const rawChecks = tokens[i + 1] ?? '';
      args.checks = rawChecks
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (Number.isNaN(args.maxIterations) || args.maxIterations < 1) {
    throw new Error('--max-iterations must be a positive integer');
  }
  if (!Number.isFinite(args.maxRuntimeMinutes) || args.maxRuntimeMinutes < 1) {
    throw new Error('--max-runtime-minutes must be a positive number');
  }
  if (!Number.isFinite(args.maxRetriesPerTask) || args.maxRetriesPerTask < 1) {
    throw new Error('--max-retries-per-task must be a positive integer');
  }

  if (!args.includeTests) {
    args.checks = args.checks.filter((command) => command !== 'pnpm test');
  }

  return args;
}

/**
 * Returns true if a heading represents verification/checkpoint metadata instead
 * of actionable implementation work.
 *
 * Not from Micropolis C; this filters markdown runbooks for actionable tasks.
 */
function isNonActionHeading(headingText) {
  return [
    /^verification$/i,
    /^checkpoint$/i,
    /^completion criteria$/i,
    /^execution log$/i,
    /^parity lock/i,
    /^global constraints/i,
    /^invariants/i,
    /^locked source references/i,
    /^strategy decision/i,
    /^current package audit/i,
    /^already implemented and still makes sense/i,
    /^implemented but incomplete/i,
    /^missing package infrastructure/i,
  ].some((pattern) => pattern.test(headingText));
}

/**
 * Produces actionable unchecked tasks from a package PLAN.md.
 *
 * Intentionally different from Micropolis C data structures: this consumes markdown
 * checklist format used for TS port planning.
 */
function parseActionablePlanTasks(markdown) {
  const lines = markdown.split('\n');
  /** @type {{ level: number; title: string }[]} */
  const headingStack = [];
  /** @type {{ lineNumber: number; text: string; id: string | null; headingPath: string[] }[]} */
  const tasks = [];
  let inVerificationParagraph = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const headingMatch = /^(#{2,6})\s+(.+?)\s*$/.exec(line);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
      inVerificationParagraph = false;
      continue;
    }

    if (/^Verification:\s*$/i.test(line.trim()) || /^Checkpoint:\s*$/i.test(line.trim())) {
      inVerificationParagraph = true;
      continue;
    }

    if (line.trim() === '' && inVerificationParagraph) {
      continue;
    }

    const uncheckedMatch = /^- \[ \] (.+)$/.exec(line);
    if (!uncheckedMatch) {
      continue;
    }

    const headingPath = headingStack.map((entry) => entry.title);
    const inPhase = headingPath.some((title) => /^Phase\b/i.test(title));
    const inNonActionSection = headingPath.some((title) => isNonActionHeading(title));

    if (!inPhase || inNonActionSection || inVerificationParagraph) {
      continue;
    }

    const text = uncheckedMatch[1].trim();
    const idMatch = /^`([^`]+)`\s*/.exec(text);
    const isInlineVerificationTask = /^(Verification|Checkpoint)\s*:/i.test(text);

    if (isInlineVerificationTask) {
      continue;
    }

    tasks.push({
      lineNumber: index + 1,
      text,
      id: idMatch?.[1] ?? null,
      headingPath,
    });
  }

  return tasks;
}

/**
 * Reads and parses tasks for a package in a specific repository root.
 *
 * Not from Micropolis C; this is orchestration state for Codex-driven execution.
 */
function getPackagePlanStatus(repoRoot, pkg) {
  const planAbsolutePath = path.join(repoRoot, pkg.planPath);
  const content = readFileSync(planAbsolutePath, 'utf8');
  const tasks = parseActionablePlanTasks(content);
  return {
    planAbsolutePath,
    tasks,
    nextTask: tasks[0] ?? null,
  };
}

/**
 * Resolves which repository root should be used for package status reads.
 *
 * Not from Micropolis C; this prefers package worktrees when they exist so queue
 * and drift views match autonomous branch state.
 */
function resolveStatusRepoRoot(mainRepoRoot, pkg) {
  const worktreeAbsolutePath = path.join(mainRepoRoot, pkg.worktreePath);
  if (existsSync(path.join(worktreeAbsolutePath, '.git'))) {
    return worktreeAbsolutePath;
  }
  return mainRepoRoot;
}

/**
 * Runs a command and captures output.
 *
 * Not a 1:1 port from Micropolis process logic; this wraps Node child process calls
 * for repository automation.
 */
function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });

    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];

    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => {
      resolve({
        code: code ?? 1,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

/**
 * Runs a shell command line via the user's shell.
 *
 * Not from Micropolis C; used for repository checks (typecheck/lint/format/test).
 */
async function runShell(command, cwd) {
  return runCommand('zsh', ['-lc', command], { cwd });
}

/**
 * Ensures the target worktree exists for a package branch.
 *
 * Not a Micropolis runtime port; this isolates autonomous edits per package stream.
 */
async function ensureWorktree(mainRepoRoot, pkg, baseRef, dryRun) {
  const worktreeAbsolutePath = path.join(mainRepoRoot, pkg.worktreePath);
  if (existsSync(path.join(worktreeAbsolutePath, '.git'))) {
    return worktreeAbsolutePath;
  }

  if (dryRun) {
    return mainRepoRoot;
  }

  mkdirSync(path.dirname(worktreeAbsolutePath), { recursive: true });

  const branchExists = await runCommand(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/heads/${pkg.branch}`],
    { cwd: mainRepoRoot },
  );

  const addArgs =
    branchExists.code === 0
      ? ['worktree', 'add', worktreeAbsolutePath, pkg.branch]
      : ['worktree', 'add', '-b', pkg.branch, worktreeAbsolutePath, baseRef];

  const addResult = await runCommand('git', addArgs, { cwd: mainRepoRoot });
  if (addResult.code !== 0) {
    throw new Error(
      [`Failed to ensure worktree for ${pkg.id}.`, addResult.stdout, addResult.stderr]
        .filter((value) => value.length > 0)
        .join('\n'),
    );
  }

  return worktreeAbsolutePath;
}

/**
 * Builds the Codex task prompt for one checklist item.
 *
 * Not a Micropolis C port; this serializes instructions for codex-cli execution.
 */
function buildTaskPrompt(pkg, task) {
  const taskLabel = task.id ? `${task.id} - ${task.text}` : task.text;
  return [
    `Work only on ${pkg.id} (${pkg.packagePath}).`,
    `Complete exactly one unchecked plan task from ${pkg.planPath}.`,
    `Target task: ${taskLabel}`,
    'Requirements:',
    '- Implement only this task and required support changes.',
    `- Mark this exact task as checked in ${pkg.planPath}.`,
    "- Append an execution log line with today's date and what was completed.",
    '- Keep parity behavior aligned with ref/micropolis sources where relevant.',
    '- Add JSDoc for new exported functions/classes, citing source mapping and parity notes.',
    '- Keep tests next to implementation files when adding tests.',
    '- Do not run repository-wide checks (the orchestrator runs them).',
    '- At end, summarize changed files and any remaining risks in one short paragraph.',
  ].join('\n');
}

/**
 * Builds a Codex repair prompt after a failed check gate.
 *
 * Intentionally different from Micropolis C control flow: this requests a focused
 * fix pass over failed quality gates.
 */
function buildRepairPrompt(pkg, task, failedChecksSummary) {
  const taskLabel = task.id ? `${task.id} - ${task.text}` : task.text;
  return [
    `Repair the existing implementation for ${pkg.id} task: ${taskLabel}.`,
    'Do not start a new plan task.',
    'Fix the failing checks below and keep the plan/task state consistent.',
    'Failed checks output:',
    failedChecksSummary,
    'Constraints:',
    `- Keep the target task checked in ${pkg.planPath}.`,
    '- Do not uncheck completed items.',
    '- Preserve parity/JSDoc/testing requirements from AGENTS.md.',
    '- End with a short summary of what you changed to pass checks.',
  ].join('\n\n');
}

/**
 * Executes codex-cli with JSONL logging for a task iteration.
 *
 * Not from Micropolis C; this captures non-interactive Codex execution events.
 */
async function runCodexExec(cwd, prompt, logPath, model) {
  await writeFile(logPath, '', 'utf8');

  const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--cd', cwd];

  if (model) {
    args.push('--model', model);
  }

  args.push(prompt);

  const result = await runCommand('codex', args, { cwd });
  const combinedOutput = `${result.stdout}${result.stderr}`;
  await appendFile(logPath, combinedOutput, 'utf8');

  /** @type {string[]} */
  const agentMessages = [];
  for (const line of combinedOutput.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const event = JSON.parse(line);
      if (event?.type === 'item.completed' && event?.item?.type === 'agent_message') {
        const text = String(event.item.text ?? '').trim();
        if (text.length > 0) {
          agentMessages.push(text);
        }
      }
    } catch {
      // Ignore non-JSON lines from stderr passthrough.
    }
  }

  return {
    code: result.code,
    signal: result.signal,
    output: combinedOutput,
    lastAgentMessage: agentMessages[agentMessages.length - 1] ?? null,
  };
}

/**
 * Returns changed file paths relative to repository root.
 *
 * Not from Micropolis C; used for drift and commit decisions.
 */
async function getChangedFiles(repoRoot) {
  const diffResult = await runCommand('git', ['status', '--short'], { cwd: repoRoot });
  if (diffResult.code !== 0) {
    return [];
  }

  return diffResult.stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length >= 4)
    .map((line) => line.slice(3))
    .map((pathField) => {
      const renameArrowIndex = pathField.lastIndexOf(' -> ');
      if (renameArrowIndex >= 0) {
        return pathField.slice(renameArrowIndex + 4);
      }
      return pathField;
    })
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => value.replace(/^"(.*)"$/, '$1'));
}

/**
 * Runs configured quality checks serially and returns failures.
 *
 * Intentionally different from Micropolis runtime loops; this is CI-style gating.
 */
async function runChecks(repoRoot, checks) {
  /** @type {{ command: string; code: number; output: string }[]} */
  const failures = [];

  for (const command of checks) {
    process.stdout.write(`\n[checks] ${command}\n`);
    // eslint-disable-next-line no-await-in-loop
    const result = await runShell(command, repoRoot);
    if (result.code !== 0) {
      failures.push({
        command,
        code: result.code,
        output: `${result.stdout}${result.stderr}`,
      });
      process.stdout.write(`[checks] failed: ${command}\n`);
    } else {
      process.stdout.write(`[checks] passed: ${command}\n`);
    }
  }

  return failures;
}

/**
 * Creates or updates a pull request for a package branch.
 *
 * Not from Micropolis C; this wraps GitHub CLI for autonomous workflow output.
 */
async function ensurePullRequest(mainRepoRoot, pkg, task, checks, dryRun, baseRef) {
  if (dryRun) {
    return null;
  }

  const taskLabel = task.id ? `${task.id} ${task.text}` : task.text;
  const listResult = await runCommand(
    'gh',
    ['pr', 'list', '--head', pkg.branch, '--state', 'open', '--json', 'number,url', '--limit', '1'],
    { cwd: mainRepoRoot },
  );

  if (listResult.code !== 0) {
    throw new Error(`Failed to query PR list for ${pkg.branch}: ${listResult.stderr}`);
  }

  /** @type {{ number: number; url: string }[]} */
  const prs = JSON.parse(listResult.stdout || '[]');

  if (prs.length > 0) {
    const pr = prs[0];
    const commentBody = [
      `Automated update: completed task \`${taskLabel}\`.`,
      '',
      `Checks passed: ${checks.join(', ')}`,
      `Date: ${today()}`,
    ].join('\n');

    const commentResult = await runCommand(
      'gh',
      ['pr', 'comment', String(pr.number), '--body', commentBody],
      { cwd: mainRepoRoot },
    );

    if (commentResult.code !== 0) {
      throw new Error(`Failed to comment on PR #${pr.number}: ${commentResult.stderr}`);
    }

    return pr.url;
  }

  const titlePrefix = task.id ? `${pkg.id}: ${task.id}` : `${pkg.id}: task`;
  const title = `[auto] ${titlePrefix}`;
  const body = [
    `Automated package stream for \`${pkg.id}\`.`,
    '',
    `Latest completed task: \`${taskLabel}\``,
    '',
    'Quality gates run:',
    ...checks.map((check) => `- ${check}`),
  ].join('\n');

  const createResult = await runCommand(
    'gh',
    ['pr', 'create', '--base', baseRef, '--head', pkg.branch, '--title', title, '--body', body],
    { cwd: mainRepoRoot },
  );

  if (createResult.code !== 0) {
    throw new Error(`Failed to create PR for ${pkg.branch}: ${createResult.stderr}`);
  }

  const url =
    createResult.stdout
      .split('\n')
      .find((line) => line.startsWith('http'))
      ?.trim() ?? null;
  return url;
}

/**
 * Builds a stable task key used for retry tracking.
 *
 * Not from Micropolis C; this is orchestrator bookkeeping.
 */
function taskKey(pkg, task) {
  return `${pkg.id}:${task.id ?? task.text}`;
}

/**
 * Picks the next package/task candidate in round-robin order.
 *
 * Not from Micropolis C scheduling; this balances package streams in automation runs.
 */
function pickNextCandidate(packagesWithStatus, cursor, blockedKeys) {
  if (packagesWithStatus.length === 0) {
    return null;
  }

  for (let offset = 0; offset < packagesWithStatus.length; offset += 1) {
    const index = (cursor + offset) % packagesWithStatus.length;
    const candidate = packagesWithStatus[index];
    if (!candidate.status.nextTask) {
      continue;
    }

    const key = taskKey(candidate.pkg, candidate.status.nextTask);
    if (blockedKeys.has(key)) {
      continue;
    }

    return {
      index,
      pkg: candidate.pkg,
      status: candidate.status,
      task: candidate.status.nextTask,
    };
  }

  return null;
}

/**
 * Reads persisted orchestrator state from disk.
 *
 * Not from Micropolis C; this allows multi-hour unattended continuation.
 */
function readState(statePath) {
  if (!existsSync(statePath)) {
    return {
      cursor: 0,
      failures: {},
      blocked: {},
      prUrls: {},
    };
  }

  return JSON.parse(readFileSync(statePath, 'utf8'));
}

/**
 * Writes orchestrator state to disk.
 *
 * Not from Micropolis C; this is persistent queue/retry bookkeeping.
 */
function writeState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Produces a drift audit summary for plan/todo alignment.
 *
 * Not from Micropolis C; this detects obvious checklist/documentation drift.
 */
function buildDriftReport(repoRoot, packages) {
  /** @type {{ packageId: string; uncheckedCount: number; todoMentionsPlan: boolean; todoIsStub: boolean; issues: string[] }[]} */
  const rows = [];

  for (const pkg of packages) {
    const statusRoot = resolveStatusRepoRoot(repoRoot, pkg);
    const { tasks } = getPackagePlanStatus(statusRoot, pkg);
    const todo = readFileSync(path.join(statusRoot, pkg.todoPath), 'utf8');
    const todoMentionsPlan = /PLAN\.md/i.test(todo);
    const todoIsStub = /Stub package/i.test(todo);

    /** @type {string[]} */
    const issues = [];
    if (tasks.length > 0 && !todoMentionsPlan) {
      issues.push('TODO.md does not reference PLAN.md while work remains');
    }
    if (tasks.length > 0 && todoIsStub) {
      issues.push('TODO.md still has stub text while actionable tasks remain');
    }

    rows.push({
      packageId: pkg.id,
      uncheckedCount: tasks.length,
      todoMentionsPlan,
      todoIsStub,
      issues,
    });
  }

  return rows;
}

/**
 * Prints queue status for each package.
 *
 * Not from Micropolis C; this is operator visibility for queued TS-port tasks.
 */
function printQueue(repoRoot, packages) {
  process.stdout.write('Package queue status:\n');
  for (const pkg of packages) {
    const statusRoot = resolveStatusRepoRoot(repoRoot, pkg);
    const status = getPackagePlanStatus(statusRoot, pkg);
    const nextLabel = status.nextTask
      ? `${status.nextTask.id ?? 'task'} @ line ${status.nextTask.lineNumber}: ${status.nextTask.text}`
      : 'DONE';

    process.stdout.write(`- ${pkg.id}: ${status.tasks.length} remaining; next=${nextLabel}\n`);
  }
}

/**
 * Prints a human-readable drift report and returns whether issues exist.
 *
 * Not from Micropolis C; this enforces planning/documentation hygiene.
 */
function printDriftReport(rows) {
  let issueCount = 0;
  process.stdout.write('Plan drift audit:\n');
  for (const row of rows) {
    process.stdout.write(
      `- ${row.packageId}: ${row.uncheckedCount} unchecked, todoMentionsPlan=${row.todoMentionsPlan}, todoIsStub=${row.todoIsStub}\n`,
    );
    for (const issue of row.issues) {
      issueCount += 1;
      process.stdout.write(`  ! ${issue}\n`);
    }
  }
  process.stdout.write(`Total drift issues: ${issueCount}\n`);
  return issueCount;
}

/**
 * Ensures the target task was checked off in PLAN.md after Codex execution.
 *
 * Not from Micropolis C; this validates markdown runbook progress consistency.
 */
function isTaskStillUnchecked(repoRoot, pkg, task) {
  const { tasks } = getPackagePlanStatus(repoRoot, pkg);
  if (task.id) {
    return tasks.some((candidate) => candidate.id === task.id);
  }
  return tasks.some((candidate) => candidate.text === task.text);
}

/**
 * Commits all repository changes for a package run.
 *
 * Not from Micropolis C; this wraps git commit creation for automated output.
 */
async function commitChanges(repoRoot, pkg, task, dryRun) {
  const taskLabel = task.id ? `${task.id} ${task.text}` : task.text;

  if (dryRun) {
    return `[dry-run] chore(${pkg.id}): ${taskLabel}`;
  }

  const addResult = await runCommand('git', ['add', '-A'], { cwd: repoRoot });
  if (addResult.code !== 0) {
    throw new Error(`Failed to git add in ${repoRoot}: ${addResult.stderr}`);
  }

  const commitMessage = `chore(${pkg.id}): complete ${task.id ?? 'task'} ${today()}`;
  const commitResult = await runCommand('git', ['commit', '-m', commitMessage], { cwd: repoRoot });

  if (commitResult.code !== 0) {
    const combined = `${commitResult.stdout}${commitResult.stderr}`;
    if (/nothing to commit/i.test(combined)) {
      return null;
    }
    throw new Error(`Failed to commit changes: ${combined}`);
  }

  return commitMessage;
}

/**
 * Pushes a package branch to origin.
 *
 * Not from Micropolis C; this publishes automated branch progress.
 */
async function pushBranch(repoRoot, pkg, dryRun) {
  if (dryRun) {
    return;
  }

  const pushResult = await runCommand('git', ['push', '-u', 'origin', pkg.branch], {
    cwd: repoRoot,
  });
  if (pushResult.code !== 0) {
    throw new Error(`Failed to push ${pkg.branch}: ${pushResult.stderr}`);
  }
}

/**
 * Executes one task iteration for a selected package.
 *
 * Not from Micropolis C; this coordinates Codex + checks + git/PR lifecycle.
 */
async function runTaskIteration(mainRepoRoot, worktreeRoot, pkg, task, args, logDir) {
  const taskId = task.id ?? 'task';
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const wasTaskUncheckedAtStart = isTaskStillUnchecked(worktreeRoot, pkg, task);

  let prompt = buildTaskPrompt(pkg, task);

  for (let attempt = 1; attempt <= args.maxRetriesPerTask; attempt += 1) {
    const logPath = path.join(logDir, `${pkg.id}-${taskId}-${timestamp}-attempt${attempt}.jsonl`);
    process.stdout.write(`\n[codex] ${pkg.id} ${taskId} attempt ${attempt}\n`);

    // eslint-disable-next-line no-await-in-loop
    const codexResult = await runCodexExec(worktreeRoot, prompt, logPath, args.model);
    const codexExitWarning =
      codexResult.code !== 0
        ? `Codex exited with code ${codexResult.code}. Continuing with diff/check validation. See log: ${logPath}`
        : null;

    // eslint-disable-next-line no-await-in-loop
    const changedFiles = await getChangedFiles(worktreeRoot);

    if (codexResult.code !== 0 && changedFiles.length === 0) {
      const reason = `Codex exited with code ${codexResult.code} and produced no file changes.`;
      process.stdout.write(`[retry] ${pkg.id} ${taskId} attempt ${attempt}: ${reason}\n`);
      prompt = buildRepairPrompt(
        pkg,
        task,
        `Codex exited with code ${codexResult.code} and produced no file changes. See log: ${logPath}`,
      );
      continue;
    }

    if (changedFiles.length === 0) {
      const reason = 'No file changes detected.';
      process.stdout.write(`[retry] ${pkg.id} ${taskId} attempt ${attempt}: ${reason}\n`);
      prompt = buildRepairPrompt(
        pkg,
        task,
        'No file changes detected. Task must modify code/docs.',
      );
      continue;
    }

    if (isTaskStillUnchecked(worktreeRoot, pkg, task)) {
      const reason = 'Target task is still unchecked in PLAN.md.';
      process.stdout.write(`[retry] ${pkg.id} ${taskId} attempt ${attempt}: ${reason}\n`);
      prompt = buildRepairPrompt(
        pkg,
        task,
        `Target task is still unchecked in ${pkg.planPath}; mark it checked and keep plan in sync.`,
      );
      continue;
    }

    if (wasTaskUncheckedAtStart && !changedFiles.includes(pkg.planPath)) {
      const reason = `${pkg.planPath} was not updated while this task started unchecked.`;
      process.stdout.write(`[retry] ${pkg.id} ${taskId} attempt ${attempt}: ${reason}\n`);
      prompt = buildRepairPrompt(
        pkg,
        task,
        `This task started unchecked, but ${pkg.planPath} was not updated in this attempt. Ensure the task check-off and execution log are updated.`,
      );
      continue;
    }

    if (codexExitWarning) {
      process.stdout.write(`[warn] ${codexExitWarning}\n`);
    }

    // eslint-disable-next-line no-await-in-loop
    const checkFailures = await runChecks(worktreeRoot, args.checks);
    if (checkFailures.length > 0) {
      const failedCheckNames = checkFailures.map((failure) => failure.command).join(', ');
      process.stdout.write(
        `[retry] ${pkg.id} ${taskId} attempt ${attempt}: checks failed (${failedCheckNames})\n`,
      );
      const summary = checkFailures
        .map(
          (failure) =>
            `Command: ${failure.command}\nExit: ${failure.code}\nOutput:\n${failure.output.slice(-5000)}`,
        )
        .join('\n\n---\n\n');
      prompt = buildRepairPrompt(pkg, task, summary);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const commitMessage = await commitChanges(worktreeRoot, pkg, task, args.dryRun);
    if (commitMessage === null) {
      const reason = 'Nothing to commit after checks passed.';
      process.stdout.write(`[retry] ${pkg.id} ${taskId} attempt ${attempt}: ${reason}\n`);
      prompt = buildRepairPrompt(
        pkg,
        task,
        'Nothing to commit after passing checks; verify task changes persist.',
      );
      continue;
    }

    if (!args.skipPush) {
      // eslint-disable-next-line no-await-in-loop
      await pushBranch(worktreeRoot, pkg, args.dryRun);
    }

    let prUrl = null;
    if (!args.skipPr) {
      // eslint-disable-next-line no-await-in-loop
      prUrl = await ensurePullRequest(
        mainRepoRoot,
        pkg,
        task,
        args.checks,
        args.dryRun,
        args.baseRef,
      );
    }

    return {
      success: true,
      commitMessage,
      prUrl,
    };
  }

  return {
    success: false,
    commitMessage: null,
    prUrl: null,
  };
}

/**
 * Runs the orchestrator loop until queue exhaustion or configured stop condition.
 *
 * Not from Micropolis C; this is an autonomous planning/execution loop.
 */
async function runOrchestrator(mainRepoRoot, packages, args) {
  const automationDir = path.join(mainRepoRoot, '.automation');
  const statePath = path.join(automationDir, 'orchestrator-state.json');
  const stopPath = path.join(automationDir, 'STOP');
  const logDir = path.join(automationDir, 'logs');

  mkdirSync(automationDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const state = readState(statePath);
  const startedAt = Date.now();
  let iterations = 0;

  while (iterations < args.maxIterations) {
    if (existsSync(stopPath)) {
      process.stdout.write(`\nStop file found at ${stopPath}; exiting.\n`);
      break;
    }

    const elapsedMinutes = (Date.now() - startedAt) / 60000;
    if (elapsedMinutes >= args.maxRuntimeMinutes) {
      process.stdout.write(`\nReached runtime limit (${args.maxRuntimeMinutes} min); exiting.\n`);
      break;
    }

    /** @type {{ pkg: (typeof DEFAULT_PACKAGES)[number]; status: ReturnType<typeof getPackagePlanStatus>; worktreeRoot: string }[]} */
    const packageStatuses = [];

    for (const pkg of packages) {
      // eslint-disable-next-line no-await-in-loop
      const worktreeRoot = await ensureWorktree(mainRepoRoot, pkg, args.baseRef, args.dryRun);
      const status = getPackagePlanStatus(worktreeRoot, pkg);
      packageStatuses.push({ pkg, status, worktreeRoot });
    }

    const blockedKeys = new Set(Object.keys(state.blocked));
    const pick = pickNextCandidate(packageStatuses, state.cursor, blockedKeys);

    if (!pick) {
      process.stdout.write('\nNo actionable tasks remaining (or all are blocked).\n');
      break;
    }

    const selected = packageStatuses[pick.index];
    const key = taskKey(selected.pkg, selected.status.nextTask);
    process.stdout.write(
      `\n[queue] Selected ${selected.pkg.id}: ${selected.status.nextTask.id ?? 'task'} :: ${selected.status.nextTask.text}\n`,
    );

    // eslint-disable-next-line no-await-in-loop
    const result = await runTaskIteration(
      mainRepoRoot,
      selected.worktreeRoot,
      selected.pkg,
      selected.status.nextTask,
      args,
      logDir,
    );

    if (result.success) {
      delete state.failures[key];
      if (result.prUrl) {
        state.prUrls[selected.pkg.id] = result.prUrl;
      }
      process.stdout.write(
        `[done] ${selected.pkg.id} ${selected.status.nextTask.id ?? 'task'} committed${
          result.prUrl ? ` | PR: ${result.prUrl}` : ''
        }\n`,
      );

      if (args.once) {
        state.cursor = (pick.index + 1) % packageStatuses.length;
        writeState(statePath, state);
        break;
      }
    } else {
      const failureCount = Number(state.failures[key] ?? 0) + 1;
      state.failures[key] = failureCount;
      process.stdout.write(
        `[fail] ${selected.pkg.id} ${selected.status.nextTask.id ?? 'task'} failed after ${args.maxRetriesPerTask} attempt(s). failureCount=${failureCount}\n`,
      );

      if (failureCount >= args.maxRetriesPerTask) {
        state.blocked[key] = {
          package: selected.pkg.id,
          task: selected.status.nextTask.text,
          blockedAt: new Date().toISOString(),
        };
        process.stdout.write(`[blocked] ${key}\n`);
      }
    }

    state.cursor = (pick.index + 1) % packageStatuses.length;
    writeState(statePath, state);
    iterations += 1;
  }

  writeState(statePath, state);

  process.stdout.write('\nOrchestrator summary:\n');
  for (const pkg of packages) {
    const prUrl = state.prUrls[pkg.id] ?? null;
    process.stdout.write(`- ${pkg.id}: ${prUrl ? `PR ${prUrl}` : 'no PR recorded yet'}\n`);
  }
}

/**
 * Entry point for queue/drift/run commands.
 *
 * Not from Micropolis C; this routes operator subcommands.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mainRepoRoot = process.cwd();
  const packages = DEFAULT_PACKAGES;

  if (args.command === 'queue') {
    printQueue(mainRepoRoot, packages);
    return;
  }

  if (args.command === 'drift') {
    const rows = buildDriftReport(mainRepoRoot, packages);
    const issueCount = printDriftReport(rows);
    process.exitCode = issueCount > 0 ? 1 : 0;
    return;
  }

  if (args.command === 'run') {
    await runOrchestrator(mainRepoRoot, packages, args);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});

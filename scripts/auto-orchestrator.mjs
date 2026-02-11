import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Plan automation metadata for the sim-core envelope host migration rollout.
 *
 * This orchestrator is intentionally different from Micropolis C runtime code:
 * it automates Codex task execution over markdown migration plans rather than
 * implementing simulation behavior directly.
 */
const SHIPPING_PLAN_PATH = 'apps/web/SIM_CORE_ENVELOPE_HOST_MIGRATION_PLAN.md';

/**
 * Plan stream definitions for the single migration plan document.
 *
 * Not from Micropolis C sources; this maps one plan-level checklist stream
 * to an isolated automation worktree/branch.
 */
const DEFAULT_PACKAGES = [
  {
    id: 'sim-core-envelope',
    stageNumber: null,
    stageLabel: 'Sim-Core Envelope Host Migration',
    packagePath: 'repo',
    planPath: SHIPPING_PLAN_PATH,
    branch: null,
    worktreePath: '.',
  },
];

/**
 * Default quality gates for each completed automation task.
 *
 * These are intentionally stricter than a 1:1 Micropolis command flow and are used
 * to ensure workspace integrity before commit/push/PR updates.
 */
const DEFAULT_CHECKS = ['pnpm typecheck', 'pnpm lint', 'pnpm format'];

/**
 * Returns today's date string for plan execution logs.
 *
 * Not a Micropolis C port; this is orchestration metadata for markdown updates.
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sanitizes dynamic values for safe use in log file names.
 *
 * Not from Micropolis C; this prevents `/` and other path/control characters
 * in task ids from creating invalid nested paths during orchestrator logging.
 */
function sanitizeForPathSegment(value) {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  if (cleaned.length === 0) {
    return 'task';
  }
  return cleaned.slice(0, 120);
}

/**
 * Returns the single inline-code token when task text is exactly one backticked value.
 *
 * Not from Micropolis C; this supports checklist task classification in markdown plans.
 */
function getSingleInlineCodeToken(text) {
  const match = /^`([^`]+)`$/.exec(text.trim());
  if (!match) {
    return null;
  }
  return match[1];
}

/**
 * Returns true when a checklist task is a file-reference item (for "Required References").
 *
 * Not from Micropolis C; this detects path-only checklist items in shipping plans.
 */
function isFileReferenceTask(repoRoot, task) {
  const token = getSingleInlineCodeToken(task.text);
  if (!token) {
    return false;
  }
  return existsSync(path.join(repoRoot, token));
}

/**
 * Marks one unchecked task line as checked using the parsed line number/text snapshot.
 *
 * Not from Micropolis C; this updates markdown checklist state for automation.
 */
function markTaskCheckedAtLine(repoRoot, pkg, task) {
  const planAbsolutePath = path.join(repoRoot, pkg.planPath);
  const lines = readFileSync(planAbsolutePath, 'utf8').split('\n');
  const lineIndex = task.lineNumber - 1;
  const line = lines[lineIndex] ?? '';
  const checklistMatch = /^(\s*- \[)([ xX])(\]\s+)(.+)$/.exec(line);

  if (!checklistMatch) {
    return false;
  }

  const currentTaskText = checklistMatch[4].trim();
  if (currentTaskText !== task.text.trim()) {
    return false;
  }

  if (checklistMatch[2].toLowerCase() === 'x') {
    return false;
  }

  lines[lineIndex] = `${checklistMatch[1]}x${checklistMatch[3]}${checklistMatch[4]}`;
  writeFileSync(planAbsolutePath, `${lines.join('\n')}\n`, 'utf8');
  return true;
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
    maxRuntimeMinutes: Number.POSITIVE_INFINITY,
    maxRetriesPerTask: 3,
    baseRef: 'main',
    includeTests: true,
    skipPush: false,
    skipPr: false,
    model: null,
    streamIds: null,
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
      const raw = (tokens[i + 1] ?? '').trim().toLowerCase();
      if (raw === 'inf' || raw === 'infinity' || raw === 'none') {
        args.maxRuntimeMinutes = Number.POSITIVE_INFINITY;
      } else {
        args.maxRuntimeMinutes = Number(tokens[i + 1]);
      }
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
    if (token === '--streams') {
      const rawStreams = tokens[i + 1] ?? '';
      args.streamIds = rawStreams
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
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
  if (
    args.maxRuntimeMinutes !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(args.maxRuntimeMinutes) || args.maxRuntimeMinutes < 1)
  ) {
    throw new Error('--max-runtime-minutes must be a positive number, or inf/infinity/none');
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
 * Extracts the task identifier from a stage checklist line.
 *
 * This is not a Micropolis C port. It parses markdown task labels such as
 * `**0.1 Create ...**` used by the staged TypeScript migration plans.
 */
function extractTaskId(text) {
  const boldStageId = /^\*\*([0-9]+\.[0-9]+)\b/.exec(text);
  if (boldStageId) {
    return boldStageId[1];
  }

  const plainStageId = /^([0-9]+\.[0-9]+)\b/.exec(text);
  if (plainStageId) {
    return plainStageId[1];
  }

  const inlineCodeId = /^`([^`]+)`/.exec(text);
  if (inlineCodeId) {
    return inlineCodeId[1];
  }

  return null;
}

/**
 * Parses one plan markdown document for either one scoped stage/phase or the full checklist.
 *
 * Not from Micropolis C sources; this interprets checklist docs under
 * migration plan markdown files for Codex automation.
 */
function parseStagePlan(markdown, stageNumber = null) {
  const lines = markdown.split('\n');
  /** @type {{ lineNumber: number; text: string; id: string | null }[]} */
  const uncheckedTasks = [];

  let inTargetSection = stageNumber === null;
  let hasTaskChecklist = stageNumber === null;
  let hasStageSection = stageNumber === null;
  let targetHeadingLevel = null;
  let checkedTaskCount = 0;
  let totalTaskCount = 0;
  let stageTitle = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(line);

    if (heading) {
      const level = heading[1]?.length ?? 0;
      const title = (heading[2] ?? '').trim();
      if (stageNumber !== null) {
        if (
          inTargetSection &&
          targetHeadingLevel !== null &&
          level <= targetHeadingLevel &&
          !/^Stage\s+/i.test(title) &&
          !/^Phase\s+/i.test(title)
        ) {
          break;
        }

        const stageMatch = /^Stage\s+([0-9]+)\b/i.exec(title);
        const phaseMatch = /^Phase\s+([0-9]+)\b/i.exec(title);
        const headingStageNumber = stageMatch
          ? Number(stageMatch[1])
          : phaseMatch
            ? Number(phaseMatch[1])
            : null;
        if (headingStageNumber === stageNumber) {
          inTargetSection = true;
          hasStageSection = true;
          targetHeadingLevel = level;
          stageTitle = title;
          hasTaskChecklist = true;
        } else if (inTargetSection && targetHeadingLevel !== null && level <= targetHeadingLevel) {
          break;
        }
      } else {
        hasTaskChecklist = true;
      }
      continue;
    }

    if (stageNumber !== null && !inTargetSection) {
      continue;
    }

    if (stageNumber !== null || hasTaskChecklist) {
      const checkMatch = /^\s*- \[([ xX])\] (.+)$/.exec(line);
      if (!checkMatch) {
        continue;
      }

      const mark = checkMatch[1];
      const text = checkMatch[2].trim();
      totalTaskCount += 1;

      if (mark.toLowerCase() === 'x') {
        checkedTaskCount += 1;
        continue;
      }

      uncheckedTasks.push({
        lineNumber: index + 1,
        text,
        id: extractTaskId(text),
      });
      continue;
    }
  }

  return {
    tasks: uncheckedTasks,
    stageTitle,
    hasStageSection,
    hasTaskChecklist,
    checkedTaskCount,
    totalTaskCount,
  };
}

/**
 * Produces actionable unchecked tasks from a stage plan.
 *
 * Intentionally different from Micropolis C data structures: this consumes markdown
 * checklist format used for staged TS-port planning.
 */
function parseActionablePlanTasks(markdown) {
  return parseStagePlan(markdown).tasks;
}

/**
 * Reads and parses tasks for a package in a specific repository root.
 *
 * Not from Micropolis C; this is orchestration state for Codex-driven execution.
 */
function getPackagePlanStatus(repoRoot, pkg) {
  const planAbsolutePath = path.join(repoRoot, pkg.planPath);
  const content = readFileSync(planAbsolutePath, 'utf8');
  const parsed = parseStagePlan(content, pkg.stageNumber);
  const tasks = parsed.tasks;
  return {
    planAbsolutePath,
    tasks,
    nextTask: tasks[0] ?? null,
    checklist: parsed,
  };
}

/**
 * Resolves which repository root should be used for package status reads.
 *
 * Not from Micropolis C; this prefers package worktrees when they exist so queue
 * and drift views match autonomous branch state.
 */
function resolveStatusRepoRoot(mainRepoRoot, pkg) {
  if (pkg.worktreePath === '.' || pkg.worktreePath === '') {
    return mainRepoRoot;
  }

  const worktreeAbsolutePath = path.join(mainRepoRoot, pkg.worktreePath);
  if (existsSync(path.join(worktreeAbsolutePath, '.git'))) {
    return worktreeAbsolutePath;
  }
  return mainRepoRoot;
}

/**
 * Resolves the git branch for one package stream.
 *
 * Not from Micropolis C; this lets orchestrator streams run either on a fixed
 * configured branch or the current checked-out branch.
 */
async function resolvePackageBranch(repoRoot, pkg) {
  if (typeof pkg.branch === 'string' && pkg.branch.trim().length > 0) {
    return pkg.branch;
  }

  const branchResult = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot,
  });
  if (branchResult.code !== 0) {
    throw new Error(`Failed to resolve current git branch: ${branchResult.stderr}`);
  }

  const branchName = branchResult.stdout.trim();
  if (!branchName || branchName === 'HEAD') {
    throw new Error('Cannot resolve current git branch (detached HEAD).');
  }
  return branchName;
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

    child.stdout?.on('data', (chunk) => {
      const buffer = Buffer.from(chunk);
      stdout.push(buffer);
      options.onStdoutChunk?.(buffer);
    });
    child.stderr?.on('data', (chunk) => {
      const buffer = Buffer.from(chunk);
      stderr.push(buffer);
      options.onStderrChunk?.(buffer);
    });
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
 * Not a Micropolis runtime port; this isolates autonomous edits per stage stream.
 */
async function ensureWorktree(mainRepoRoot, pkg, baseRef, dryRun) {
  if (pkg.worktreePath === '.' || pkg.worktreePath === '') {
    return mainRepoRoot;
  }

  const worktreeAbsolutePath = path.join(mainRepoRoot, pkg.worktreePath);
  if (existsSync(path.join(worktreeAbsolutePath, '.git'))) {
    return worktreeAbsolutePath;
  }

  if (dryRun) {
    return mainRepoRoot;
  }

  mkdirSync(path.dirname(worktreeAbsolutePath), { recursive: true });
  const targetBranch = await resolvePackageBranch(mainRepoRoot, pkg);

  const branchExists = await runCommand(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/heads/${targetBranch}`],
    { cwd: mainRepoRoot },
  );

  const addArgs =
    branchExists.code === 0
      ? ['worktree', 'add', worktreeAbsolutePath, targetBranch]
      : ['worktree', 'add', '-b', targetBranch, worktreeAbsolutePath, baseRef];

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
function formatPlanScope(pkg) {
  if (Number.isInteger(pkg.stageNumber)) {
    return `Stage ${pkg.stageNumber}`;
  }
  return 'the full plan checklist';
}

/**
 * Returns a scope-specific instruction line for task selection.
 *
 * Not from Micropolis C; this keeps prompts aligned with stage-scoped or
 * plan-wide checklist execution modes.
 */
function buildScopeInstruction(pkg) {
  if (Number.isInteger(pkg.stageNumber)) {
    return `- Do not start tasks from any stage section other than Stage ${pkg.stageNumber}.`;
  }
  return '- Do not start a second task; complete exactly one currently unchecked checklist item.';
}

/**
 * Returns a scope-specific instruction line for check-off requirements.
 *
 * Not from Micropolis C; this keeps prompts explicit about markdown checklist updates.
 */
function buildScopeCheckoffInstruction(pkg) {
  if (Number.isInteger(pkg.stageNumber)) {
    return `- Mark this exact task as checked in ${pkg.planPath} under Stage ${pkg.stageNumber}.`;
  }
  return `- Mark this exact task as checked in ${pkg.planPath}.`;
}

function buildTaskPrompt(pkg, task) {
  const taskLabel = task.id ? `${task.id} - ${task.text}` : task.text;
  return [
    `Work only on ${pkg.stageLabel} (${pkg.id}).`,
    `Complete exactly one unchecked plan task from ${pkg.planPath} under ${formatPlanScope(pkg)}.`,
    `Target task: ${taskLabel}`,
    'Requirements:',
    '- Read the stage plan fully, including Required Context, Agent Rules, and checklist notes.',
    '- Implement only this task and required support changes.',
    buildScopeInstruction(pkg),
    buildScopeCheckoffInstruction(pkg),
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
    `Repair the existing implementation for ${pkg.stageLabel} task: ${taskLabel}.`,
    'Do not start a new plan task.',
    'Fix the failing checks below and keep the plan/task state consistent.',
    'Failed checks output:',
    failedChecksSummary,
    'Constraints:',
    buildScopeCheckoffInstruction(pkg),
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

  /**
   * Emits a progress line with an empty separator line for readability.
   *
   * Not from Micropolis C; this formats codex-cli activity output for
   * human-readable terminal progress.
   */
  function writeProgressLine(line) {
    process.stdout.write(`${line}\n\n`);
  }

  /**
   * Handles a single output line from codex-cli streams.
   *
   * Not from Micropolis C; this decodes codex JSONL events and prints either
   * event `type` progress lines or detailed fallback output.
   */
  function handleCodexOutputLine(line, streamLabel) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const eventType = typeof parsed?.type === 'string' ? parsed.type : null;
      if (!eventType) {
        writeProgressLine(`[codex:${streamLabel}] ${line}`);
        return;
      }

      if (eventType === 'error') {
        writeProgressLine(`[codex:error] ${trimmed}`);
        return;
      }

      writeProgressLine(eventType);
    } catch {
      writeProgressLine(`[codex:${streamLabel}] ${trimmed}`);
    }
  }

  /**
   * Builds a chunk handler that buffers until newline and dispatches lines.
   *
   * Not from Micropolis C; this supports streaming JSONL parsing over arbitrary
   * chunk boundaries from Node child process pipes.
   */
  function createChunkLineHandler(streamLabel) {
    let pending = '';
    return {
      onChunk(chunk) {
        pending += chunk.toString('utf8');
        while (true) {
          const newlineIndex = pending.indexOf('\n');
          if (newlineIndex < 0) {
            break;
          }

          const line = pending.slice(0, newlineIndex).replace(/\r$/, '');
          pending = pending.slice(newlineIndex + 1);
          handleCodexOutputLine(line, streamLabel);
        }
      },
      flush() {
        if (pending.length === 0) {
          return;
        }
        const line = pending.replace(/\r$/, '');
        pending = '';
        handleCodexOutputLine(line, streamLabel);
      },
    };
  }

  const stdoutProgress = createChunkLineHandler('stdout');
  const stderrProgress = createChunkLineHandler('stderr');

  const result = await runCommand('codex', args, {
    cwd,
    onStdoutChunk: (chunk) => {
      stdoutProgress.onChunk(chunk);
    },
    onStderrChunk: (chunk) => {
      stderrProgress.onChunk(chunk);
    },
  });
  stdoutProgress.flush();
  stderrProgress.flush();
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

  const branch = await resolvePackageBranch(mainRepoRoot, pkg);
  const taskLabel = task.id ? `${task.id} ${task.text}` : task.text;
  const listResult = await runCommand(
    'gh',
    ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url', '--limit', '1'],
    { cwd: mainRepoRoot },
  );

  if (listResult.code !== 0) {
    throw new Error(`Failed to query PR list for ${branch}: ${listResult.stderr}`);
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
    `Automated plan stream for \`${pkg.stageLabel}\` (\`${pkg.id}\`).`,
    '',
    `Latest completed task: \`${taskLabel}\``,
    '',
    'Quality gates run:',
    ...checks.map((check) => `- ${check}`),
  ].join('\n');

  const createResult = await runCommand(
    'gh',
    ['pr', 'create', '--base', baseRef, '--head', branch, '--title', title, '--body', body],
    { cwd: mainRepoRoot },
  );

  if (createResult.code !== 0) {
    throw new Error(`Failed to create PR for ${branch}: ${createResult.stderr}`);
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
 * Picks the next stream/task candidate in plan order.
 *
 * This is intentionally different from Micropolis C scheduling. The orchestrator
 * advances configured checklist streams in order.
 */
function pickNextCandidate(packagesWithStatus) {
  if (packagesWithStatus.length === 0) {
    return null;
  }

  for (let index = 0; index < packagesWithStatus.length; index += 1) {
    const candidate = packagesWithStatus[index];
    if (!candidate.status.nextTask) {
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
      prUrls: {},
      pendingRemote: {},
    };
  }

  const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
  return {
    cursor: 0,
    failures: {},
    prUrls: {},
    pendingRemote: {},
    ...parsed,
    failures: parsed.failures ?? {},
    prUrls: parsed.prUrls ?? {},
    pendingRemote: parsed.pendingRemote ?? {},
  };
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
 * Produces a drift audit summary for plan consistency.
 *
 * Not from Micropolis C; this detects checklist structure drift in the target
 * migration plan document.
 */
function buildDriftReport(repoRoot, packages) {
  /** @type {{ stageId: string; stageLabel: string; uncheckedCount: number; checkedCount: number; totalTasks: number; issues: string[] }[]} */
  const rows = [];

  for (const pkg of packages) {
    const statusRoot = resolveStatusRepoRoot(repoRoot, pkg);
    const status = getPackagePlanStatus(statusRoot, pkg);
    const checklist = status.checklist;

    /** @type {string[]} */
    const issues = [];
    if (Number.isInteger(pkg.stageNumber) && !checklist.hasStageSection) {
      issues.push(`Missing section for Stage/Phase ${pkg.stageNumber}`);
    }
    if (checklist.totalTaskCount === 0) {
      const scopeLabel = Number.isInteger(pkg.stageNumber)
        ? `Stage/Phase ${pkg.stageNumber}`
        : 'plan checklist';
      issues.push(`No checklist tasks found in ${scopeLabel}`);
    }

    rows.push({
      stageId: pkg.id,
      stageLabel: pkg.stageLabel,
      uncheckedCount: status.tasks.length,
      checkedCount: checklist.checkedTaskCount,
      totalTasks: checklist.totalTaskCount,
      issues,
    });
  }

  return rows;
}

/**
 * Prints queue status for each configured plan stream.
 *
 * Not from Micropolis C; this is operator visibility for checklist work.
 */
function printQueue(repoRoot, packages) {
  process.stdout.write(`Plan queue status (${SHIPPING_PLAN_PATH}):\n`);
  for (const pkg of packages) {
    const statusRoot = resolveStatusRepoRoot(repoRoot, pkg);
    const status = getPackagePlanStatus(statusRoot, pkg);
    const nextLabel = status.nextTask
      ? `${status.nextTask.id ?? 'task'} @ line ${status.nextTask.lineNumber}: ${status.nextTask.text}`
      : 'DONE';

    process.stdout.write(
      `- ${pkg.id} (${pkg.stageLabel}): ${status.tasks.length} remaining; next=${nextLabel}\n`,
    );
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
      `- ${row.stageId} (${row.stageLabel}): ${row.uncheckedCount} unchecked, ${row.checkedCount}/${row.totalTasks} checked\n`,
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
 * Resolves selected plan streams from `--streams`.
 *
 * Not from Micropolis C; this is CLI filtering for plan automation.
 */
function selectPackages(allPackages, streamIds) {
  if (!Array.isArray(streamIds) || streamIds.length === 0) {
    return allPackages;
  }

  const byId = new Map(allPackages.map((pkg) => [pkg.id, pkg]));
  const selected = [];

  for (const streamId of streamIds) {
    const pkg = byId.get(streamId);
    if (!pkg) {
      const known = allPackages.map((candidate) => candidate.id).join(', ');
      throw new Error(`Unknown stream id "${streamId}". Known stream ids: ${known}`);
    }
    selected.push(pkg);
  }

  return selected;
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

  const branch = await resolvePackageBranch(repoRoot, pkg);
  const pushResult = await runCommand('git', ['push', '-u', 'origin', branch], {
    cwd: repoRoot,
  });
  if (pushResult.code !== 0) {
    throw new Error(`Failed to push ${branch}: ${pushResult.stderr}`);
  }
}

/**
 * Normalizes GitHub sync failures into concise, operator-readable warnings.
 *
 * Not from Micropolis C; this is orchestration error-reporting for remote operations.
 */
function formatGitHubSyncError(pkg, operation, error) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const compactMessage = rawMessage
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 2)
    .join(' | ');
  const detail = compactMessage.length > 0 ? compactMessage : 'No additional details.';
  return `${pkg.id} ${operation} failed; deferring remote sync. ${detail}`;
}

/**
 * Runs best-effort branch push and PR update for one completed task.
 *
 * Not from Micropolis C; this allows task progression to continue during GitHub outages.
 */
async function syncGitHubForTask(mainRepoRoot, worktreeRoot, pkg, task, args) {
  /** @type {string[]} */
  const remoteSyncErrors = [];
  let prUrl = null;
  let pushSucceeded = args.skipPush;

  if (!args.skipPush) {
    try {
      await pushBranch(worktreeRoot, pkg, args.dryRun);
      pushSucceeded = true;
    } catch (error) {
      remoteSyncErrors.push(formatGitHubSyncError(pkg, 'push', error));
    }
  }

  if (!args.skipPr) {
    if (!pushSucceeded && !args.skipPush) {
      remoteSyncErrors.push(
        `${pkg.id} pr skipped because push did not succeed; will retry in a later sync pass.`,
      );
    } else {
      try {
        prUrl = await ensurePullRequest(
          mainRepoRoot,
          pkg,
          task,
          args.checks,
          args.dryRun,
          args.baseRef,
        );
      } catch (error) {
        remoteSyncErrors.push(formatGitHubSyncError(pkg, 'pr', error));
      }
    }
  }

  return {
    prUrl,
    remoteSyncErrors,
  };
}

/**
 * Executes one task iteration for a selected package.
 *
 * Not from Micropolis C; this coordinates Codex + checks + git/PR lifecycle.
 */
async function runTaskIteration(mainRepoRoot, worktreeRoot, pkg, task, args, logDir) {
  const taskId = task.id ?? 'task';
  const logTaskId = sanitizeForPathSegment(taskId);
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const wasTaskUncheckedAtStart = isTaskStillUnchecked(worktreeRoot, pkg, task);

  if (isFileReferenceTask(worktreeRoot, task)) {
    process.stdout.write(
      `[auto] ${pkg.id} ${taskId}: file-reference checklist task detected; checking plan item directly.\n`,
    );

    const marked = markTaskCheckedAtLine(worktreeRoot, pkg, task);
    if (!marked) {
      process.stdout.write(
        `[auto] ${pkg.id} ${taskId}: could not mark via direct line update; falling back to Codex.\n`,
      );
    } else {
      const changedFiles = await getChangedFiles(worktreeRoot);
      if (!changedFiles.includes(pkg.planPath)) {
        return {
          success: false,
          commitMessage: null,
          prUrl: null,
          remoteSyncErrors: [],
        };
      }

      const checkFailures = await runChecks(worktreeRoot, args.checks);
      if (checkFailures.length > 0) {
        return {
          success: false,
          commitMessage: null,
          prUrl: null,
          remoteSyncErrors: [],
        };
      }

      const commitMessage = await commitChanges(worktreeRoot, pkg, task, args.dryRun);
      if (commitMessage === null) {
        return {
          success: false,
          commitMessage: null,
          prUrl: null,
          remoteSyncErrors: [],
        };
      }

      const syncResult = await syncGitHubForTask(mainRepoRoot, worktreeRoot, pkg, task, args);

      return {
        success: true,
        commitMessage,
        prUrl: syncResult.prUrl,
        remoteSyncErrors: syncResult.remoteSyncErrors,
      };
    }
  }

  let prompt = buildTaskPrompt(pkg, task);

  for (let attempt = 1; attempt <= args.maxRetriesPerTask; attempt += 1) {
    const logPath = path.join(
      logDir,
      `${pkg.id}-${logTaskId}-${timestamp}-attempt${attempt}.jsonl`,
    );
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
        `Target task is still unchecked in ${pkg.planPath} (${formatPlanScope(pkg)}); mark it checked and keep plan in sync.`,
      );
      continue;
    }

    if (wasTaskUncheckedAtStart && !changedFiles.includes(pkg.planPath)) {
      const reason = `${pkg.planPath} was not updated while this task started unchecked.`;
      process.stdout.write(`[retry] ${pkg.id} ${taskId} attempt ${attempt}: ${reason}\n`);
      prompt = buildRepairPrompt(
        pkg,
        task,
        `This task started unchecked, but ${pkg.planPath} was not updated in this attempt. Ensure the task check-off is updated in ${formatPlanScope(pkg)}.`,
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

    // eslint-disable-next-line no-await-in-loop
    const syncResult = await syncGitHubForTask(mainRepoRoot, worktreeRoot, pkg, task, args);

    return {
      success: true,
      commitMessage,
      prUrl: syncResult.prUrl,
      remoteSyncErrors: syncResult.remoteSyncErrors,
    };
  }

  return {
    success: false,
    commitMessage: null,
    prUrl: null,
    remoteSyncErrors: [],
  };
}

/**
 * Retries pending push/PR operations after queue processing completes.
 *
 * Not from Micropolis C; this performs deferred GitHub synchronization for outage recovery.
 */
async function syncPendingRemote(mainRepoRoot, packages, args, state) {
  if (args.dryRun || (args.skipPush && args.skipPr)) {
    return;
  }

  const pendingEntries = Object.entries(state.pendingRemote ?? {});
  if (pendingEntries.length === 0) {
    return;
  }

  process.stdout.write(
    `\n[remote-sync] Retrying ${pendingEntries.length} pending remote sync item(s).\n`,
  );

  const packageById = new Map(packages.map((pkg) => [pkg.id, pkg]));

  for (const [pkgId, pendingRecord] of pendingEntries) {
    const pkg = packageById.get(pkgId);
    if (!pkg) {
      delete state.pendingRemote[pkgId];
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const worktreeRoot = await ensureWorktree(mainRepoRoot, pkg, args.baseRef, args.dryRun);
    const task = {
      id: pendingRecord.taskId ?? null,
      text: pendingRecord.taskText ?? 'deferred remote sync',
    };

    // eslint-disable-next-line no-await-in-loop
    const syncResult = await syncGitHubForTask(mainRepoRoot, worktreeRoot, pkg, task, args);

    if (syncResult.prUrl) {
      state.prUrls[pkg.id] = syncResult.prUrl;
    }

    if (syncResult.remoteSyncErrors.length === 0) {
      delete state.pendingRemote[pkg.id];
      process.stdout.write(`[remote-sync] ${pkg.id} synchronized.\n`);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const branch = await resolvePackageBranch(worktreeRoot, pkg);
    state.pendingRemote[pkg.id] = {
      ...pendingRecord,
      package: pkg.id,
      branch,
      taskId: task.id,
      taskText: task.text,
      updatedAt: new Date().toISOString(),
      errors: syncResult.remoteSyncErrors,
    };
    process.stdout.write(
      `[remote-sync] ${pkg.id} still pending (${syncResult.remoteSyncErrors.length} issue(s)).\n`,
    );
    for (const warning of syncResult.remoteSyncErrors) {
      process.stdout.write(`[warn] ${warning}\n`);
    }
  }
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

    const pick = pickNextCandidate(packageStatuses);

    if (!pick) {
      process.stdout.write('\nNo actionable plan tasks remaining.\n');
      break;
    }

    const selected = packageStatuses[pick.index];
    process.stdout.write(
      `\n[queue] Selected ${selected.pkg.id} (${selected.pkg.stageLabel}): ${selected.status.nextTask.id ?? 'task'} :: ${selected.status.nextTask.text}\n`,
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
      const key = taskKey(selected.pkg, selected.status.nextTask);
      delete state.failures[key];
      if (result.prUrl) {
        state.prUrls[selected.pkg.id] = result.prUrl;
      }

      if (result.remoteSyncErrors.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        const branch = await resolvePackageBranch(selected.worktreeRoot, selected.pkg);
        state.pendingRemote[selected.pkg.id] = {
          package: selected.pkg.id,
          branch,
          taskId: selected.status.nextTask.id ?? null,
          taskText: selected.status.nextTask.text,
          updatedAt: new Date().toISOString(),
          errors: result.remoteSyncErrors,
        };
      } else {
        delete state.pendingRemote[selected.pkg.id];
      }
      process.stdout.write(
        `[done] ${selected.pkg.id} ${selected.status.nextTask.id ?? 'task'} committed${
          result.prUrl ? ` | PR: ${result.prUrl}` : ''
        }\n`,
      );
      for (const warning of result.remoteSyncErrors) {
        process.stdout.write(`[warn] ${warning}\n`);
      }

      if (args.once) {
        writeState(statePath, state);
        break;
      }
    } else {
      const key = taskKey(selected.pkg, selected.status.nextTask);
      const failureCount = Number(state.failures[key] ?? 0) + 1;
      state.failures[key] = failureCount;
      process.stdout.write(
        `[fail] ${selected.pkg.id} ${selected.status.nextTask.id ?? 'task'} failed after ${args.maxRetriesPerTask} attempt(s). failureCount=${failureCount}\n`,
      );
    }

    writeState(statePath, state);
    iterations += 1;
  }

  await syncPendingRemote(mainRepoRoot, packages, args, state);
  writeState(statePath, state);

  process.stdout.write('\nOrchestrator summary:\n');
  for (const pkg of packages) {
    const prUrl = state.prUrls[pkg.id] ?? null;
    process.stdout.write(`- ${pkg.id}: ${prUrl ? `PR ${prUrl}` : 'no PR recorded yet'}\n`);
  }

  const pendingRemoteEntries = Object.values(state.pendingRemote ?? {});
  if (pendingRemoteEntries.length > 0) {
    process.stdout.write('\nPending remote sync:\n');
    for (const entry of pendingRemoteEntries) {
      const lastError =
        Array.isArray(entry.errors) && entry.errors.length > 0 ? entry.errors[0] : null;
      process.stdout.write(
        `- ${entry.package}: branch=${entry.branch} updated=${entry.updatedAt}${
          lastError ? ` | lastError=${lastError}` : ''
        }\n`,
      );
    }
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
  const packages = selectPackages(DEFAULT_PACKAGES, args.streamIds);

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

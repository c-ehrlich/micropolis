import { spawn } from 'node:child_process';

/**
 * Run a command and capture all output for deferred printing.
 * Used by the root `pnpm check` script to run all checks even if some fail, then
 * print the full output for each failed step at the end.
 */
function run(command) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));

    child.on('close', (code, signal) => {
      resolve({
        code: code ?? 1,
        signal,
        output: Buffer.concat([...stdout, ...stderr]).toString('utf8'),
      });
    });
  });
}

/**
 * Root repo checks.
 *
 * Note: `lint` and `format` are currently "fixing" (write to disk), so by
 * default we run fixers serially, then run read-only checks (`test`,
 * `typecheck`) in parallel for speed.
 *
 * Set `CITY_CHECK_UNSAFE_PARALLEL=1` to run everything in parallel anyway.
 *
 * Pass `--hook` (or set `CITY_CHECK_MODE=hook`) to run read-only checks that
 * are suitable for git hooks (no auto-fixing).
 */
const hookMode = process.argv.includes('--hook') || process.env.CITY_CHECK_MODE === 'hook';

const steps = hookMode
  ? [
      { name: 'lint', command: 'pnpm lint:check', mutatesWorkingTree: false },
      {
        name: 'format',
        command: 'pnpm format:check',
        mutatesWorkingTree: false,
      },
      { name: 'test', command: 'pnpm test', mutatesWorkingTree: false },
      { name: 'typecheck', command: 'pnpm typecheck', mutatesWorkingTree: false },
    ]
  : [
      { name: 'lint', command: 'pnpm lint', mutatesWorkingTree: true },
      { name: 'format', command: 'pnpm format', mutatesWorkingTree: true },
      { name: 'test', command: 'pnpm test', mutatesWorkingTree: false },
      { name: 'typecheck', command: 'pnpm typecheck', mutatesWorkingTree: false },
    ];

/** @type {{ name: string; command: string; code: number; signal: string | null; output: string }[]} */
const failures = [];

const unsafeParallel = process.env.CITY_CHECK_UNSAFE_PARALLEL === '1';

async function runStep(step) {
  process.stdout.write(`\n==> ${step.name}\n`);
  const result = await run(step.command);

  if (result.code !== 0) {
    failures.push({ name: step.name, command: step.command, ...result });
    process.stdout.write(`✗ ${step.name} failed\n`);
  } else {
    process.stdout.write(`✓ ${step.name} passed\n`);
  }
}

if (unsafeParallel) {
  await Promise.all(steps.map((step) => runStep(step)));
} else {
  const mutatingSteps = steps.filter((s) => s.mutatesWorkingTree);
  const readonlySteps = steps.filter((s) => !s.mutatesWorkingTree);

  for (const step of mutatingSteps) {
    // eslint-disable-next-line no-await-in-loop
    await runStep(step);
  }

  await Promise.all(readonlySteps.map((step) => runStep(step)));
}

if (failures.length === 0) {
  process.stdout.write('\nAll checks passed.\n');
  process.exit(0);
}

process.stderr.write(`\n${failures.length} check(s) failed. Logs:\n`);
for (const failure of failures) {
  process.stderr.write(
    `\n--- ${failure.name} (${failure.command}) exit ${failure.code}${
      failure.signal ? `, signal ${failure.signal}` : ''
    } ---\n`,
  );
  process.stderr.write(failure.output || '(no output)\n');
}
process.exit(1);

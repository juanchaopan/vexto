import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './node-tools.ts';
import {
  cliEnv,
  envAddArgs,
  otherKindFlag,
  planSync,
  runtimeValues,
  syncStepEnv,
  type RuntimeValue,
} from './runtime-env.ts';

const values: RuntimeValue[] = [
  { name: 'DB_URL', kind: 'secret' },
  { name: 'API_KEY', kind: 'secret' },
  { name: 'BUCKET', kind: 'variable' },
  { name: 'REGION', kind: 'variable' },
];

/** A step environment where every name is passed and none is stored under the wrong kind. */
function stepEnv(entries: Record<string, string>) {
  const env: Record<string, string> = {};
  for (const value of values) {
    env[otherKindFlag(value)] = 'false';
  }
  return { ...env, ...entries };
}

const workflowsDir = path.join(repoRoot, '.github', 'workflows');
const syncStepName = 'Copy the runtime values to the Vercel project';

function indentOf(line: string) {
  return line.length - line.trimStart().length;
}

function isContent(line: string) {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

/**
 * Reads the env mapping of the step with the given name from a workflow's text. Every content
 * line one level under the step's `env:` must be `NAME: value`, optionally followed by a comment;
 * any other line throws, so a layout the reader does not understand fails the test instead of
 * being passed over.
 */
function readStepEnv(workflow: string, stepName: string) {
  const lines = workflow.split(/\r?\n/);
  const starts = lines.flatMap((line, index) =>
    line.trim() === `- name: ${stepName}` ? [index] : [],
  );
  if (starts.length !== 1) {
    throw new Error(`Expected one step named "${stepName}", found ${starts.length}.`);
  }
  const start = starts[0];
  const dashIndent = indentOf(lines[start]);
  const after = lines.findIndex(
    (line, index) => index > start && isContent(line) && indentOf(line) <= dashIndent,
  );
  const step = lines.slice(start + 1, after === -1 ? undefined : after);
  const envAt = step.findIndex(
    (line) => indentOf(line) === dashIndent + 2 && line.trim() === 'env:',
  );
  if (envAt === -1) {
    throw new Error(`The step "${stepName}" has no env.`);
  }
  const env: Record<string, string> = {};
  for (const line of step.slice(envAt + 1)) {
    if (!isContent(line)) {
      continue;
    }
    if (indentOf(line) <= dashIndent + 2) {
      break;
    }
    const entry = /^([A-Za-z_][A-Za-z0-9_]*): (\S.*?)(?:\s+#.*)?$/.exec(line.trim());
    if (!entry || entry[1] in env) {
      throw new Error(`Cannot read the env line "${line.trim()}" of "${stepName}".`);
    }
    env[entry[1]] = entry[2];
  }
  return env;
}

describe('runtimeValues', () => {
  it('lists every name once', () => {
    const names = runtimeValues.map((value) => value.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps browser-visible values out of the secrets', () => {
    const publicSecrets = runtimeValues.filter(
      (value) => value.kind === 'secret' && value.name.startsWith('NEXT_PUBLIC_'),
    );
    expect(publicSecrets).toEqual([]);
  });

  it('gives no flag a name that is also a runtime value', () => {
    const names = new Set(runtimeValues.map((value) => value.name));
    expect(runtimeValues.map(otherKindFlag).filter((flag) => names.has(flag))).toEqual([]);
  });
});

describe('syncStepEnv', () => {
  it('reads each value from its own kind and only tests the other kind for the name', () => {
    expect(syncStepEnv([values[0], values[2]])).toEqual({
      DB_URL: '${{ secrets.DB_URL }}',
      DB_URL_STORED_AS_VARIABLE: "${{ vars.DB_URL != '' }}",
      BUCKET: '${{ vars.BUCKET }}',
      BUCKET_STORED_AS_SECRET: "${{ secrets.BUCKET != '' }}",
    });
  });
});

describe('the sync step of deploy-target.yml', () => {
  const workflow = readFileSync(path.join(workflowsDir, 'deploy-target.yml'), 'utf8');

  it('passes exactly the listed runtime values, each from its own kind, and the Vercel token', () => {
    expect(readStepEnv(workflow, syncStepName)).toEqual({
      VERCEL_TOKEN: '${{ secrets.VERCEL_TOKEN }}',
      ...syncStepEnv(),
    });
  });
});

describe('readStepEnv', () => {
  const workflow = [
    'steps:',
    '  - name: Sync',
    '    env:',
    '      # a comment',
    '      A: ${{ secrets.A }} # trailing comment',
    '',
    '      B: ${{ vars.B }}',
    '    run: echo',
    '  - name: Other',
    '    env:',
    '      C: x',
  ].join('\n');

  it('reads the env of the named step only', () => {
    expect(readStepEnv(workflow, 'Sync')).toEqual({
      A: '${{ secrets.A }}',
      B: '${{ vars.B }}',
    });
  });

  it('fails on an env it cannot read', () => {
    expect(() => readStepEnv(workflow.replace('B: ${{ vars.B }}', '<<: *anchor'), 'Sync')).toThrow(
      'Cannot read',
    );
    expect(() => readStepEnv(workflow.replace('B: ${{ vars.B }}', 'A: x'), 'Sync')).toThrow(
      'Cannot read',
    );
    expect(() => readStepEnv(workflow, 'Missing')).toThrow('found 0');
  });
});

describe('the workflows', () => {
  it('never hand a step the whole secrets or vars context', () => {
    const wholeContext = /toJSON\(\s*(secrets|vars)\s*\)/i;
    const offending = readdirSync(workflowsDir).filter((file) =>
      wholeContext.test(readFileSync(path.join(workflowsDir, file), 'utf8')),
    );
    expect(offending).toEqual([]);
  });
});

describe('planSync', () => {
  it('uploads the values that are set, in list order, and skips the rest', () => {
    const plan = planSync(
      stepEnv({ API_KEY: 'k', DB_URL: 'postgres://x', REGION: '', BUCKET: 'b', OTHER: 'o' }),
      values,
    );
    expect(plan).toEqual({
      upload: [
        { name: 'DB_URL', kind: 'secret', value: 'postgres://x' },
        { name: 'API_KEY', kind: 'secret', value: 'k' },
        { name: 'BUCKET', kind: 'variable', value: 'b' },
      ],
      skipped: ['REGION'],
      errors: [],
    });
  });

  it('stops when a secret is stored as a variable or a variable as a secret', () => {
    const plan = planSync(
      stepEnv({
        DB_URL: 'postgres://x',
        DB_URL_STORED_AS_VARIABLE: 'true',
        BUCKET_STORED_AS_SECRET: 'true',
      }),
      values,
    );
    expect(plan.upload).toEqual([]);
    expect(plan.errors).toEqual([
      'DB_URL is a secret; store it in the GitHub environment as an environment secret.',
      'BUCKET is a variable; store it in the GitHub environment as an environment variable.',
    ]);
  });

  it('stops when the step does not pass a listed name', () => {
    const env = stepEnv({ DB_URL: 'postgres://x' });
    delete env.REGION_STORED_AS_SECRET;
    const plan = planSync(env, values);
    expect(plan.errors).toEqual([
      "REGION is not passed to the sync step; add it to the step's env in .github/workflows/deploy-target.yml.",
    ]);
  });

  it('skips everything when the environment holds nothing', () => {
    const plan = planSync(stepEnv({}), values);
    expect(plan.upload).toEqual([]);
    expect(plan.skipped).toEqual(['DB_URL', 'API_KEY', 'BUCKET', 'REGION']);
  });
});

describe('cliEnv', () => {
  it('drops the runtime values and their flags and keeps the rest', () => {
    const env = stepEnv({ DB_URL: 'postgres://x', BUCKET: 'b', VERCEL_TOKEN: 't', PATH: '/bin' });
    expect(cliEnv(env, values)).toEqual({ VERCEL_TOKEN: 't', PATH: '/bin' });
  });
});

describe('envAddArgs', () => {
  it('overwrites the Production value, as Sensitive for a secret', () => {
    expect(envAddArgs('DB_URL', 'secret')).toEqual([
      'env',
      'add',
      'DB_URL',
      '--environment',
      'production',
      '--force',
      '--yes',
      '--sensitive',
    ]);
  });

  it('stores a variable as a plain value', () => {
    expect(envAddArgs('BUCKET', 'variable').at(-1)).toBe('--no-sensitive');
  });
});

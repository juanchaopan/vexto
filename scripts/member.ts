// Adds, revokes and lists the members of a target's database (.docs/design/rules.md).
// Usage: node scripts/member.ts add|revoke <email> --target <target>
//        node scripts/member.ts list --target <target>
// Reads NEON_CLI_VERSION, the Neon CLI version pinned in Taskfile.yml, from its environment. The
// targets and their Neon projects, branches and databases are in scripts/neon-targets.json; the
// Neon CLI must be logged in to the Neon organization that owns them.
//
// The connection string is the Neon CLI's standard output and stays in this process: it is not
// shown, written to a file, put in an environment variable or passed to another command. Errors
// are described by their kind only, since a driver message can hold parts of it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import {
  describeMemberError,
  memberUsage,
  parseMemberArgs,
  runMemberCommand,
  type MemberCommand,
  type MemberDatabase,
  type MemberSession,
} from './lib/members.ts';
import {
  connectionStringArgs,
  neonTarget,
  parseNeonTargets,
  readConnectionString,
} from './lib/neon-targets.ts';
import { pnpmSecretOutput, repoRoot } from './lib/node-tools.ts';

const configFile = path.join(repoRoot, 'scripts', 'neon-targets.json');

function sessionOf(connection: postgres.ISql): MemberSession {
  return {
    query: async ({ text, params }) => [...(await connection.unsafe(text, [...params]))],
  };
}

function memberDatabase(sql: postgres.Sql): MemberDatabase {
  return {
    ...sessionOf(sql),
    transaction: <T>(work: (session: MemberSession) => Promise<T>) =>
      sql.begin((transaction) => work(sessionOf(transaction))) as Promise<T>,
  };
}

let command: MemberCommand;
try {
  command = parseMemberArgs(process.argv.slice(2));
} catch (error) {
  console.error(describeMemberError(error));
  console.error(memberUsage);
  process.exit(1);
}

let cliArgs: string[];
try {
  const target = neonTarget(parseNeonTargets(readFileSync(configFile, 'utf8')), command.target);
  cliArgs = connectionStringArgs(process.env.NEON_CLI_VERSION, target);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`Getting the connection string of ${command.target} from the Neon CLI.`);
let connectionString: string;
try {
  connectionString = readConnectionString(await pnpmSecretOutput(cliArgs));
} catch {
  console.error(
    `The Neon CLI gave no connection string for ${command.target}. Check that it is logged in ` +
      `(pnpm dlx neonctl@${process.env.NEON_CLI_VERSION} auth) and that ` +
      'scripts/neon-targets.json names the right project, branch and database.',
  );
  process.exit(1);
}

const sql = postgres(connectionString, {
  max: 1,
  onnotice: () => {},
  connection: { application_name: 'vexto-member' },
});

try {
  const report = await runMemberCommand(memberDatabase(sql), command);
  for (const line of report.lines) {
    console.log(line);
  }
  process.exitCode = report.exitCode;
} catch (error) {
  console.error(describeMemberError(error));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => undefined);
}

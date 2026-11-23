// The member list of a target's database, managed by `task member` (.docs/design/rules.md): the
// command line, and the SQL that adds, revokes and lists rows of the members table
// (.docs/design/data.md). The statements run through the small database interface below, so they
// can be tested without a database; scripts/member.ts connects it to postgres.js.
import { z } from 'zod';

export const memberUsage = [
  'Usage: task member -- add <email> --target <target>',
  '       task member -- revoke <email> --target <target>',
  '       task member -- list --target <target>',
].join('\n');

type EmailCommand = { action: 'add' | 'revoke'; email: string; target: string };
type ListCommand = { action: 'list'; target: string };

export type MemberCommand = EmailCommand | ListCommand;

/** A failure whose message is safe to show: it holds no connection string or other secret. */
export class MemberCommandError extends Error {}

const emailSchema = z.email();

/**
 * The email as the members table stores it: trimmed and lower-case. Stored emails are lower-case
 * (a CHECK on the column) and every email reaches the statements through this function, so
 * comparing with `=` does not depend on how the email was typed.
 */
export function normalizeEmail(text: string) {
  const email = text.trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) {
    throw new MemberCommandError(`${JSON.stringify(text)} is not an email address.`);
  }
  return email;
}

function targetOption(args: readonly string[], index: number) {
  const arg = args[index];
  if (arg.startsWith('--target=')) {
    return { value: arg.slice('--target='.length), used: 1 };
  }
  const value = args[index + 1];
  return { value: value === undefined || value.startsWith('-') ? '' : value, used: 2 };
}

function splitArgs(args: readonly string[]) {
  const positionals: string[] = [];
  let target: string | undefined;
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (arg === '--target' || arg.startsWith('--target=')) {
      if (target !== undefined) {
        throw new MemberCommandError('Give --target only once.');
      }
      const option = targetOption(args, index);
      if (!option.value) {
        throw new MemberCommandError('--target needs the name of a target.');
      }
      target = option.value;
      index += option.used;
    } else if (arg.startsWith('-')) {
      throw new MemberCommandError(`Unknown option ${JSON.stringify(arg)}.`);
    } else {
      positionals.push(arg);
      index += 1;
    }
  }
  return { positionals, target };
}

/** Reads `add|revoke <email> --target <target>` or `list --target <target>`. */
export function parseMemberArgs(args: readonly string[]): MemberCommand {
  const { positionals, target } = splitArgs(args);
  const [action, email, ...rest] = positionals;
  if (action !== 'add' && action !== 'revoke' && action !== 'list') {
    throw new MemberCommandError('The action must be add, revoke or list.');
  }
  if (target === undefined) {
    throw new MemberCommandError('Name the target database with --target <target>.');
  }
  if (action === 'list') {
    if (email !== undefined) {
      throw new MemberCommandError('list takes no email.');
    }
    return { action, target };
  }
  if (email === undefined || rest.length > 0) {
    throw new MemberCommandError(`${action} takes exactly one email.`);
  }
  return { action, email: normalizeEmail(email), target };
}

/** A parameterized SQL statement; values are never written into the text. */
export type Statement = { text: string; params: readonly string[] };

export type DatabaseRow = Readonly<Record<string, unknown>>;

export type MemberSession = {
  query(statement: Statement): Promise<readonly DatabaseRow[]>;
};

export type MemberDatabase = MemberSession & {
  /** Runs `work` in one transaction, committed when it resolves and rolled back when it rejects. */
  transaction<T>(work: (session: MemberSession) => Promise<T>): Promise<T>;
};

export const memberStatements = {
  lockByEmail: (email: string): Statement => ({
    text: 'SELECT id, status FROM members WHERE email = $1 FOR UPDATE',
    params: [email],
  }),
  insert: (email: string): Statement => ({
    text: "INSERT INTO members (id, email, status, created_at) VALUES (gen_random_uuid(), $1, 'active', now())",
    params: [email],
  }),
  reactivate: (memberId: string): Statement => ({
    text: "UPDATE members SET status = 'active' WHERE id = $1",
    params: [memberId],
  }),
  revoke: (memberId: string): Statement => ({
    text: "UPDATE members SET status = 'revoked', clerk_user_id = NULL, terms_version = NULL, terms_accepted_at = NULL WHERE id = $1",
    params: [memberId],
  }),
  list: (): Statement => ({
    text: 'SELECT email, status, clerk_user_id IS NOT NULL AS bound, terms_version FROM members ORDER BY created_at, email',
    params: [],
  }),
};

/**
 * What revoking removes from the tables that hold a member's personal data, one statement per
 * table, run in the revoke transaction before the member row is updated
 * (.docs/design/rules.md, 取消资格, and data.md, 什么删掉什么). Deleting the vocabulary cards
 * deletes their examples, Translate options and review progress with them, and deleting the
 * lookups deletes their examples; review progress is also deleted by its owner, so none can be
 * left behind. Visits and operation receipts are deleted, and usage records stay without an owner.
 */
const memberDataRemovals: readonly ((memberId: string) => Statement)[] = [
  (memberId) => ({ text: 'DELETE FROM vocabulary_cards WHERE owner_id = $1', params: [memberId] }),
  (memberId) => ({ text: 'DELETE FROM review_progress WHERE owner_id = $1', params: [memberId] }),
  (memberId) => ({ text: 'DELETE FROM lookup_entries WHERE owner_id = $1', params: [memberId] }),
  (memberId) => ({ text: 'DELETE FROM visits WHERE owner_id = $1', params: [memberId] }),
  (memberId) => ({
    text: 'DELETE FROM operation_receipts WHERE owner_id = $1',
    params: [memberId],
  }),
  (memberId) => ({
    text: 'UPDATE usage_records SET owner_id = NULL WHERE owner_id = $1',
    params: [memberId],
  }),
];

/** The statements that remove a revoked member's personal data, in the order they run. */
export function revokedMemberDataStatements(memberId: string): Statement[] {
  return memberDataRemovals.map((removal) => removal(memberId));
}

async function deleteRevokedMemberData(session: MemberSession, memberId: string) {
  for (const statement of revokedMemberDataStatements(memberId)) {
    await session.query(statement);
  }
}

const memberStatus = z.enum(['active', 'revoked']);
const lockedRowSchema = z.object({ id: z.string(), status: memberStatus });
const listedRowSchema = z.object({
  email: z.string(),
  status: memberStatus,
  bound: z.boolean(),
  terms_version: z.number().int().nullable(),
});

export type ListedMember = z.infer<typeof listedRowSchema>;

function parseRows<T>(schema: z.ZodType<T>, rows: readonly DatabaseRow[]) {
  const result = z.array(schema).safeParse(rows);
  if (!result.success) {
    throw new MemberCommandError(
      'The members table does not have the columns and values this command expects.',
    );
  }
  return result.data;
}

async function lockedMember(session: MemberSession, email: string) {
  const rows = await session.query(memberStatements.lockByEmail(email));
  return parseRows(lockedRowSchema, rows)[0];
}

export type AddOutcome = 'added' | 'reactivated' | 'already-active';

/** Adds the email as an active member, sets a revoked member active again, or leaves it. */
export function addMember(database: MemberDatabase, email: string): Promise<AddOutcome> {
  return database.transaction(async (session) => {
    const member = await lockedMember(session, email);
    if (!member) {
      await session.query(memberStatements.insert(email));
      return 'added';
    }
    if (member.status === 'active') {
      return 'already-active';
    }
    await session.query(memberStatements.reactivate(member.id));
    return 'reactivated';
  });
}

export type RevokeOutcome = 'revoked' | 'already-revoked' | 'not-found';

/**
 * Revokes the member: removes their personal data, clears the Clerk user and the terms
 * acceptance, and sets the status to revoked. A revoked member is revoked again, so a run that
 * stopped half-way can be repeated.
 */
export function revokeMember(database: MemberDatabase, email: string): Promise<RevokeOutcome> {
  return database.transaction(async (session) => {
    const member = await lockedMember(session, email);
    if (!member) {
      return 'not-found';
    }
    await deleteRevokedMemberData(session, member.id);
    await session.query(memberStatements.revoke(member.id));
    return member.status === 'revoked' ? 'already-revoked' : 'revoked';
  });
}

/** Every member, in the order they joined. */
export async function listMembers(database: MemberDatabase) {
  return parseRows(listedRowSchema, await database.query(memberStatements.list()));
}

/** The member list as an aligned table, or a line saying the list is empty. */
export function formatMemberList(members: readonly ListedMember[], target: string) {
  if (members.length === 0) {
    return [`No members in ${target}.`];
  }
  const rows = [
    ['EMAIL', 'STATUS', 'CLERK USER', 'TERMS'],
    ...members.map((member) => [
      member.email,
      member.status,
      member.bound ? 'bound' : '-',
      member.terms_version === null ? '-' : String(member.terms_version),
    ]),
  ];
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd(),
  );
}

export type MemberReport = { lines: string[]; exitCode: number };

const addMessages: Record<AddOutcome, (email: string, target: string) => string> = {
  added: (email, target) => `Added ${email} to ${target} as an active member.`,
  reactivated: (email, target) =>
    `${email} was revoked in ${target} and is active again; they sign in and accept the terms anew.`,
  'already-active': (email, target) =>
    `${email} is already an active member of ${target}; nothing changed.`,
};

const revokeMessages: Record<RevokeOutcome, (email: string, target: string) => string> = {
  revoked: (email, target) => `Revoked ${email} in ${target} and removed their personal data.`,
  'already-revoked': (email, target) =>
    `${email} was already revoked in ${target}; the revocation ran again.`,
  'not-found': (email, target) => `${email} is not in the member list of ${target}.`,
};

/** Runs the command against the database and says what happened. */
export async function runMemberCommand(
  database: MemberDatabase,
  command: MemberCommand,
): Promise<MemberReport> {
  if (command.action === 'list') {
    return { lines: formatMemberList(await listMembers(database), command.target), exitCode: 0 };
  }
  if (command.action === 'add') {
    const outcome = await addMember(database, command.email);
    return { lines: [addMessages[outcome](command.email, command.target)], exitCode: 0 };
  }
  const outcome = await revokeMember(database, command.email);
  return {
    lines: [revokeMessages[outcome](command.email, command.target)],
    exitCode: outcome === 'not-found' ? 1 : 0,
  };
}

function errorField(error: unknown, field: 'name' | 'code') {
  if (typeof error !== 'object' || error === null || !(field in error)) {
    return '';
  }
  const value: unknown = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

const sqlState = /^[0-9A-Z]{5}$/;
const driverCode = /^[A-Z][A-Z0-9_]+$/;

/**
 * A message for a failed command that never repeats the error's own text, since a driver message
 * can hold parts of the connection string. Errors the database server returned (postgres.js names
 * them PostgresError) are told apart by their SQLSTATE code; other driver errors, such as a
 * connection that could not be made, by the driver's error code.
 */
export function describeMemberError(error: unknown) {
  if (error instanceof MemberCommandError) {
    return error.message;
  }
  const code = errorField(error, 'code');
  if (errorField(error, 'name') === 'PostgresError' && sqlState.test(code)) {
    return code === '42P01'
      ? 'The members table does not exist in this database; run the migrations first.'
      : `The database rejected the command (SQLSTATE ${code}).`;
  }
  if (driverCode.test(code)) {
    return `The database could not be reached or used (${code}).`;
  }
  return 'The member command failed.';
}

import { describe, expect, it } from 'vitest';
import {
  addMember,
  describeMemberError,
  formatMemberList,
  listMembers,
  MemberCommandError,
  memberStatements,
  normalizeEmail,
  parseMemberArgs,
  revokedMemberDataStatements,
  revokeMember,
  runMemberCommand,
  type DatabaseRow,
  type ListedMember,
  type MemberDatabase,
  type Statement,
} from './members.ts';

type LoggedStatement = Statement & { inTransaction: boolean };

/** A database stand-in that records every statement and answers with `answer`. */
function fakeDatabase(answer: (statement: Statement) => DatabaseRow[] = () => []) {
  const log: LoggedStatement[] = [];
  const session = (inTransaction: boolean) => ({
    query: async (statement: Statement) => {
      log.push({ ...statement, inTransaction });
      return answer(statement);
    },
  });
  const database: MemberDatabase = {
    ...session(false),
    transaction: (work) => work(session(true)),
  };
  return { database, log };
}

/** Answers the lock query with one member row, and every other statement with no rows. */
function withMember(row: DatabaseRow | undefined) {
  return (statement: Statement) =>
    statement.text === memberStatements.lockByEmail('').text && row ? [row] : [];
}

const memberId = '0b6f2c1e-3d44-4c55-9e66-7f8899aabbcc';

describe('parseMemberArgs', () => {
  it('reads add and revoke with the target as a separate value or after =', () => {
    expect(parseMemberArgs(['add', 'ann@example.com', '--target', 'staging'])).toEqual({
      action: 'add',
      email: 'ann@example.com',
      target: 'staging',
    });
    expect(parseMemberArgs(['--target=production', 'revoke', 'ann@example.com'])).toEqual({
      action: 'revoke',
      email: 'ann@example.com',
      target: 'production',
    });
  });

  it('stores the email trimmed and in lower case', () => {
    expect(parseMemberArgs(['add', ' Ann.Lee@Example.COM ', '--target', 'staging'])).toMatchObject({
      email: 'ann.lee@example.com',
    });
  });

  it('reads list without an email', () => {
    expect(parseMemberArgs(['list', '--target', 'staging'])).toEqual({
      action: 'list',
      target: 'staging',
    });
  });

  it('requires a target', () => {
    expect(() => parseMemberArgs(['add', 'ann@example.com'])).toThrow(/--target <target>/);
    expect(() => parseMemberArgs(['list', '--target'])).toThrow(/needs the name/);
    expect(() => parseMemberArgs(['list', '--target', '--other'])).toThrow(/needs the name/);
    expect(() => parseMemberArgs(['list', '--target='])).toThrow(/needs the name/);
    expect(() => parseMemberArgs(['list', '--target', 'a', '--target', 'b'])).toThrow(/only once/);
  });

  it('rejects unknown actions, options and argument counts', () => {
    expect(() => parseMemberArgs([])).toThrow(/add, revoke or list/);
    expect(() => parseMemberArgs(['remove', 'a@example.com', '--target', 's'])).toThrow(
      /add, revoke or list/,
    );
    expect(() => parseMemberArgs(['add', '--target', 'staging'])).toThrow(/exactly one email/);
    expect(() =>
      parseMemberArgs(['add', 'a@example.com', 'b@example.com', '--target', 's']),
    ).toThrow(/exactly one email/);
    expect(() => parseMemberArgs(['list', 'a@example.com', '--target', 's'])).toThrow(/no email/);
    expect(() => parseMemberArgs(['list', '--target', 's', '--force'])).toThrow(/Unknown option/);
  });

  it('rejects text that is not an email address', () => {
    expect(() => parseMemberArgs(['add', 'ann', '--target', 'staging'])).toThrow(
      /not an email address/,
    );
    expect(() => normalizeEmail('ann@example')).toThrow(MemberCommandError);
  });
});

describe('memberStatements', () => {
  it('passes every value as a parameter, never in the SQL text', () => {
    const email = "o'brien@example.com";
    for (const statement of [
      memberStatements.lockByEmail(email),
      memberStatements.insert(email),
      memberStatements.reactivate(email),
      memberStatements.revoke(email),
    ]) {
      expect(statement.params).toEqual([email]);
      expect(statement.text).not.toContain(email);
      expect(statement.text).toContain('$1');
    }
  });

  it('locks the member row it is about to change', () => {
    expect(memberStatements.lockByEmail('a@example.com').text).toMatch(
      /WHERE email = \$1 FOR UPDATE$/,
    );
  });

  it('clears the Clerk user and the terms acceptance when revoking', () => {
    const { text } = memberStatements.revoke(memberId);
    expect(text).toContain("status = 'revoked'");
    expect(text).toContain('clerk_user_id = NULL');
    expect(text).toContain('terms_version = NULL');
    expect(text).toContain('terms_accepted_at = NULL');
  });

  it('lists in the order members joined', () => {
    expect(memberStatements.list().text).toMatch(/ORDER BY created_at, email$/);
  });
});

describe('addMember', () => {
  it('inserts an email that is not in the table', async () => {
    const { database, log } = fakeDatabase(withMember(undefined));
    await expect(addMember(database, 'ann@example.com')).resolves.toBe('added');
    expect(log).toEqual([
      { ...memberStatements.lockByEmail('ann@example.com'), inTransaction: true },
      { ...memberStatements.insert('ann@example.com'), inTransaction: true },
    ]);
  });

  it('sets a revoked member active again', async () => {
    const { database, log } = fakeDatabase(withMember({ id: memberId, status: 'revoked' }));
    await expect(addMember(database, 'ann@example.com')).resolves.toBe('reactivated');
    expect(log.at(-1)).toEqual({ ...memberStatements.reactivate(memberId), inTransaction: true });
  });

  it('changes nothing for an active member', async () => {
    const { database, log } = fakeDatabase(withMember({ id: memberId, status: 'active' }));
    await expect(addMember(database, 'ann@example.com')).resolves.toBe('already-active');
    expect(log.map((statement) => statement.text)).toEqual([memberStatements.lockByEmail('').text]);
  });

  it('fails with a safe message when the row has an unexpected shape', async () => {
    const { database } = fakeDatabase(withMember({ id: memberId, status: 'paused' }));
    await expect(addMember(database, 'ann@example.com')).rejects.toThrow(MemberCommandError);
  });
});

describe('revokeMember', () => {
  it('revokes an active member in one transaction', async () => {
    const { database, log } = fakeDatabase(withMember({ id: memberId, status: 'active' }));
    await expect(revokeMember(database, 'ann@example.com')).resolves.toBe('revoked');
    expect(log).toEqual([
      { ...memberStatements.lockByEmail('ann@example.com'), inTransaction: true },
      ...revokedMemberDataStatements(memberId).map((s) => ({ ...s, inTransaction: true })),
      { ...memberStatements.revoke(memberId), inTransaction: true },
    ]);
  });

  it('runs the revocation again for a revoked member', async () => {
    const { database, log } = fakeDatabase(withMember({ id: memberId, status: 'revoked' }));
    await expect(revokeMember(database, 'ann@example.com')).resolves.toBe('already-revoked');
    expect(log.at(-1)).toEqual({ ...memberStatements.revoke(memberId), inTransaction: true });
  });

  it('changes nothing for an email that is not in the table', async () => {
    const { database, log } = fakeDatabase(withMember(undefined));
    await expect(revokeMember(database, 'ann@example.com')).resolves.toBe('not-found');
    expect(log).toHaveLength(1);
  });
});

describe('revokedMemberDataStatements', () => {
  it('passes the member ID as a parameter of every statement', () => {
    for (const statement of revokedMemberDataStatements(memberId)) {
      expect(statement.params).toContain(memberId);
      expect(statement.text).not.toContain(memberId);
    }
  });
});

describe('listMembers and formatMemberList', () => {
  const rows: ListedMember[] = [
    { email: 'ann@example.com', status: 'active', bound: true, terms_version: 2 },
    { email: 'bo@example.com', status: 'revoked', bound: false, terms_version: null },
  ];

  it('reads the rows outside a transaction', async () => {
    const { database, log } = fakeDatabase(() => rows);
    await expect(listMembers(database)).resolves.toEqual(rows);
    expect(log).toEqual([{ ...memberStatements.list(), inTransaction: false }]);
  });

  it('prints an aligned table', () => {
    expect(formatMemberList(rows, 'staging')).toEqual([
      'EMAIL            STATUS   CLERK USER  TERMS',
      'ann@example.com  active   bound       2',
      'bo@example.com   revoked  -           -',
    ]);
  });

  it('says when the list is empty', () => {
    expect(formatMemberList([], 'staging')).toEqual(['No members in staging.']);
  });
});

describe('runMemberCommand', () => {
  it('reports each outcome and fails only for an unknown member', async () => {
    const add = await runMemberCommand(fakeDatabase(withMember(undefined)).database, {
      action: 'add',
      email: 'ann@example.com',
      target: 'staging',
    });
    expect(add).toEqual({
      lines: ['Added ann@example.com to staging as an active member.'],
      exitCode: 0,
    });

    const missing = await runMemberCommand(fakeDatabase(withMember(undefined)).database, {
      action: 'revoke',
      email: 'ann@example.com',
      target: 'staging',
    });
    expect(missing).toEqual({
      lines: ['ann@example.com is not in the member list of staging.'],
      exitCode: 1,
    });

    const list = await runMemberCommand(fakeDatabase().database, {
      action: 'list',
      target: 'staging',
    });
    expect(list).toEqual({ lines: ['No members in staging.'], exitCode: 0 });
  });
});

describe('describeMemberError', () => {
  const secretUrl = 'postgresql://owner:not-a-real-password@db.example.test/neondb';

  function databaseError(code: string) {
    return Object.assign(new Error(`failed for ${secretUrl}`), { name: 'PostgresError', code });
  }

  it('shows the message of the command’s own errors', () => {
    expect(describeMemberError(new MemberCommandError('list takes no email.'))).toBe(
      'list takes no email.',
    );
  });

  it('names a missing members table and other database errors by their code', () => {
    expect(describeMemberError(databaseError('42P01'))).toMatch(/run the migrations/);
    expect(describeMemberError(databaseError('23505'))).toBe(
      'The database rejected the command (SQLSTATE 23505).',
    );
  });

  it('names connection errors by the driver code', () => {
    const error = Object.assign(new Error(`write CONNECT_TIMEOUT ${secretUrl}`), {
      code: 'CONNECT_TIMEOUT',
    });
    expect(describeMemberError(error)).toBe(
      'The database could not be reached or used (CONNECT_TIMEOUT).',
    );
  });

  it('never repeats the text of an error', () => {
    for (const error of [new Error(secretUrl), databaseError('42P01'), secretUrl, undefined]) {
      expect(describeMemberError(error)).not.toContain('not-a-real-password');
    }
    expect(describeMemberError(new Error(secretUrl))).toBe('The member command failed.');
  });
});

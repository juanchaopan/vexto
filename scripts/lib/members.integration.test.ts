import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { memberDatabase } from './member-database.ts';
import { addMember, revokeMember } from './members.ts';

// Revoking a member against the throwaway database the integration setup migrated
// (.docs/design/data.md, 什么删掉什么): the member's personal data goes in one transaction,
// usage records stay without an owner, and another member's data stays as it was.

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 2, onnotice: () => {} });
const database = memberDatabase(sql);

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

async function insertArticle() {
  const id = randomUUID();
  await sql`
    INSERT INTO articles (id, feed_key, category_key, source_url, title, body_text, body_hash, state)
    VALUES (${id}, 'nasa-technology', 'technology', 'https://example.com/a', 'A title', 'A body.',
            ${randomUUID()}, 'preparing')`;
  return id;
}

/** Gives the member a visit, a lookup with an example, a saved card with everything a card has,
 *  a receipt and a usage record; returns the IDs to look for. */
async function seedPersonalData(memberId: string, articleId: string) {
  const lookupId = randomUUID();
  const cardId = randomUUID();
  const usageId = randomUUID();
  const options = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await sql`INSERT INTO visits (owner_id, article_id, last_opened_at) VALUES (${memberId}, ${articleId}, now())`;
  await sql`
    INSERT INTO lookup_entries (id, owner_id, context_text, context_hash, selection_start, selection_end,
                                selected_text, lemma, lemma_key, pos, meaning_zh, accepted_forms)
    VALUES (${lookupId}, ${memberId}, 'A body.', ${randomUUID()}, 2, 6, 'body', 'body', 'body',
            'noun', '身体', ARRAY['body'])`;
  await sql`
    INSERT INTO examples (lookup_entry_id, position, text, target_ranges, content_hash)
    VALUES (${lookupId}, 0, 'A body moves.', '[[2, 6]]'::jsonb, ${randomUUID()})`;
  await sql`
    INSERT INTO vocabulary_cards (id, owner_id, source_lookup_entry_id, lemma, lemma_key, pos, meaning_zh, accepted_forms)
    VALUES (${cardId}, ${memberId}, ${lookupId}, 'body', 'body', 'noun', '身体', ARRAY['body'])`;
  await sql`
    INSERT INTO vocabulary_examples (card_id, position, text, target_ranges, content_hash)
    VALUES (${cardId}, 0, 'A body moves.', '[[2, 6]]'::jsonb, ${randomUUID()})`;
  await sql`
    INSERT INTO translation_sets (card_id, options, correct_option_id)
    VALUES (${cardId}, ${sql.json(options.map((id, i) => ({ id, text: `选项${i}` })))}, ${options[0]})`;
  for (const mode of ['speak', 'spell', 'translate']) {
    await sql`INSERT INTO review_progress (owner_id, card_id, mode, round, due_at) VALUES (${memberId}, ${cardId}, ${mode}, 0, NULL)`;
  }
  await sql`
    INSERT INTO operation_receipts (owner_id, operation_id, kind, request_digest, response_status)
    VALUES (${memberId}, ${randomUUID()}, 'vocabulary.save', 'digest', 201)`;
  await sql`
    INSERT INTO usage_records (id, kind, provider, model, status, owner_id)
    VALUES (${usageId}, 'lookup', 'openai', 'test-model', 'succeeded', ${memberId})`;
  return { lookupId, cardId, usageId };
}

/** How many rows of the member's personal data each table still holds. */
async function personalRows(memberId: string, ids: { lookupId: string; cardId: string }) {
  const [counts] = await sql`
    SELECT
      (SELECT count(*)::int FROM visits WHERE owner_id = ${memberId}) AS visits,
      (SELECT count(*)::int FROM lookup_entries WHERE owner_id = ${memberId}) AS lookups,
      (SELECT count(*)::int FROM examples WHERE lookup_entry_id = ${ids.lookupId}) AS examples,
      (SELECT count(*)::int FROM vocabulary_cards WHERE owner_id = ${memberId}) AS cards,
      (SELECT count(*)::int FROM vocabulary_examples WHERE card_id = ${ids.cardId}) AS card_examples,
      (SELECT count(*)::int FROM translation_sets WHERE card_id = ${ids.cardId}) AS options,
      (SELECT count(*)::int FROM review_progress WHERE owner_id = ${memberId}) AS progress,
      (SELECT count(*)::int FROM operation_receipts WHERE owner_id = ${memberId}) AS receipts`;
  return counts;
}

async function addBoundMember(label: string) {
  const email = `${label}-${randomUUID()}@example.com`;
  await addMember(database, email);
  const [member] = await sql<{ id: string }[]>`
    UPDATE members SET clerk_user_id = ${`user_${randomUUID()}`}, terms_version = 1, terms_accepted_at = now()
    WHERE email = ${email} RETURNING id`;
  return { email, id: member.id };
}

describe('revokeMember', () => {
  it('removes the personal data, keeps usage without an owner and leaves others alone', async () => {
    const articleId = await insertArticle();
    const ann = await addBoundMember('ann');
    const bo = await addBoundMember('bo');
    const annData = await seedPersonalData(ann.id, articleId);
    const boData = await seedPersonalData(bo.id, articleId);

    await expect(revokeMember(database, ann.email)).resolves.toBe('revoked');

    expect(await personalRows(ann.id, annData)).toEqual({
      visits: 0,
      lookups: 0,
      examples: 0,
      cards: 0,
      card_examples: 0,
      options: 0,
      progress: 0,
      receipts: 0,
    });
    const [usage] = await sql`SELECT owner_id FROM usage_records WHERE id = ${annData.usageId}`;
    expect(usage).toEqual({ owner_id: null });
    const [row] = await sql`
      SELECT status, clerk_user_id, terms_version, terms_accepted_at FROM members WHERE id = ${ann.id}`;
    expect(row).toEqual({
      status: 'revoked',
      clerk_user_id: null,
      terms_version: null,
      terms_accepted_at: null,
    });

    expect(await personalRows(bo.id, boData)).toEqual({
      visits: 1,
      lookups: 1,
      examples: 1,
      cards: 1,
      card_examples: 1,
      options: 1,
      progress: 3,
      receipts: 1,
    });
    const [boUsage] = await sql`SELECT owner_id FROM usage_records WHERE id = ${boData.usageId}`;
    expect(boUsage).toEqual({ owner_id: bo.id });
  });

  it('runs again for a member who is already revoked', async () => {
    const ann = await addBoundMember('again');
    await revokeMember(database, ann.email);

    await expect(revokeMember(database, ann.email)).resolves.toBe('already-revoked');
  });

  it('lets a member added back start from nothing', async () => {
    const articleId = await insertArticle();
    const ann = await addBoundMember('back');
    await seedPersonalData(ann.id, articleId);
    await revokeMember(database, ann.email);

    await expect(addMember(database, ann.email)).resolves.toBe('reactivated');

    const [row] = await sql`
      SELECT status, clerk_user_id, terms_version FROM members WHERE id = ${ann.id}`;
    expect(row).toEqual({ status: 'active', clerk_user_id: null, terms_version: null });
    const [{ cards }] =
      await sql`SELECT count(*)::int AS cards FROM vocabulary_cards WHERE owner_id = ${ann.id}`;
    expect(cards).toBe(0);
  });
});

import { createHash, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { findTargetRanges } from '../../src/features/lookup/domain/explanation.ts';
import { lemmaKey } from '../../src/features/lookup/domain/lookup-entry.ts';
import demo from './demo-vocabulary.json' with { type: 'json' };
import { withDatabase } from './members.ts';

// Vocabulary cards of the end-to-end tests, written straight to the database of the application
// under test, with their examples, Translate options and progress, so a test reaches any review
// state without looking words up first. Due times count from a moment of the database's clock,
// which decides what is due: `dueInMinutes` is minutes from that moment, negative for the past.

export type ProgressSeed = { round: number; dueInMinutes: number | null };

export type ReviewCardSeed = {
  lemma: string;
  pos: string;
  meaningZh: string;
  examples: string[];
  /** The wrong meanings, in the order the options show them around the right one. */
  wrongMeanings: string[];
  /** Where the right meaning goes among the four options, counting from 0; second by default. */
  correctPosition?: number;
  acceptedForms?: string[];
  /** Progress by mode; a mode left out is a new word. */
  progress?: Partial<Record<'speak' | 'spell' | 'translate', ProgressSeed>>;
  /** Minutes before the moment due times count from that the card was saved. */
  savedMinutesAgo?: number;
};

/** The resilient card of the confirmed review screens (43–50 and 63). */
export const RESILIENT: ReviewCardSeed = {
  lemma: 'resilient',
  pos: 'adjective',
  meaningZh: '有适应力的；能迅速恢复的',
  examples: [
    'A resilient city can adapt to unexpected challenges.',
    'She remained resilient during a difficult first year abroad.',
  ],
  wrongMeanings: ['持久的；持续很久的', '准确的；精确的', '脆弱的；易受损的'],
};

/** A second card, a new word in every mode unless a test says otherwise. */
export const STICKY: ReviewCardSeed = {
  lemma: 'sticky',
  pos: 'adjective',
  meaningZh: '黏的；黏性的',
  examples: [
    'The jam left a sticky mark on the kitchen table.',
    'Warm, sticky air made the long walk feel even longer.',
  ],
  wrongMeanings: ['迅速消失的', '令人厌烦的', '非常昂贵的'],
};

/** The nine saved words of the demo account in the confirmed screens (30–50), in saving order. */
export const DEMO_WORDS: readonly ReviewCardSeed[] = demo.words;

/** Sixteen more words, none due or new, for screens whose list runs past one batch (68). */
export const MORE_DEMO_WORDS: readonly ReviewCardSeed[] = demo.moreWords;

const MODES = ['speak', 'spell', 'translate'] as const;

async function insertCard(sql: postgres.Sql, email: string, seed: ReviewCardSeed, from: Date) {
  const forms = seed.acceptedForms ?? [seed.lemma];
  const [card] = await sql<{ id: string }[]>`
    INSERT INTO vocabulary_cards
      (owner_id, lemma, lemma_key, pos, meaning_zh, accepted_forms, created_at, updated_at)
    SELECT id, ${seed.lemma}, ${lemmaKey(seed.lemma)}, ${seed.pos}, ${seed.meaningZh},
      ${forms}, ${from}::timestamptz - make_interval(mins => ${seed.savedMinutesAgo ?? 60}),
      date_trunc('milliseconds', now())
    FROM members WHERE email = ${email}
    RETURNING id`;
  for (const [position, text] of seed.examples.entries()) {
    await sql`
      INSERT INTO vocabulary_examples (card_id, position, text, target_ranges, content_hash)
      VALUES (${card.id}, ${position}, ${text}, ${sql.json(findTargetRanges(text, forms))},
        ${createHash('sha256').update(text).digest('hex')})`;
  }
  const meanings = [...seed.wrongMeanings];
  meanings.splice(seed.correctPosition ?? 1, 0, seed.meaningZh);
  const options = meanings.map((meaningZh) => ({ id: randomUUID(), pos: seed.pos, meaningZh }));
  const correct = options[seed.correctPosition ?? 1];
  await sql`
    INSERT INTO translation_sets (card_id, options, correct_option_id)
    VALUES (${card.id}, ${sql.json(options)}, ${correct.id})`;
  for (const mode of MODES) {
    const progress = seed.progress?.[mode];
    const minutes = progress?.dueInMinutes ?? null;
    await sql`
      INSERT INTO review_progress (owner_id, card_id, mode, round, due_at)
      SELECT owner_id, id, ${mode}, ${progress?.round ?? 0},
        CASE WHEN ${minutes}::double precision IS NULL THEN NULL
          ELSE ${from}::timestamptz + make_interval(secs => ${minutes}::double precision * 60) END
      FROM vocabulary_cards WHERE id = ${card.id}`;
  }
  return card.id;
}

async function databaseNow(sql: postgres.Sql): Promise<Date> {
  const [row] = await sql<{ now: Date }[]>`SELECT now() AS now`;
  return row.now;
}

/** Writes the card for the member with this address, due times counting from now, and returns its ID. */
export function seedReviewCard(email: string, seed: ReviewCardSeed): Promise<string> {
  return withDatabase(async (sql) => insertCard(sql, email, seed, await databaseNow(sql)));
}

/**
 * Replaces the vocabulary of the member with this address by `seeds`, saved in that order, with
 * due times counting from `leadMs` after the database's now; returns that moment. A page whose
 * clock shows it renders every due time as the design does, and the server agrees on what is due
 * for as long as no due time inside the lead has passed.
 */
export function seedVocabulary(
  email: string,
  seeds: readonly ReviewCardSeed[],
  leadMs = 60_000,
): Promise<Date> {
  return withDatabase(async (sql) => {
    const owner = sql`(SELECT id FROM members WHERE email = ${email})`;
    await sql`DELETE FROM review_progress WHERE owner_id IN ${owner}`;
    await sql`DELETE FROM vocabulary_cards WHERE owner_id IN ${owner}`;
    const from = new Date((await databaseNow(sql)).getTime() + leadMs);
    for (const [index, seed] of seeds.entries()) {
      await insertCard(sql, email, { savedMinutesAgo: seeds.length - index, ...seed }, from);
    }
    return from;
  });
}

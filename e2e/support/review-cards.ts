import { createHash, randomUUID } from 'node:crypto';
import { findTargetRanges } from '../../src/features/lookup/domain/explanation.ts';
import { lemmaKey } from '../../src/features/lookup/domain/lookup-entry.ts';
import { withDatabase } from './members.ts';

// Vocabulary cards of the end-to-end tests, written straight to the database of the application
// under test, with their examples, Translate options and progress, so a test reaches any review
// state without looking words up first. Due times count from the database's own time, which
// decides what is due: `dueInMinutes` is minutes from the database's now, negative for the past.

export type ProgressSeed = { round: number; dueInMinutes: number | null };

export type ReviewCardSeed = {
  lemma: string;
  pos: string;
  meaningZh: string;
  examples: string[];
  /** The wrong meanings; the right one is put second among the four options. */
  wrongMeanings: [string, string, string];
  acceptedForms?: string[];
  /** Progress by mode; a mode left out is a new word. */
  progress?: Partial<Record<'speak' | 'spell' | 'translate', ProgressSeed>>;
  /** Minutes before the database's now the card was saved; new words are asked oldest first. */
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

const MODES = ['speak', 'spell', 'translate'] as const;

/** Writes the card for the member with this address and returns its ID. */
export function seedReviewCard(email: string, seed: ReviewCardSeed): Promise<string> {
  const forms = seed.acceptedForms ?? [seed.lemma];
  return withDatabase(async (sql) => {
    const [card] = await sql<{ id: string }[]>`
      INSERT INTO vocabulary_cards
        (owner_id, lemma, lemma_key, pos, meaning_zh, accepted_forms, created_at, updated_at)
      SELECT id, ${seed.lemma}, ${lemmaKey(seed.lemma)}, ${seed.pos}, ${seed.meaningZh},
        ${forms}, now() - make_interval(mins => ${seed.savedMinutesAgo ?? 60}),
        date_trunc('milliseconds', now())
      FROM members WHERE email = ${email}
      RETURNING id`;
    for (const [position, text] of seed.examples.entries()) {
      await sql`
        INSERT INTO vocabulary_examples (card_id, position, text, target_ranges, content_hash)
        VALUES (${card.id}, ${position}, ${text}, ${sql.json(findTargetRanges(text, forms))},
          ${createHash('sha256').update(text).digest('hex')})`;
    }
    const [first, second, third] = seed.wrongMeanings;
    const options = [first, seed.meaningZh, second, third].map((meaningZh) => ({
      id: randomUUID(),
      pos: seed.pos,
      meaningZh,
    }));
    await sql`
      INSERT INTO translation_sets (card_id, options, correct_option_id)
      VALUES (${card.id}, ${sql.json(options)}, ${options[1].id})`;
    for (const mode of MODES) {
      const progress = seed.progress?.[mode];
      const minutes = progress?.dueInMinutes ?? null;
      await sql`
        INSERT INTO review_progress (owner_id, card_id, mode, round, due_at)
        SELECT owner_id, id, ${mode}, ${progress?.round ?? 0},
          CASE WHEN ${minutes}::int IS NULL THEN NULL
            ELSE now() + make_interval(mins => ${minutes}::int) END
        FROM vocabulary_cards WHERE id = ${card.id}`;
    }
    return card.id;
  });
}

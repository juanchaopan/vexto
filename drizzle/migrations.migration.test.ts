import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateTestDatabase, POSTGRES_IMAGE } from '../scripts/lib/test-services.ts';

// The migration scripts build the database of .docs/design/data.md from empty, as a deployment
// does. Every case runs in a transaction that is rolled back, so the cases do not see each
// other's rows.

let container: StartedPostgreSqlContainer;
let sql: postgres.Sql;

beforeAll(async () => {
  container = await new PostgreSqlContainer(POSTGRES_IMAGE).withDatabase('vexto').start();
  await migrateTestDatabase(container.getConnectionUri());
  sql = postgres(container.getConnectionUri(), { max: 2, onnotice: () => {} });
}, 180_000);

afterAll(async () => {
  await sql?.end();
  await container?.stop();
});

class Rollback extends Error {}

/** Runs the case in a transaction that is always rolled back. */
async function inRolledBack(work: (tx: postgres.TransactionSql) => Promise<void>) {
  await sql
    .begin(async (tx) => {
      await work(tx);
      throw new Rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) {
        throw error;
      }
    });
}

/** Expects the statement to fail on the named constraint; a savepoint keeps the case going. */
async function expectViolation(tx: postgres.TransactionSql, constraint: string, statement: string) {
  await expect(tx.savepoint((sp) => sp.unsafe(statement))).rejects.toMatchObject({
    constraint_name: constraint,
  });
}

async function names(query: postgres.PendingQuery<{ name: string }[]>) {
  return (await query).map((row) => row.name).sort();
}

const tables = [
  'article_sentences',
  'articles',
  'audio_assets',
  'examples',
  'feed_cursors',
  'job_leases',
  'lookup_entries',
  'members',
  'operation_receipts',
  'review_progress',
  'seen_items',
  'synthesis_cpu_months',
  'translation_sets',
  'usage_records',
  'visits',
  'vocabulary_cards',
  'vocabulary_examples',
];

describe('the first migration scripts', () => {
  it('create exactly the tables of the data design', async () => {
    const created = await names(
      sql`select table_name as name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );

    expect(created).toEqual(tables);
  });

  it('run again without changing anything', async () => {
    await migrateTestDatabase(container.getConnectionUri());

    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count from drizzle.__drizzle_migrations`;
    expect(count).toBe(2);
  });

  it('create the keys, foreign keys and checks', async () => {
    const constraints = await names(
      sql`select conname as name from pg_constraint
          where connamespace = 'public'::regnamespace and contype in ('p', 'u', 'f', 'c')`,
    );

    expect(constraints).toEqual(
      expect.arrayContaining([
        'members_pkey',
        'members_email_key',
        'members_clerk_user_id_key',
        'members_email_lower_check',
        'articles_body_hash_key',
        'articles_ready_check',
        'article_sentences_pkey',
        'visits_pkey',
        'lookup_entries_owner_id_context_hash_selection_key',
        'examples_lookup_entry_id_position_key',
        'examples_lookup_entry_id_content_hash_key',
        'vocabulary_examples_card_id_position_key',
        'vocabulary_examples_card_id_content_hash_key',
        'translation_sets_pkey',
        'review_progress_pkey',
        'audio_assets_object_key_key',
        'operation_receipts_pkey',
        'operation_receipts_owner_id_members_id_fk',
        'usage_records_owner_id_members_id_fk',
        'synthesis_cpu_months_month_check',
      ]),
    );
  });

  it('create the indexes the lists, searches and the collection job use', async () => {
    const indexes = await names(
      sql`select indexname as name from pg_indexes where schemaname = 'public'`,
    );

    expect(indexes).toEqual(
      expect.arrayContaining([
        'articles_state_collected_at_id_idx',
        'articles_state_title_id_idx',
        'articles_state_feed_key_id_idx',
        'articles_state_category_key_id_idx',
        'articles_body_fts_idx',
        'articles_state_retry_at_idx',
        'visits_owner_id_last_opened_at_article_id_idx',
        'seen_items_first_seen_at_idx',
        'vocabulary_cards_owner_id_lemma_key_pos_idx',
        'vocabulary_cards_owner_id_lemma_key_id_idx',
        'vocabulary_cards_owner_id_created_at_id_idx',
        'vocabulary_cards_source_lookup_entry_id_idx',
        'vocabulary_examples_text_fts_idx',
        'review_progress_owner_id_mode_due_at_card_id_idx',
        'review_progress_owner_id_mode_round_card_id_idx',
        'audio_assets_cache_key_idx',
        'audio_assets_state_created_at_id_idx',
        'operation_receipts_created_at_idx',
      ]),
    );
    const [{ definition }] = await sql<{ definition: string }[]>`
      select indexdef as definition from pg_indexes where indexname = 'audio_assets_cache_key_idx'`;
    expect(definition).toMatch(/^CREATE UNIQUE INDEX .* WHERE \(state <> 'retiring'::text\)$/);
  });

  it('insert the collection lease, already expired', async () => {
    const leases = await sql`select name, holder, expires_at::text as expires from job_leases`;

    expect(leases).toEqual([{ name: 'collect', holder: null, expires: '-infinity' }]);
  });
});

describe('the constraints', () => {
  it('keep member emails lower-case and statuses known', async () => {
    await inRolledBack(async (tx) => {
      await expectViolation(
        tx,
        'members_email_lower_check',
        `insert into members (email, status) values ('Ada@Example.com', 'active')`,
      );
      await expectViolation(
        tx,
        'members_status_check',
        `insert into members (email, status) values ('ada@example.com', 'paused')`,
      );
    });
  });

  it('let audio rows share a cache key only with retiring rows', async () => {
    await inRolledBack(async (tx) => {
      const audio = (objectKey: string, state: string) =>
        `insert into audio_assets (cache_key, object_key, state, voice, model_revision, encoding)
         values ('key-1', '${objectKey}', '${state}', 'F1', 'rev', 'mp3-mono-32k-v1')`;
      await tx.unsafe(audio('speech/a.mp3', 'retiring'));
      await tx.unsafe(audio('speech/b.mp3', 'pending'));
      await expectViolation(tx, 'audio_assets_cache_key_idx', audio('speech/c.mp3', 'pending'));
      await expectViolation(tx, 'audio_assets_object_key_key', audio('speech/a.mp3', 'retiring'));
      await expectViolation(tx, 'audio_assets_ready_check', audio('speech/d.mp3', 'ready'));
    });
  });

  it('keep articles consistent and searchable, and delete their sentences and visits', async () => {
    await inRolledBack(async (tx) => {
      const [{ id: memberId }] = await tx`
        insert into members (email, status) values ('ada@example.com', 'active') returning id`;
      const article = (hash: string, state: string, extra = '') =>
        `insert into articles (feed_key, category_key, source_url, title, body_text, body_hash, state${extra ? ', attempts' : ''})
         values ('nasa-technology', 'technology', 'https://example.com/a', 'Satellites',
                 'Engineers launched new satellites.', '${hash}', '${state}'${extra})`;
      await expectViolation(tx, 'articles_ready_check', article('h1', 'ready'));
      await expectViolation(tx, 'articles_attempts_check', article('h2', 'preparing', ', 6'));
      await expectViolation(tx, 'articles_state_check', article('h3', 'draft'));
      const [{ id: articleId }] = await tx.unsafe(`${article('h4', 'preparing')} returning id`);
      await expectViolation(tx, 'articles_body_hash_key', article('h4', 'preparing'));

      const [found] = await tx`
        select id from articles where body_fts @@ plainto_tsquery('english', 'satellite')`;
      expect(found.id).toBe(articleId);

      await tx`insert into article_sentences
        (article_id, sentence_index, paragraph_index, text, body_start, body_end)
        values (${articleId}, 0, 0, 'Engineers launched new satellites.', 0, 34)`;
      await tx`insert into visits (owner_id, article_id, last_opened_at)
        values (${memberId}, ${articleId}, now())`;
      await tx`delete from articles where id = ${articleId}`;
      const [{ left }] = await tx`select
        (select count(*) from article_sentences)::int + (select count(*) from visits)::int as left`;
      expect(left).toBe(0);
    });
  });

  it('check lookups, cards, examples, options and progress, and delete what a card owns', async () => {
    await inRolledBack(async (tx) => {
      const [{ id: memberId }] = await tx`
        insert into members (email, status) values ('ada@example.com', 'active') returning id`;
      const lookup = (meaning: string, forms: string) =>
        `insert into lookup_entries (owner_id, context_text, context_hash, selection_start,
           selection_end, selected_text, lemma, lemma_key, pos, meaning_zh, accepted_forms)
         values ('${memberId}', 'It was resilient.', 'ctx', 7, 16, 'resilient', 'resilient',
                 'resilient', 'adjective', '${meaning}', ${forms})`;
      await expectViolation(
        tx,
        'lookup_entries_meaning_zh_check',
        lookup('有'.repeat(31), `'{resilient}'`),
      );
      await expectViolation(tx, 'lookup_entries_accepted_forms_check', lookup('有韧性的', `'{}'`));
      const [{ id: lookupId }] = await tx.unsafe(
        `${lookup('有'.repeat(30), `'{resilient}'`)} returning id`,
      );

      await expectViolation(
        tx,
        'examples_target_ranges_check',
        `insert into examples (lookup_entry_id, position, text, target_ranges, content_hash)
         values ('${lookupId}', 0, 'She is resilient.', '[]', 'e0')`,
      );

      const [{ id: cardId }] = await tx`
        insert into vocabulary_cards (owner_id, source_lookup_entry_id, lemma, lemma_key, pos,
          meaning_zh, accepted_forms)
        values (${memberId}, ${lookupId}, 'resilient', 'resilient', 'adjective', '有韧性的',
                ${['resilient']}) returning id`;
      await tx`insert into vocabulary_examples (card_id, position, text, target_ranges, content_hash)
        values (${cardId}, 0, 'Cities are becoming more resilient.', ${tx.json([[25, 34]])}, 'v0')`;
      const [match] = await tx`select card_id from vocabulary_examples
        where text_fts @@ plainto_tsquery('english', 'becomes')`;
      expect(match.card_id).toBe(cardId);

      const options = (correct: string, count: number) =>
        JSON.stringify(
          Array.from({ length: count }, (_, i) => ({
            id: i === 0 ? correct : crypto.randomUUID(),
            pos: 'adjective',
            meaningZh: `选项${i}`,
          })),
        );
      const correctId = crypto.randomUUID();
      const translation = (json: string, correct: string) =>
        `insert into translation_sets (card_id, options, correct_option_id)
         values ('${cardId}', '${json}', '${correct}')`;
      await expectViolation(
        tx,
        'translation_sets_options_check',
        translation(options(correctId, 3), correctId),
      );
      await expectViolation(
        tx,
        'translation_sets_correct_option_check',
        translation(options(correctId, 4), crypto.randomUUID()),
      );
      await tx.unsafe(translation(options(correctId, 4), correctId));

      const progress = (mode: string, round: number, due: string) =>
        `insert into review_progress (owner_id, card_id, mode, round, due_at)
         values ('${memberId}', '${cardId}', '${mode}', ${round}, ${due})`;
      await expectViolation(tx, 'review_progress_due_at_check', progress('spell', 3, 'null'));
      await expectViolation(tx, 'review_progress_round_check', progress('spell', 8, 'now()'));
      await tx.unsafe(progress('speak', 0, 'null'));
      await tx.unsafe(progress('spell', 7, 'null'));
      await tx.unsafe(progress('translate', 2, 'now()'));

      await tx`delete from lookup_entries where id = ${lookupId}`;
      const [card] = await tx`select source_lookup_entry_id from vocabulary_cards`;
      expect(card.source_lookup_entry_id).toBeNull();

      await tx`delete from vocabulary_cards where id = ${cardId}`;
      const [{ left }] = await tx`select
        (select count(*) from vocabulary_examples)::int + (select count(*) from translation_sets)::int
        + (select count(*) from review_progress)::int as left`;
      expect(left).toBe(0);
    });
  });

  it('keep the collection state, receipts and usage records in range', async () => {
    await inRolledBack(async (tx) => {
      await expectViolation(
        tx,
        'synthesis_cpu_months_month_check',
        `insert into synthesis_cpu_months (month) values ('2026-11-02')`,
      );
      await tx`insert into synthesis_cpu_months (month) values ('2026-11-01')`;
      await tx`insert into synthesis_cpu_months (month, synthesis_seconds) values ('2026-11-01', 12.34)
        on conflict (month) do update
        set synthesis_seconds = synthesis_cpu_months.synthesis_seconds + excluded.synthesis_seconds`;
      const [{ seconds }] = await tx`
        select synthesis_seconds::text as seconds from synthesis_cpu_months`;
      expect(seconds).toBe('12.3');

      await expectViolation(
        tx,
        'feed_cursors_failed_attempts_check',
        `insert into feed_cursors (feed_key, last_occurrence_at, failed_attempts)
         values ('nasa-technology', now(), 6)`,
      );
      await expectViolation(
        tx,
        'operation_receipts_owner_id_members_id_fk',
        `insert into operation_receipts (owner_id, operation_id, kind, request_digest, response_status)
         values (gen_random_uuid(), gen_random_uuid(), 'review.submit', 'd', 200)`,
      );
      await expectViolation(
        tx,
        'usage_records_kind_check',
        `insert into usage_records (kind, provider, model, status)
         values ('speak', 'openai', 'model', 'pending')`,
      );
    });
  });
});

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { AUDIO_CONTENT_TYPE } from '../../src/features/audio/domain/audio-asset.ts';
import { fakeMp3 } from '../../src/features/speech/testing.ts';
import { sharedConfig } from '../../src/lib/config/shared-config.ts';
import { s3ClientFor, storageSettingsFromEnv } from '../../src/lib/storage/object-storage.ts';
import demo from './demo-articles.json' with { type: 'json' };
import { withDatabase } from './members.ts';

// The fixed articles of the end-to-end tests: the 23 articles of the confirmed prototype
// (.docs/design/screens), with their sources, titles, collection times and the bodies the
// prototype has. Every article is ready with ready audio: a silent MP3 in the test bucket whose
// length gives each sentence 400 ms a word, as the prototype counts listening time. The rows
// have fixed IDs and are written only when missing, so every test file can seed them, side by
// side, and they never change while the tests run. The visits are the demo account's; a test
// gives them to its own member.

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const MS_PER_WORD = 400;
const SENTENCE_GAP_MS = 300;
const SAMPLE_RATE = 44_100;

const serial = (index: number) => String(index + 1).padStart(12, '0');

export const DEMO_ARTICLES = demo.map((article, index) => ({
  ...article,
  id: `e2e00000-0000-4000-8000-${serial(index)}`,
  audioId: `e2e00000-0000-4000-9000-${serial(index)}`,
}));

export type DemoArticle = (typeof DEMO_ARTICLES)[number];

function categoryOf(feedKey: string) {
  const feed = sharedConfig.feeds.find((one) => one.key === feedKey);
  if (!feed) {
    throw new Error(`The demo article's feed ${feedKey} is not in config/shared.json.`);
  }
  return feed.category;
}

/** The body as the collection writes it, and each sentence with its place and timeline. */
function sentencesOf(article: DemoArticle) {
  let body = '';
  let at = 0;
  const sentences = article.paragraphs.flatMap((paragraph, paragraphIndex) =>
    paragraph.map((text, index) => {
      if (body !== '') {
        body += index === 0 ? '\n\n' : ' ';
      }
      const bodyStart = body.length;
      body += text;
      const slot = (text.match(WORD)?.length ?? 1) * MS_PER_WORD;
      const timing = { startMs: at, endMs: at + Math.max(100, slot - SENTENCE_GAP_MS) };
      at += slot;
      return { paragraphIndex, text, bodyStart, bodyEnd: body.length, ...timing };
    }),
  );
  return { body, sentences, durationMs: at };
}

const objectKey = (article: DemoArticle) => `articles/${article.audioId}.mp3`;

async function uploadAudio(article: DemoArticle, durationMs: number) {
  const settings = storageSettingsFromEnv();
  await s3ClientFor(settings).send(
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: objectKey(article),
      Body: fakeMp3(Math.ceil((durationMs / 1000) * SAMPLE_RATE), 'AI-generated voice (test)'),
      ContentType: AUDIO_CONTENT_TYPE,
    }),
  );
}

let seeded: Promise<void> | undefined;

/** Writes the demo articles and their audio once per test worker; rows that exist stay. */
export function seedDemoArticles(): Promise<void> {
  seeded ??= withDatabase(async (sql) => {
    for (const article of DEMO_ARTICLES) {
      const { body, sentences, durationMs } = sentencesOf(article);
      await uploadAudio(article, durationMs);
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO audio_assets
            (id, cache_key, object_key, state, byte_size, duration_ms, voice, model_revision, encoding)
          VALUES (${article.audioId}, ${`e2e-${article.audioId}`}, ${objectKey(article)}, 'ready',
            ${Math.ceil(durationMs * 4)}, ${durationMs}, 'F1', 'e2e', 'mp3-mono-32k-e2e')
          ON CONFLICT DO NOTHING`;
        await tx`
          INSERT INTO articles
            (id, feed_key, category_key, source_url, title, author, body_text, body_hash, state,
             audio_asset_id, collected_at)
          VALUES (${article.id}, ${article.feed}, ${categoryOf(article.feed)},
            ${`https://example.org/articles/${article.id}`}, ${article.title}, ${article.author},
            ${body}, ${`e2e-${article.id}`}, 'ready', ${article.audioId}, ${article.collected})
          ON CONFLICT DO NOTHING`;
        for (const [index, sentence] of sentences.entries()) {
          await tx`
            INSERT INTO article_sentences
              (article_id, sentence_index, paragraph_index, text, body_start, body_end, start_ms,
               end_ms)
            VALUES (${article.id}, ${index}, ${sentence.paragraphIndex}, ${sentence.text},
              ${sentence.bodyStart}, ${sentence.bodyEnd}, ${sentence.startMs}, ${sentence.endMs})
            ON CONFLICT DO NOTHING`;
        }
      });
    }
  });
  return seeded;
}

/** Gives the member with this address the demo account's visits. */
export function seedDemoVisits(email: string): Promise<void> {
  return withDatabase(async (sql) => {
    for (const article of DEMO_ARTICLES.filter((one) => one.visited)) {
      await sql`
        INSERT INTO visits (owner_id, article_id, last_opened_at)
        SELECT id, ${article.id}, ${article.visited} FROM members WHERE email = ${email}
        ON CONFLICT (owner_id, article_id) DO UPDATE SET last_opened_at = excluded.last_opened_at`;
    }
  });
}

/** Words and minutes of listening as the reader's head shows them. */
export function lengthText(article: DemoArticle): string {
  const { sentences, durationMs } = sentencesOf(article);
  const words = sentences.reduce((total, one) => total + (one.text.match(WORD)?.length ?? 0), 0);
  return `${words} words · ${Math.max(1, Math.ceil(durationMs / 60_000))} min listening`;
}

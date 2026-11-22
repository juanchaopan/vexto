CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"clerk_user_id" text,
	"status" text NOT NULL,
	"terms_version" integer,
	"terms_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_email_key" UNIQUE("email"),
	CONSTRAINT "members_clerk_user_id_key" UNIQUE("clerk_user_id"),
	CONSTRAINT "members_email_lower_check" CHECK ("members"."email" = lower("members"."email")),
	CONSTRAINT "members_status_check" CHECK ("members"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "article_sentences" (
	"article_id" uuid NOT NULL,
	"sentence_index" integer NOT NULL,
	"paragraph_index" integer NOT NULL,
	"text" text NOT NULL,
	"body_start" integer NOT NULL,
	"body_end" integer NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	CONSTRAINT "article_sentences_pkey" PRIMARY KEY("article_id","sentence_index")
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_key" text NOT NULL,
	"category_key" text NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"body_text" text NOT NULL,
	"body_hash" text NOT NULL,
	"body_fts" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "articles"."body_text")) STORED NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"last_error_code" text,
	"audio_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"collected_at" timestamp with time zone,
	CONSTRAINT "articles_body_hash_key" UNIQUE("body_hash"),
	CONSTRAINT "articles_state_check" CHECK ("articles"."state" in ('preparing', 'ready', 'failed')),
	CONSTRAINT "articles_attempts_check" CHECK ("articles"."attempts" between 0 and 5),
	CONSTRAINT "articles_last_error_code_check" CHECK ("articles"."last_error_code" in ('tts_error', 'encode_error', 'upload_error', 'interrupted')),
	CONSTRAINT "articles_ready_check" CHECK ("articles"."state" <> 'ready' or ("articles"."audio_asset_id" is not null and "articles"."collected_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"owner_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"last_opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "visits_pkey" PRIMARY KEY("owner_id","article_id")
);
--> statement-breakpoint
CREATE TABLE "audio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cache_key" text NOT NULL,
	"object_key" text NOT NULL,
	"state" text NOT NULL,
	"byte_size" bigint,
	"duration_ms" integer,
	"voice" text NOT NULL,
	"model_revision" text NOT NULL,
	"encoding" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retire_attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "audio_assets_object_key_key" UNIQUE("object_key"),
	CONSTRAINT "audio_assets_state_check" CHECK ("audio_assets"."state" in ('pending', 'ready', 'retiring')),
	CONSTRAINT "audio_assets_byte_size_check" CHECK ("audio_assets"."byte_size" > 0),
	CONSTRAINT "audio_assets_duration_ms_check" CHECK ("audio_assets"."duration_ms" > 0),
	CONSTRAINT "audio_assets_ready_check" CHECK ("audio_assets"."state" <> 'ready' or ("audio_assets"."byte_size" is not null and "audio_assets"."duration_ms" is not null))
);
--> statement-breakpoint
CREATE TABLE "feed_cursors" (
	"feed_key" text PRIMARY KEY NOT NULL,
	"last_occurrence_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	CONSTRAINT "feed_cursors_failed_attempts_check" CHECK ("feed_cursors"."failed_attempts" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "job_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" uuid,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seen_items" (
	"url_hash" text PRIMARY KEY NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synthesis_cpu_months" (
	"month" date PRIMARY KEY NOT NULL,
	"synthesis_seconds" numeric(12, 1) DEFAULT 0 NOT NULL,
	CONSTRAINT "synthesis_cpu_months_month_check" CHECK (extract(day from "synthesis_cpu_months"."month") = 1),
	CONSTRAINT "synthesis_cpu_months_synthesis_seconds_check" CHECK ("synthesis_cpu_months"."synthesis_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"target_ranges" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"lookup_entry_id" uuid NOT NULL,
	CONSTRAINT "examples_lookup_entry_id_position_key" UNIQUE("lookup_entry_id","position"),
	CONSTRAINT "examples_lookup_entry_id_content_hash_key" UNIQUE("lookup_entry_id","content_hash"),
	CONSTRAINT "examples_position_check" CHECK ("examples"."position" >= 0),
	CONSTRAINT "examples_target_ranges_check" CHECK (jsonb_typeof("examples"."target_ranges") = 'array' and jsonb_array_length("examples"."target_ranges") > 0)
);
--> statement-breakpoint
CREATE TABLE "lookup_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"context_text" text NOT NULL,
	"context_hash" text NOT NULL,
	"selection_start" integer NOT NULL,
	"selection_end" integer NOT NULL,
	"selected_text" text NOT NULL,
	"lemma" text NOT NULL,
	"lemma_key" text NOT NULL,
	"pos" text NOT NULL,
	"meaning_zh" text NOT NULL,
	"accepted_forms" text[] NOT NULL,
	CONSTRAINT "lookup_entries_owner_id_context_hash_selection_key" UNIQUE("owner_id","context_hash","selection_start","selection_end"),
	CONSTRAINT "lookup_entries_pos_check" CHECK ("lookup_entries"."pos" in ('noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'determiner', 'interjection', 'phrase', 'phrasal verb', 'idiom')),
	CONSTRAINT "lookup_entries_meaning_zh_check" CHECK (char_length("lookup_entries"."meaning_zh") <= 30),
	CONSTRAINT "lookup_entries_accepted_forms_check" CHECK (cardinality("lookup_entries"."accepted_forms") >= 1)
);
--> statement-breakpoint
CREATE TABLE "review_progress" (
	"owner_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"round" integer NOT NULL,
	"due_at" timestamp with time zone,
	CONSTRAINT "review_progress_pkey" PRIMARY KEY("owner_id","card_id","mode"),
	CONSTRAINT "review_progress_mode_check" CHECK ("review_progress"."mode" in ('speak', 'spell', 'translate')),
	CONSTRAINT "review_progress_round_check" CHECK ("review_progress"."round" between 0 and 7),
	CONSTRAINT "review_progress_due_at_check" CHECK ("review_progress"."due_at" is not null or "review_progress"."round" in (0, 7))
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"engine_revision" text,
	"request_id" text,
	"status" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"audio_ms" integer,
	"cpu_ms" integer,
	"byte_count" bigint,
	"estimated_cost" numeric(12, 6),
	"price_version" text,
	"owner_id" uuid,
	"resource_type" text,
	"resource_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_code" text,
	CONSTRAINT "usage_records_kind_check" CHECK ("usage_records"."kind" in ('lookup', 'meaning_match', 'example', 'translation', 'article_tts', 'word_tts', 'example_tts')),
	CONSTRAINT "usage_records_status_check" CHECK ("usage_records"."status" in ('pending', 'succeeded', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "translation_sets" (
	"card_id" uuid PRIMARY KEY NOT NULL,
	"options" jsonb NOT NULL,
	"correct_option_id" uuid NOT NULL,
	CONSTRAINT "translation_sets_options_check" CHECK (jsonb_typeof("translation_sets"."options") = 'array' and jsonb_array_length("translation_sets"."options") = 4),
	CONSTRAINT "translation_sets_correct_option_check" CHECK ("translation_sets"."options" @> jsonb_build_array(jsonb_build_object('id', "translation_sets"."correct_option_id"::text)))
);
--> statement-breakpoint
CREATE TABLE "vocabulary_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"source_lookup_entry_id" uuid,
	"lemma" text NOT NULL,
	"lemma_key" text NOT NULL,
	"pos" text NOT NULL,
	"meaning_zh" text NOT NULL,
	"accepted_forms" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vocabulary_cards_pos_check" CHECK ("vocabulary_cards"."pos" in ('noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun', 'determiner', 'interjection', 'phrase', 'phrasal verb', 'idiom')),
	CONSTRAINT "vocabulary_cards_meaning_zh_check" CHECK (char_length("vocabulary_cards"."meaning_zh") <= 30),
	CONSTRAINT "vocabulary_cards_accepted_forms_check" CHECK (cardinality("vocabulary_cards"."accepted_forms") >= 1)
);
--> statement-breakpoint
CREATE TABLE "vocabulary_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"target_ranges" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"card_id" uuid NOT NULL,
	"text_fts" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "vocabulary_examples"."text")) STORED NOT NULL,
	CONSTRAINT "vocabulary_examples_card_id_position_key" UNIQUE("card_id","position"),
	CONSTRAINT "vocabulary_examples_card_id_content_hash_key" UNIQUE("card_id","content_hash"),
	CONSTRAINT "vocabulary_examples_position_check" CHECK ("vocabulary_examples"."position" >= 0),
	CONSTRAINT "vocabulary_examples_target_ranges_check" CHECK (jsonb_typeof("vocabulary_examples"."target_ranges") = 'array' and jsonb_array_length("vocabulary_examples"."target_ranges") > 0)
);
--> statement-breakpoint
CREATE TABLE "operation_receipts" (
	"owner_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"request_digest" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_receipts_pkey" PRIMARY KEY("owner_id","operation_id"),
	CONSTRAINT "operation_receipts_kind_check" CHECK ("operation_receipts"."kind" in ('lookup.create', 'lookup.refresh-example', 'vocabulary.save', 'vocabulary.replace', 'vocabulary.refresh-example', 'vocabulary.delete', 'vocabulary.bulk-delete', 'review.submit'))
);
--> statement-breakpoint
ALTER TABLE "article_sentences" ADD CONSTRAINT "article_sentences_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_audio_asset_id_audio_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "examples" ADD CONSTRAINT "examples_lookup_entry_id_lookup_entries_id_fk" FOREIGN KEY ("lookup_entry_id") REFERENCES "public"."lookup_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lookup_entries" ADD CONSTRAINT "lookup_entries_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_progress" ADD CONSTRAINT "review_progress_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_progress" ADD CONSTRAINT "review_progress_card_id_vocabulary_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."vocabulary_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "translation_sets" ADD CONSTRAINT "translation_sets_card_id_vocabulary_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."vocabulary_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_cards" ADD CONSTRAINT "vocabulary_cards_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_cards" ADD CONSTRAINT "vocabulary_cards_source_lookup_entry_id_lookup_entries_id_fk" FOREIGN KEY ("source_lookup_entry_id") REFERENCES "public"."lookup_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_examples" ADD CONSTRAINT "vocabulary_examples_card_id_vocabulary_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."vocabulary_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_state_collected_at_id_idx" ON "articles" USING btree ("state","collected_at","id");--> statement-breakpoint
CREATE INDEX "articles_state_title_id_idx" ON "articles" USING btree ("state",lower("title"),"id");--> statement-breakpoint
CREATE INDEX "articles_state_feed_key_id_idx" ON "articles" USING btree ("state","feed_key","id");--> statement-breakpoint
CREATE INDEX "articles_state_category_key_id_idx" ON "articles" USING btree ("state","category_key","id");--> statement-breakpoint
CREATE INDEX "articles_body_fts_idx" ON "articles" USING gin ("body_fts");--> statement-breakpoint
CREATE INDEX "articles_state_retry_at_idx" ON "articles" USING btree ("state","retry_at");--> statement-breakpoint
CREATE INDEX "visits_owner_id_last_opened_at_article_id_idx" ON "visits" USING btree ("owner_id","last_opened_at","article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_assets_cache_key_idx" ON "audio_assets" USING btree ("cache_key") WHERE "audio_assets"."state" <> 'retiring';--> statement-breakpoint
CREATE INDEX "audio_assets_state_created_at_id_idx" ON "audio_assets" USING btree ("state","created_at","id");--> statement-breakpoint
CREATE INDEX "seen_items_first_seen_at_idx" ON "seen_items" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "review_progress_owner_id_mode_due_at_card_id_idx" ON "review_progress" USING btree ("owner_id","mode","due_at","card_id");--> statement-breakpoint
CREATE INDEX "review_progress_owner_id_mode_round_card_id_idx" ON "review_progress" USING btree ("owner_id","mode","round","card_id");--> statement-breakpoint
CREATE INDEX "vocabulary_cards_owner_id_lemma_key_pos_idx" ON "vocabulary_cards" USING btree ("owner_id","lemma_key","pos");--> statement-breakpoint
CREATE INDEX "vocabulary_cards_owner_id_lemma_key_id_idx" ON "vocabulary_cards" USING btree ("owner_id","lemma_key","id");--> statement-breakpoint
CREATE INDEX "vocabulary_cards_owner_id_created_at_id_idx" ON "vocabulary_cards" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "vocabulary_cards_source_lookup_entry_id_idx" ON "vocabulary_cards" USING btree ("source_lookup_entry_id");--> statement-breakpoint
CREATE INDEX "vocabulary_examples_text_fts_idx" ON "vocabulary_examples" USING gin ("text_fts");--> statement-breakpoint
CREATE INDEX "operation_receipts_created_at_idx" ON "operation_receipts" USING btree ("created_at");
-- What the table definitions cannot express. The shared operation_receipts table (src/lib/db/schema.ts)
-- may not import the account feature that defines members, so its foreign key to members is added here.
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The collection job's lease, already expired, so the first run takes it (src/features/collection).
INSERT INTO "job_leases" ("name", "holder", "expires_at") VALUES ('collect', NULL, '-infinity');

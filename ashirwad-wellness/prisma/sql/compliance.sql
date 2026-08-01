-- ---------------------------------------------------------------------------
-- Ashirwad Wellness — database-level compliance enforcement
--
-- This file is appended verbatim to the initial Prisma migration. Everything
-- here holds even if the application layer is bypassed entirely: a direct psql
-- session, a stray script, a future contributor who forgets the helper.
--
-- Prisma maps model names to snake_case tables (@@map) but leaves field names
-- as-is, so columns are camelCase and must be quoted.
-- ---------------------------------------------------------------------------


-- 1. requiresPrescription is DERIVED, never asserted -------------------------
-- The Rx gate reads this column. If it could drift from scheduleType, the gate
-- would be a lie. This makes drift impossible rather than unlikely.

ALTER TABLE "products"
  ADD CONSTRAINT "products_requires_prescription_derived"
  CHECK ("requiresPrescription" = ("scheduleType" IN ('SCHEDULE_H', 'SCHEDULE_H1')));


-- 2. Schedule X / narcotics / psychotropics are unrepresentable -------------
-- The enum already has no member for them. This constraint is deliberately
-- redundant: it means a future ALTER TYPE ... ADD VALUE cannot silently make
-- controlled substances listable without someone also dropping this constraint
-- and explaining why in a migration.

ALTER TABLE "products"
  ADD CONSTRAINT "products_permitted_schedule_types"
  CHECK ("scheduleType" IN (
    'OTC', 'SCHEDULE_H', 'SCHEDULE_H1',
    'AYURVEDIC', 'COSMETIC', 'NUTRACEUTICAL', 'DEVICE'
  ));


-- 3. Banned-substance guard --------------------------------------------------
-- Constraint 2 stops someone listing a controlled drug *honestly*. This stops
-- them listing one dishonestly, by tagging pentazocine as OTC. Matches the
-- product name and composition against the banned list on every write.

CREATE OR REPLACE FUNCTION "reject_banned_substance"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  hit RECORD;
  haystack TEXT;
BEGIN
  haystack := lower(NEW."name" || ' ' || NEW."composition");

  SELECT b."name", b."reason", b."authority"
    INTO hit
    FROM "banned_substances" b
   WHERE position(b."name" IN haystack) > 0
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Refused to list product %: contains banned substance "%" (%). Authority: %',
      NEW."name", hit."name", hit."reason", COALESCE(hit."authority", 'not recorded')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "products_banned_substance_guard"
  BEFORE INSERT OR UPDATE OF "name", "composition" ON "products"
  FOR EACH ROW EXECUTE FUNCTION "reject_banned_substance"();


-- 4. A Schedule H/H1 line cannot be dispensed without a prescription ---------
-- The server action checks this. So does the database. Belt and braces,
-- because this is the single constraint the whole build exists to honour.

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_rx_requires_prescription"
  CHECK (
    "scheduleTypeSnapshot" NOT IN ('SCHEDULE_H', 'SCHEDULE_H1')
    OR "prescriptionId" IS NOT NULL
  );


-- 5. Money and tax sanity ----------------------------------------------------

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_sane"
  CHECK ("mrpPaise" > 0 AND "sellingPricePaise" > 0 AND "sellingPricePaise" <= "mrpPaise");

ALTER TABLE "products"
  ADD CONSTRAINT "products_gst_slab"
  CHECK ("gstRateBps" IN (0, 500, 1200, 1800, 2800));

ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_non_negative"
  CHECK ("stock" >= 0);


-- 6. Refill budget cannot be overdrawn --------------------------------------

ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_refills_within_budget"
  CHECK ("refillsUsed" >= 0 AND "refillsAllowed" >= 0 AND "refillsUsed" <= "refillsAllowed");


-- 7. A coupon is either percentage-off or flat-off, never both, never neither -

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_exactly_one_discount_kind"
  CHECK (("percentOff" IS NULL) <> ("flatOffPaise" IS NULL));

ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_percent_range"
  CHECK ("percentOff" IS NULL OR ("percentOff" > 0 AND "percentOff" <= 100));


-- 8. Append-only registers ---------------------------------------------------
-- Rule 65(11A) requires the H1 register to be a register, not a spreadsheet.
-- A row, once written, is permanent. Corrections are filed as new rows via
-- "correctsEntryId". The audit log gets identical treatment.
--
-- These triggers fire for the table owner too. Rewriting history requires
-- dropping the trigger, which is itself a schema change with a paper trail.

CREATE OR REPLACE FUNCTION "reject_mutation_append_only"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only; % is not permitted. File a correcting entry instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "schedule_h1_register_append_only"
  BEFORE UPDATE OR DELETE ON "schedule_h1_register"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation_append_only"();

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "reject_mutation_append_only"();

-- TRUNCATE bypasses row-level triggers, so it needs its own statement-level one.
CREATE TRIGGER "schedule_h1_register_no_truncate"
  BEFORE TRUNCATE ON "schedule_h1_register"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation_append_only"();

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "reject_mutation_append_only"();


-- 9. A correcting H1 entry must state why ------------------------------------

ALTER TABLE "schedule_h1_register"
  ADD CONSTRAINT "h1_correction_requires_reason"
  CHECK ("correctsEntryId" IS NULL OR "correctionReason" IS NOT NULL);


-- 10. Search support ---------------------------------------------------------
-- Trigram indexes for typo-tolerant search across product name, brand, and
-- salt (Phase 2). pg_trgm ships with Postgres contrib.

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX "products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "products_composition_trgm" ON "products" USING GIN ("composition" gin_trgm_ops);
CREATE INDEX "salts_name_trgm" ON "salts" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "brands_name_trgm" ON "brands" USING GIN ("name" gin_trgm_ops);

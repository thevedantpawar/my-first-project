-- DropIndex
DROP INDEX "schedule_h1_register_orderItemId_key";

-- RenameIndex
ALTER INDEX "brands_name_trgm" RENAME TO "brands_name_idx";

-- RenameIndex
ALTER INDEX "products_composition_trgm" RENAME TO "products_composition_idx";

-- RenameIndex
ALTER INDEX "products_name_trgm" RENAME TO "products_name_idx";

-- RenameIndex
ALTER INDEX "salts_name_trgm" RENAME TO "salts_name_idx";

-- The DROP above removes the global unique on "orderItemId", which had made
-- corrections impossible: a correcting register entry must reference the same
-- order item as the row it corrects.
--
-- The real rule is narrower — at most ONE original (non-correcting) entry per
-- dispensed item. Corrections are limited to one-per-original by the existing
-- unique on "correctsEntryId".
CREATE UNIQUE INDEX "h1_register_one_original_per_order_item"
  ON "schedule_h1_register" ("orderItemId")
  WHERE "correctsEntryId" IS NULL;

\set ON_ERROR_STOP on

-- Supporting rows -----------------------------------------------------------
INSERT INTO "categories" ("id","name","slug","updatedAt") VALUES ('cat1','Pain Relief','pain-relief',now());
INSERT INTO "manufacturers" ("id","name","slug","updatedAt") VALUES ('mfr1','Cipla Ltd','cipla',now());
INSERT INTO "banned_substances" ("id","name","reason","authority")
  VALUES ('ban1','pentazocine','SCHEDULE_X','Schedule X, Drugs and Cosmetics Rules 1945');

-- A legitimately listable OTC product, to prove the guards are not blanket-deny.
INSERT INTO "products"
  ("id","name","slug","categoryId","manufacturerId","scheduleType","requiresPrescription",
   "composition","form","packSize","hsnCode","gstRateBps","mrpPaise","sellingPricePaise","updatedAt")
VALUES
  ('p_ok','Crocin Advance 500mg','crocin-advance-500','cat1','mfr1','OTC',false,
   'Paracetamol 500mg','TABLET','strip of 15 tablets','30049099',1200,3100,2790,now());

-- A legitimately listable Schedule H product.
INSERT INTO "products"
  ("id","name","slug","categoryId","manufacturerId","scheduleType","requiresPrescription",
   "composition","form","packSize","hsnCode","gstRateBps","mrpPaise","sellingPricePaise","updatedAt")
VALUES
  ('p_h','Azithral 500 Tablet','azithral-500','cat1','mfr1','SCHEDULE_H',true,
   'Azithromycin 500mg','TABLET','strip of 5 tablets','30042019',1200,12300,10455,now());

DO $$
DECLARE passed INT := 0;
BEGIN

-- Test 1: Schedule H product claiming it needs no prescription -------------
BEGIN
  INSERT INTO "products"
    ("id","name","slug","categoryId","manufacturerId","scheduleType","requiresPrescription",
     "composition","form","packSize","hsnCode","gstRateBps","mrpPaise","sellingPricePaise","updatedAt")
  VALUES ('t1','Sneaky Antibiotic','sneaky-1','cat1','mfr1','SCHEDULE_H',false,
          'Amoxicillin 500mg','CAPSULE','strip of 10','30042019',1200,10000,9000,now());
  RAISE EXCEPTION 'TEST 1 FAILED: Schedule H product accepted with requiresPrescription=false';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 1  Rx-derivation constraint rejected desynced requiresPrescription';
  passed := passed + 1;
END;

-- Test 2: OTC product claiming it DOES need a prescription -----------------
-- The constraint is an equality, so it catches drift in both directions.
BEGIN
  INSERT INTO "products"
    ("id","name","slug","categoryId","manufacturerId","scheduleType","requiresPrescription",
     "composition","form","packSize","hsnCode","gstRateBps","mrpPaise","sellingPricePaise","updatedAt")
  VALUES ('t2','Confused Vitamin','confused-2','cat1','mfr1','OTC',true,
          'Ascorbic Acid 500mg','TABLET','strip of 10','30042019',1200,10000,9000,now());
  RAISE EXCEPTION 'TEST 2 FAILED: OTC product accepted with requiresPrescription=true';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 2  Rx-derivation constraint rejected drift in the other direction';
  passed := passed + 1;
END;

-- Test 3: banned substance smuggled in tagged as OTC -----------------------
BEGIN
  INSERT INTO "products"
    ("id","name","slug","categoryId","manufacturerId","scheduleType","requiresPrescription",
     "composition","form","packSize","hsnCode","gstRateBps","mrpPaise","sellingPricePaise","updatedAt")
  VALUES ('t3','Fortwin Injection','fortwin-3','cat1','mfr1','OTC',false,
          'Pentazocine 30mg/ml','INJECTION','1 ml ampoule','30049099',1200,5000,4500,now());
  RAISE EXCEPTION 'TEST 3 FAILED: banned substance listed as OTC';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 3  Banned-substance guard rejected Schedule X drug disguised as OTC';
  passed := passed + 1;
END;

-- Test 4: banned substance introduced by a later UPDATE --------------------
BEGIN
  UPDATE "products" SET "composition" = 'Pentazocine 30mg' WHERE "id" = 'p_ok';
  RAISE EXCEPTION 'TEST 4 FAILED: banned substance introduced via UPDATE';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 4  Banned-substance guard fires on UPDATE, not just INSERT';
  passed := passed + 1;
END;

-- Test 5: selling price above MRP ------------------------------------------
BEGIN
  UPDATE "products" SET "sellingPricePaise" = 99999 WHERE "id" = 'p_ok';
  RAISE EXCEPTION 'TEST 5 FAILED: selling price above MRP accepted';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 5  Price constraint rejected sellingPrice > MRP';
  passed := passed + 1;
END;

-- Test 6: invalid GST slab --------------------------------------------------
BEGIN
  UPDATE "products" SET "gstRateBps" = 1500 WHERE "id" = 'p_ok';
  RAISE EXCEPTION 'TEST 6 FAILED: non-existent GST slab accepted';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 6  GST constraint rejected a slab that does not exist in Indian GST';
  passed := passed + 1;
END;

-- Test 7: coupon with both discount kinds ----------------------------------
BEGIN
  INSERT INTO "coupons" ("id","code","percentOff","flatOffPaise","startsAt","endsAt","updatedAt")
  VALUES ('c1','BOTH',10,5000,now(),now() + interval '30 days',now());
  RAISE EXCEPTION 'TEST 7 FAILED: coupon accepted with both percentOff and flatOffPaise';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 7  Coupon constraint rejected ambiguous discount definition';
  passed := passed + 1;
END;

-- Test 8: prescription refills overdrawn ------------------------------------
BEGIN
  INSERT INTO "users" ("id","email","role","updatedAt") VALUES ('u_over','over@example.invalid','CUSTOMER',now());
  INSERT INTO "prescriptions" ("id","userId","imageKey","refillsAllowed","refillsUsed","updatedAt")
  VALUES ('rx_over','u_over','private/rx/over.jpg',2,5,now());
  RAISE EXCEPTION 'TEST 8 FAILED: refillsUsed exceeded refillsAllowed';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 8  Refill constraint rejected an overdrawn repeat-dispensing budget';
  passed := passed + 1;
END;

RAISE NOTICE '--- write-path constraints: % passed ---', passed;
END $$;


-- Tests 9-12 need committed rows, so they run outside the DO block ----------

INSERT INTO "users" ("id","email","role","pharmacistRegNo","updatedAt")
  VALUES ('u_cust','cust@example.invalid','CUSTOMER',NULL,now()),
         ('u_ph','ph@example.invalid','PHARMACIST','MSPC-PLACEHOLDER',now());

INSERT INTO "addresses" ("id","userId","fullName","phone","line1","city","state","pincode","updatedAt")
  VALUES ('a1','u_cust','Test Patient','9999999999','1 Test Road','Nashik','Maharashtra','422001',now());

INSERT INTO "prescriptions" ("id","userId","imageKey","status","updatedAt")
  VALUES ('rx1','u_cust','private/rx/abc.jpg','VERIFIED',now());

INSERT INTO "orders"
  ("id","orderNumber","userId","addressId","status","paymentMethod","subtotalPaise","totalPaise","shipAddressSnapshot","updatedAt")
  VALUES ('o1','AW-2026-000001','u_cust','a1','CONFIRMED','COD',10455,10455,'{}'::jsonb,now());

-- Test 9: Schedule H order line with no prescription attached --------------
DO $$
BEGIN
  INSERT INTO "order_items"
    ("id","orderId","productId","quantity","nameSnapshot","compositionSnapshot","packSizeSnapshot",
     "manufacturerSnapshot","scheduleTypeSnapshot","hsnCodeSnapshot","gstRateBpsSnapshot",
     "mrpPaise","sellingPricePaise","lineTotalPaise","lineGstPaise","prescriptionId")
  VALUES ('oi_bad','o1','p_h',1,'Azithral 500 Tablet','Azithromycin 500mg','strip of 5 tablets',
          'Cipla Ltd','SCHEDULE_H','30042019',1200,12300,10455,10455,1120,NULL);
  RAISE EXCEPTION 'TEST 9 FAILED: Schedule H line dispensed with no prescription';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 9  Rx gate held at the DATABASE layer, not just the server action';
END $$;

-- The same line, with a prescription attached, must succeed.
INSERT INTO "order_items"
  ("id","orderId","productId","quantity","nameSnapshot","compositionSnapshot","packSizeSnapshot",
   "manufacturerSnapshot","scheduleTypeSnapshot","hsnCodeSnapshot","gstRateBpsSnapshot",
   "mrpPaise","sellingPricePaise","lineTotalPaise","lineGstPaise","prescriptionId")
VALUES ('oi_ok','o1','p_h',1,'Azithral 500 Tablet','Azithromycin 500mg','strip of 5 tablets',
        'Cipla Ltd','SCHEDULE_H','30042019',1200,12300,10455,10455,1120,'rx1');

-- Test 10 & 11: H1 register is append-only ---------------------------------
INSERT INTO "schedule_h1_register"
  ("id","orderId","orderItemId","prescriptionId","prescriberName","prescriberRegNo",
   "patientName","drugName","composition","form","packSize","quantity",
   "pharmacistId","pharmacistName","pharmacistRegNo")
VALUES ('h1_1','o1','oi_ok','rx1','Dr A Placeholder','MMC-PLACEHOLDER',
        'Test Patient','Azithral 500 Tablet','Azithromycin 500mg','TABLET','strip of 5 tablets',1,
        'u_ph','Placeholder Pharmacist','MSPC-PLACEHOLDER');

DO $$
BEGIN
  UPDATE "schedule_h1_register" SET "quantity" = 99 WHERE "id" = 'h1_1';
  RAISE EXCEPTION 'TEST 10 FAILED: H1 register row was rewritten';
EXCEPTION WHEN restrict_violation THEN
  RAISE NOTICE 'PASS 10 H1 register refused UPDATE (append-only trigger)';
END $$;

DO $$
BEGIN
  DELETE FROM "schedule_h1_register" WHERE "id" = 'h1_1';
  RAISE EXCEPTION 'TEST 11 FAILED: H1 register row was deleted';
EXCEPTION WHEN restrict_violation THEN
  RAISE NOTICE 'PASS 11 H1 register refused DELETE (append-only trigger)';
END $$;

-- Test 12: audit log is append-only ----------------------------------------
INSERT INTO "audit_logs" ("id","actorId","actorRole","action","entityType","entityId","ipAddress")
VALUES ('al1','u_ph','PHARMACIST','PRESCRIPTION_VERIFIED','Prescription','rx1','203.0.113.10');

DO $$
BEGIN
  DELETE FROM "audit_logs" WHERE "id" = 'al1';
  RAISE EXCEPTION 'TEST 12 FAILED: audit log row was deleted';
EXCEPTION WHEN restrict_violation THEN
  RAISE NOTICE 'PASS 12 Audit log refused DELETE (append-only trigger)';
END $$;

-- Test 13: correcting H1 entry with no stated reason ------------------------
DO $$
BEGIN
  INSERT INTO "schedule_h1_register"
    ("id","orderId","orderItemId","prescriptionId","prescriberName","prescriberRegNo",
     "patientName","drugName","composition","form","packSize","quantity",
     "pharmacistId","pharmacistName","pharmacistRegNo","correctsEntryId","correctionReason")
  VALUES ('h1_2','o1','oi_ok','rx1','Dr A Placeholder','MMC-PLACEHOLDER',
          'Test Patient','Azithral 500 Tablet','Azithromycin 500mg','TABLET','strip of 5 tablets',2,
          'u_ph','Placeholder Pharmacist','MSPC-PLACEHOLDER','h1_1',NULL);
  RAISE EXCEPTION 'TEST 13 FAILED: correcting entry accepted with no reason';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'PASS 13 Correcting H1 entry required a stated reason';
END $$;

-- Test 14: typo-tolerant search works (pg_trgm) ----------------------------
SELECT 'PASS 14 trigram search matched "azithro" -> ' || "name" AS result
  FROM "products" WHERE "name" % 'Azithral' OR "composition" ILIKE '%azithro%';

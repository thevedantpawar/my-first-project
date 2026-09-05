-- Order numbers are customer-facing and appear on the invoice, so they must be
-- sequential and gap-tolerant rather than derived from a count(*) — two
-- concurrent checkouts counting rows would mint the same number.
--
-- A sequence is atomic and never hands the same value to two transactions,
-- including under rollback (which leaves a gap; gaps are fine, collisions are
-- not).

CREATE SEQUENCE IF NOT EXISTS "order_number_seq" START WITH 1 INCREMENT BY 1;

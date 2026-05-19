-- เพิ่มคอลัมน์เก็บสลิปโอนเงิน
DO $$ BEGIN
  ALTER TABLE fx_parcels ADD COLUMN payment_slip TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

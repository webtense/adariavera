-- FIRMA — Pre check-in con firma manuscrita + PDF generado.
-- adaria-precheckin (14/09/2026)
--
-- Aditivo (ADD COLUMN IF NOT EXISTS): no rompe nada de lo que ya está en
-- producción. Los ficheros en sí (PNG/PDF) NO se guardan en la base de
-- datos, solo su ruta en disco y el hash del PDF para poder acreditar
-- integridad sin volver a abrir el fichero.

ALTER TABLE precheckin_reserva
  ADD COLUMN IF NOT EXISTS signature_png_path VARCHAR(300),
  ADD COLUMN IF NOT EXISTS pdf_path            VARCHAR(300),
  ADD COLUMN IF NOT EXISTS pdf_hash_sha256      VARCHAR(64),
  ADD COLUMN IF NOT EXISTS signed_at            TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_precheckin_reserva_signed_at ON precheckin_reserva(signed_at);

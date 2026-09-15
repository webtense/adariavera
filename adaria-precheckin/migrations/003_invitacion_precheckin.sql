-- Invitación pre check-in por email — adaria-precheckin.
-- 14/09/2026.
--
-- Aditivo (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS): no toca
-- nada existente y no toca ACI (esta app sigue siendo SOLO LECTURA contra el
-- PMS — ver REGLA DE ORO en aci.js).
--
-- precheckin_envio traza cada invitación enviada al huésped para que rellene
-- el pre check-in antes de llegar: a qué reserva corresponde, a qué email se
-- mandó, si ese email es "entregable" (no es un buzón proxy de una OTA que
-- nunca llega al huésped real — ver esEmailEntregable() en aci.js), el token
-- único que identifica la invitación (va en el enlace del correo y en el
-- píxel de tracking) y las tres marcas de tiempo del ciclo de vida: enviado,
-- abierto (vía /api/precheckin/track/:token.gif) y rellenado (cuando el
-- token llega en POST /api/precheckin).
CREATE TABLE IF NOT EXISTS precheckin_envio (
  id                BIGSERIAL PRIMARY KEY,
  reserva_codigo    VARCHAR(30) NOT NULL,          -- localizador ACI (RES_COD_str), no FK: la invitación puede salir antes de que exista fila en precheckin_reserva
  email             VARCHAR(150) NOT NULL,
  email_entregable  BOOLEAN NOT NULL DEFAULT true, -- false = dominio de OTA/proxy conocido (ver esEmailEntregable) — no se envía, solo se registra el motivo
  token             VARCHAR(64) NOT NULL,
  enviado_en        TIMESTAMPTZ,
  abierto_en        TIMESTAMPTZ,
  rellenado_en      TIMESTAMPTZ,
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- pendiente | enviado | no_entregable | error | abierto | rellenado
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_precheckin_envio_reserva_codigo ON precheckin_envio(reserva_codigo);
CREATE INDEX IF NOT EXISTS idx_precheckin_envio_estado ON precheckin_envio(estado);

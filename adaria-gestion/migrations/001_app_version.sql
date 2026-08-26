-- FASE 1 — Sistema de versión unificado v1.1.0
-- Tabla app_version en la BD del portal adaria-gestion (misma BD que usuarios/auditoría,
-- o BD dedicada si se prefiere aislar; ajustar host/db en .env de conexión antes de ejecutar).

CREATE TABLE IF NOT EXISTS app_version (
  app_code       TEXT PRIMARY KEY,
  app_name       TEXT NOT NULL,
  version        TEXT NOT NULL,
  manual_version TEXT,
  changelog_md   TEXT,
  release_date   DATE,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: las 11 apps del ecosistema Adaria arrancan en 1.1.0
INSERT INTO app_version (app_code, app_name, version, manual_version, release_date, updated_by) VALUES
  ('adaria-gestion',      'Adaria Gestión (portal)',        '1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-welcome',      'Adaria Welcome (check-in digital)','1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-precheckin',   'Adaria Pre check-in',            '1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-personal',     'Adaria Personal (RRHH)',         '1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-parking',      'Adaria Parking',                 '1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-ine',          'Adaria INE',                     '1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-guest',        'Adaria Guest Portal',            '1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-estadisticas', 'Adaria Estadísticas',            '1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-escaner',      'Adaria Escáner DNI',             '1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-manuales',     'Adaria Manuales',                '1.1.0', '1.0', '2026-08-26', 'asanchez'),
  ('adaria-it',           'Adaria Dashboard IT',            '1.1.0', '1.0', '2026-08-26', 'asanchez')
ON CONFLICT (app_code) DO NOTHING;

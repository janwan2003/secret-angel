// Generated from schema.sql (kept in sync by hand; tests/unit checks it).
export const SCHEMA = `
-- Featherpost (secret-angel) D1 schema
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  reveal_date TEXT NOT NULL DEFAULT '',
  pack TEXT NOT NULL DEFAULT 'daily',      -- daily | weekly | none
  budget TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',     -- open | playing | revealed
  created_at INTEGER NOT NULL,
  drawn_at INTEGER,
  revealed_at INTEGER
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  is_organizer INTEGER NOT NULL DEFAULT 0,
  likes TEXT NOT NULL DEFAULT '{}',
  mortal_id TEXT,
  guess_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS members_game ON members(game_id);
CREATE UNIQUE INDEX IF NOT EXISTS members_tok ON members(token_hash);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  angel_id TEXT NOT NULL,
  mortal_id TEXT NOT NULL,
  from_angel INTEGER NOT NULL,
  body TEXT NOT NULL,
  reported INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_game ON notes(game_id);
CREATE INDEX IF NOT EXISTS notes_angel ON notes(angel_id);
CREATE INDEX IF NOT EXISTS notes_mortal ON notes(mortal_id);
CREATE TABLE IF NOT EXISTS rate (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
`;

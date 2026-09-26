import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export const DATA_DIR = path.join(process.cwd(), "data");
export const DB_PATH = path.join(DATA_DIR, "nhl.db");

declare global {
  // eslint-disable-next-line no-var
  var __nhlDb: Database.Database | undefined;
}

function createDb(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// Cached on globalThis so Next's dev hot reload doesn't open a new handle per edit.
export function getDb(): Database.Database {
  if (!globalThis.__nhlDb) globalThis.__nhlDb = createDb();
  return globalThis.__nhlDb;
}

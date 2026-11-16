import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { applySqliteMigrations } from './storage/sqlite-migrations.js';

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
export const db = new Database(env.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema ownership is centralized; dependent modules no longer issue ad-hoc DDL.
applySqliteMigrations(db);

export const now = () => Date.now();

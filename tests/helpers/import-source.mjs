import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createImportSource(dir, suffix = randomUUID().replaceAll('-', '').slice(0, 10), agentId) {
  const sourcePath = path.join(dir, `${suffix}.sqlite`);
  const db = new Database(sourcePath);
  const userId = `legacy_owner_${suffix}`;
  const botId = agentId ?? `legacy_bot_${suffix}`;
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,name TEXT,created_at INTEGER);
    CREATE TABLE bots(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,kind TEXT,label TEXT,description TEXT,avatar_shape TEXT,voice_speed REAL,instructions TEXT,engine TEXT,model TEXT,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE auth_sessions(token TEXT,user_id TEXT);
    CREATE TABLE rows(bot_id TEXT,body TEXT);`);
  db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(userId, `OWNER_${suffix}@example.test`, 'Owner Ș', 1700000000000);
  db.prepare('INSERT INTO bots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(botId,userId,'Agent Ș','agent','Research','Useful agent','hex',1.1,'secret-instructions-not-imported','primary','unverified-model',1700000000001,1700000000002);
  db.prepare('INSERT INTO bots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`room_${suffix}`,userId,'Team room','room','','','square',1,'','',null,1700000000001,1700000000002);
  db.prepare('INSERT INTO auth_sessions VALUES(?,?)').run('session-secret-not-imported', userId);
  db.prepare('INSERT INTO rows VALUES(?,?)').run(botId, 'conversation-not-imported');
  db.close();
  return { sourcePath, userId, botId, options: { sourcePath, organizationId: `import_org_${suffix}`, organizationSlug: `import-${suffix}`, organizationName: 'Imported organization', workspaceId: `import_ws_${suffix}`, workspaceName: 'Imported workspace' } };
}

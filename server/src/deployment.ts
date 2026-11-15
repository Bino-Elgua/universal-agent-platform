import { db } from './db.js';

/** Transitional self-hosted boundary. Shared runtimes are not a multi-tenant deployment. */
export class DeploymentOwnershipError extends Error {
  constructor(message = 'This self-hosted installation is restricted to its owner.') {
    super(message);
    this.name = 'DeploymentOwnershipError';
  }
}

type Binding = { owner_user_id: string | null; primary_bot_id: string | null };

// Fail before engines/schedulers start. Do not choose an owner or change legacy data
// when multiple accounts or conflicting primary bindings already exist.
db.transaction(() => {
  const users = db.prepare('SELECT id FROM users').all() as { id: string }[];
  if (users.length > 1) {
    throw new DeploymentOwnershipError('Multiple legacy accounts were found on a shared runtime. Startup is blocked. Back up and export accounts into separate installations before retrying; no account has been selected or deleted.');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS deployment_binding (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    owner_user_id TEXT UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    primary_bot_id TEXT UNIQUE
  )`);
  db.prepare('INSERT OR IGNORE INTO deployment_binding(singleton) VALUES (1)').run();
  const binding = db.prepare('SELECT * FROM deployment_binding WHERE singleton=1').get() as Binding;
  const primary = db.prepare("SELECT id, user_id FROM bots WHERE engine='primary'").all() as { id: string; user_id: string }[];
  const owner = binding.owner_user_id ?? users[0]?.id ?? null;
  if ((binding.owner_user_id && binding.owner_user_id !== users[0]?.id) || primary.length > 1 ||
      primary.some(bot => bot.user_id !== owner || (binding.primary_bot_id && bot.id !== binding.primary_bot_id))) {
    throw new DeploymentOwnershipError('The persisted owner or primary Hermes binding is inconsistent. Startup is blocked; restore or repair a backup before retrying.');
  }
  db.prepare('UPDATE deployment_binding SET owner_user_id=?, primary_bot_id=? WHERE singleton=1')
    .run(owner, binding.primary_bot_id ?? primary[0]?.id ?? null);
}).immediate();

function binding(): Binding {
  return db.prepare('SELECT owner_user_id, primary_bot_id FROM deployment_binding WHERE singleton=1').get() as Binding;
}

export const deployment = {
  ownerId(): string | null { return binding().owner_user_id; },

  isOwner(userId: string): boolean { return binding().owner_user_id === userId; },

  requireOwner(userId: string): void {
    if (!this.isOwner(userId)) throw new DeploymentOwnershipError();
  },

  /** Call only inside the enrollment transaction after authenticating setup authority. */
  claimOwner(userId: string): void {
    const current = binding().owner_user_id;
    const users = db.prepare('SELECT id FROM users').all() as { id: string }[];
    if ((current && current !== userId) || users.length !== 1 || users[0].id !== userId) throw new DeploymentOwnershipError();
    db.prepare('UPDATE deployment_binding SET owner_user_id=? WHERE singleton=1 AND owner_user_id IS NULL').run(userId);
  },

  /** A deleted primary leaves a tombstone: another bot must never inherit its gateway. */
  assignPrimary(botId: string, userId: string): boolean {
    return db.transaction(() => {
      this.requireOwner(userId);
      const bot = db.prepare('SELECT user_id FROM bots WHERE id=?').get(botId) as { user_id: string } | undefined;
      if (bot?.user_id !== userId) throw new DeploymentOwnershipError();
      db.prepare('UPDATE deployment_binding SET primary_bot_id=? WHERE singleton=1 AND primary_bot_id IS NULL').run(botId);
      return binding().primary_bot_id === botId;
    }).immediate();
  },
};

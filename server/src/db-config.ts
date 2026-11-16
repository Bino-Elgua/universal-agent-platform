// Compatibility import for existing callers. db.ts applies the versioned schema atomically.
import './db.js';
export const configSchemaReady = true;

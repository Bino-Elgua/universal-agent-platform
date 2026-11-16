/** Keep transaction and connection ownership in the migration runner. SQL is trusted source code. */
export function validatePostgresMigrationSql(sql: string): void {
  // PostgreSQL permits non-ASCII bytes in unquoted identifiers as well.
  const identifierContinuation = (char: string) => /[A-Za-z0-9_$]/.test(char) || (char.length > 0 && char.charCodeAt(0) >= 0x80);
  let bare = '';
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n' && sql[i] !== '\r') i++;
      bare += ' ';
    } else if (char === '/' && sql[i + 1] === '*') {
      let depth = 1; i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error('Unterminated migration SQL comment.');
      i--; bare += ' ';
    } else if (char === "'" || char === '"') {
      const escaped = char === "'" && /[eE]/.test(sql[i - 1] ?? '') && !identifierContinuation(sql[i - 2] ?? '');
      let closed = false;
      for (i++; i < sql.length; i++) {
        if (escaped && sql[i] === '\\') { i++; continue; }
        if (sql[i] !== char) continue;
        if (sql[i + 1] === char) { i++; continue; }
        closed = true; break;
      }
      if (!closed) throw new Error('Unterminated migration SQL string or identifier.');
      bare += ' ';
    } else if (char === '$' && !identifierContinuation(sql[i - 1] ?? '')) {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        if (end < 0) throw new Error('Unterminated migration SQL dollar quote.');
        i = end + tag.length - 1; bare += ' ';
      } else bare += char;
    } else bare += char;
  }
  const forbidden = /^\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION|SET|RESET|DISCARD)\b/i;
  if (bare.split(';').some(statement => forbidden.test(statement))) {
    throw new Error('PostgreSQL migration SQL cannot control transactions or connection settings.');
  }
}

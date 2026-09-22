import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function createTestDb() {
  const sqlite = new DatabaseSync(':memory:');
  for (const path of readdirSync('migrations').filter((p) => p.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${path}`, 'utf8'));
  }
  let writes = 0;
  function prepare(sql: string) {
    let nextIndex = 0;
    const normalizedSql = sql.replace(/\?(\d+)?/g, (_, index) => {
      nextIndex = index ? Number(index) : nextIndex + 1;
      return `?${nextIndex}`;
    });
    let values: unknown[] = [];
    function execute() {
      const stmt = sqlite.prepare(normalizedSql);
      // D1's ?1 syntax is SQLite named binding syntax in node:sqlite.
      const numbered = /\?[1-9]/.test(normalizedSql);
      const params = numbered ? [Object.fromEntries(values.map((v, i) => [`?${i + 1}`, v]))] : values;
      if (/^\s*SELECT/i.test(sql)) return { results: stmt.all(...params as any[]), success: true, meta: {} };
      const result = stmt.run(...params as any[]);
      writes += Number(result.changes);
      return { results: [], success: true, meta: { changes: Number(result.changes) } };
    }
    return {
      bind(...args: unknown[]) { values = args; return this; },
      async run() { return execute(); },
      async all() { return execute(); },
      async first(column?: string) {
        const row: any = execute().results[0] || null;
        return column && row ? row[column] : row;
      },
      execute,
    };
  }
  const db = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec('BEGIN');
      try { const result = statements.map((s) => s.execute()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { db: db as any, sqlite, get writes() { return writes; } };
}

import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// A retained name tombstone prevents stale clients from auto-registering a deleted account.
export function accountDeleted(username: string): boolean {
    const db = new Database('db.sqlite', { readonly: true });
    try {
        if (!db.query("SELECT 1 FROM sqlite_master WHERE name='panel_deleted_accounts'").get()) return false;
        return !!db.query('SELECT 1 FROM panel_deleted_accounts WHERE username=?').get(username);
    } finally { db.close(true); }
}

export function deleteLocalCharacter(username: string, root = '.', marketPath = 'data/market.sqlite') {
    if (!/^[a-z0-9]{1,12}$/.test(username)) throw new Error('Invalid managed character name');
    const base = realpathSync(root);
    const db = new Database(resolve(base, 'db.sqlite'), { strict: true });
    db.exec('PRAGMA busy_timeout=5000;');
    try {
        const account = db.query<{ id: number }, [string]>('SELECT id FROM account WHERE username=?').get(username);
        if (account && db.query('SELECT 1 FROM account_login WHERE account_id=? AND logged_in<>0').get(account.id))
            throw new Error('Account is still logged in');
        // Validate every file before making the deletion durable. Never follow a save-directory link outside the engine.
        const files: string[] = [];
        const players = resolve(base, 'data/players');
        if (existsSync(players)) for (const profile of readdirSync(players, { withFileTypes: true })) {
            if (!profile.isDirectory()) continue;
            const file = resolve(players, profile.name, `${username}.sav`);
            if (!existsSync(file)) continue;
            if (!realpathSync(file).startsWith(base + sep)) throw new Error('Save path escapes the engine directory');
            files.push(file);
        }
        db.exec(`CREATE TABLE IF NOT EXISTS panel_deleted_accounts(username TEXT PRIMARY KEY);
            CREATE TRIGGER IF NOT EXISTS panel_prevent_reregistration BEFORE INSERT ON account
            WHEN EXISTS(SELECT 1 FROM panel_deleted_accounts WHERE username=NEW.username)
            BEGIN SELECT RAISE(ABORT, 'Account was deleted'); END;`);
        db.query('INSERT OR IGNORE INTO panel_deleted_accounts VALUES(?)').run(username);
        // Retryable: the tombstone remains if filesystem or database cleanup fails.
        for (const file of files) unlinkSync(file);
        const market = resolve(base, marketPath);
        if (existsSync(market)) {
            if (!realpathSync(market).startsWith(base + sep)) throw new Error('Market database must be inside the local engine directory');
            db.query('ATTACH DATABASE ? AS market').run(market);
        }
        db.transaction(() => {
            if (existsSync(market)) {
                db.query('DELETE FROM market.trades WHERE buy_offer IN (SELECT id FROM market.offers WHERE owner=?) OR sell_offer IN (SELECT id FROM market.offers WHERE owner=?)').run(username, username);
                db.query('DELETE FROM market.offers WHERE owner=?').run(username);
                db.query('DELETE FROM market.accounts WHERE owner=?').run(username);
            }
            // Session-linked logs must be deleted before their session rows.
            const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'panel_%'").all();
            const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
            const columns = (name: string) => {
                const statement = db.prepare<{ name: string }, []>(`PRAGMA table_info(${quote(name)})`);
                try { return statement.all().map(c => c.name); } finally { statement.finalize(); }
            };
            const remove = (sql: string, value: string | number) => {
                const statement = db.prepare(sql);
                try { statement.run(value); } finally { statement.finalize(); }
            };
            if (account) for (const { name } of tables) if (columns(name).includes('session_uuid'))
                remove(`DELETE FROM ${quote(name)} WHERE session_uuid IN (SELECT uuid FROM session WHERE account_id=?)`, account.id);
            for (const { name } of tables.filter(t => t.name !== 'account')) {
                const cols = columns(name);
                if (account) for (const col of ['account_id', 'friend_account_id', 'to_account_id']) if (cols.includes(col))
                    remove(`DELETE FROM ${quote(name)} WHERE ${quote(col)}=?`, account.id);
                for (const col of ['username', 'offender']) if (cols.includes(col))
                    remove(`DELETE FROM ${quote(name)} WHERE ${quote(col)}=?`, username);
            }
            db.query('DELETE FROM account WHERE username=?').run(username);
        }).immediate();
    } finally { db.close(true); }
}

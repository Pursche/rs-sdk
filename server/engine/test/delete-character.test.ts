import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { deleteLocalCharacter } from '../src/util/DeleteCharacter';

test('permanent local deletion removes saves, account data and exchange holdings without deleting other accounts', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'engine-delete-'));
    const db = new Database(resolve(root, 'db.sqlite'));
    mkdirSync(resolve(root, 'data/players/main'), { recursive: true });
    const market = new Database(resolve(root, 'data/market.sqlite'));
    try {
        db.exec(`CREATE TABLE account(id INTEGER PRIMARY KEY,username TEXT);
            CREATE TABLE account_login(account_id INTEGER,logged_in INTEGER);
            CREATE TABLE session(uuid TEXT,account_id INTEGER);
            CREATE TABLE public_chat(session_uuid TEXT,message TEXT);
            CREATE TABLE friendlist(account_id INTEGER,friend_account_id INTEGER);
            CREATE TABLE hiscore(account_id INTEGER,value INTEGER);
            CREATE TABLE player_telemetry(username TEXT);
            INSERT INTO account VALUES(1,'deleteme'),(2,'keepme');
            INSERT INTO account_login VALUES(1,1),(2,0);
            INSERT INTO session VALUES('a',1),('b',2);
            INSERT INTO public_chat VALUES('a','one'),('b','two');
            INSERT INTO friendlist VALUES(2,1);
            INSERT INTO hiscore VALUES(1,10),(2,20);
            INSERT INTO player_telemetry VALUES('deleteme'),('keepme');`);
        market.exec(`CREATE TABLE accounts(owner TEXT,save BLOB); CREATE TABLE offers(id INTEGER,owner TEXT);
            CREATE TABLE trades(buy_offer INTEGER,sell_offer INTEGER);
            INSERT INTO accounts VALUES('deleteme',X'01'),('keepme',X'02');
            INSERT INTO offers VALUES(1,'deleteme'),(2,'keepme'); INSERT INTO trades VALUES(1,2);`);
        writeFileSync(resolve(root, 'data/players/main/deleteme.sav'), 'one');
        writeFileSync(resolve(root, 'data/players/main/keepme.sav'), 'two');
        expect(() => deleteLocalCharacter('../bad', root)).toThrow('Invalid');
        expect(() => deleteLocalCharacter('deleteme', root)).toThrow('logged in');
        expect(existsSync(resolve(root, 'data/players/main/deleteme.sav'))).toBe(true);
        db.exec('UPDATE account_login SET logged_in=0');
        deleteLocalCharacter('deleteme', root);
        deleteLocalCharacter('deleteme', root); // Retrying after a lost HTTP response is safe.
        expect(db.query('SELECT username FROM account').all()).toEqual([{ username: 'keepme' }]);
        expect(db.query('SELECT message FROM public_chat').all()).toEqual([{ message: 'two' }]);
        expect(db.query('SELECT * FROM friendlist').all()).toEqual([]);
        expect(db.query('SELECT value FROM hiscore').all()).toEqual([{ value: 20 }]);
        expect(market.query('SELECT owner FROM accounts').all()).toEqual([{ owner: 'keepme' }]);
        expect(market.query('SELECT owner FROM offers').all()).toEqual([{ owner: 'keepme' }]);
        expect(existsSync(resolve(root, 'data/players/main/deleteme.sav'))).toBe(false);
        expect(existsSync(resolve(root, 'data/players/main/keepme.sav'))).toBe(true);
        expect(() => db.query('INSERT INTO account VALUES(3,?)').run('deleteme')).toThrow('deleted');
    } finally { market.close(); db.close(); Bun.gc(true); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

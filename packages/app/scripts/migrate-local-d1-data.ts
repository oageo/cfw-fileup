import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const tables = [
	'plans',
	'global_quotas',
	'app_settings',
	'users',
	'buckets',
	'user_quotas',
	'user_plan_assignments',
	'tokens',
	'oauth_states',
	'directories',
	'files',
	'misskey_accounts',
	'passkeys',
	'backup_codes',
	'passkeys_challenges',
	'moderation_events',
	'moderation_audit_logs',
	'ip_bans',
	'payment_chains',
	'payment_assets',
	'payment_asset_deployments',
	'payment_asset_plan_prices',
	'user_wallets',
	'wallet_link_challenges',
	'crypto_payment_orders',
	'file_reports',
	'file_access_tokens',
	'tar_files',
	'targz_files',
	'upload_parts',
	'used_usernames',
	'used_bucket_names',
] as const;

function usage(): never {
	console.error('Usage: tsx scripts/migrate-local-d1-data.ts <old.sqlite> <new.sqlite>');
	process.exit(1);
}

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) usage();
if (!existsSync(oldPath)) throw new Error(`Old database not found: ${oldPath}`);
if (!existsSync(newPath)) throw new Error(`New database not found: ${newPath}`);

const oldDb = new DatabaseSync(oldPath, { readOnly: true });
const newDb = new DatabaseSync(newPath);

function tableExists(db: DatabaseSync, table: string): boolean {
	return db.prepare('select 1 from sqlite_master where type = ? and name = ?').get('table', table) != null;
}

function columns(db: DatabaseSync, table: string): string[] {
	return db.prepare(`pragma table_info(${table})`).all().map(row => String((row as { name: unknown }).name));
}

function placeholders(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

newDb.exec('pragma foreign_keys = off');
newDb.exec('begin');
try {
	for (const table of [...tables].reverse()) {
		if (tableExists(newDb, table)) newDb.prepare(`delete from ${table}`).run();
	}

	for (const table of tables) {
		if (!tableExists(oldDb, table) || !tableExists(newDb, table)) continue;

		const oldColumns = new Set(columns(oldDb, table));
		const newColumns = columns(newDb, table);
		const insert = newDb.prepare(`insert into ${table} (${newColumns.join(', ')}) values (${placeholders(newColumns.length)})`);
		const rows = oldDb.prepare(`select * from ${table}`).all() as Array<Record<string, unknown>>;

		for (const row of rows) {
			const values = newColumns.map((column): SQLInputValue => {
				if (oldColumns.has(column)) return row[column] as SQLInputValue;
				if (table === 'payment_asset_plan_prices' && column === 'starts_at') return row.created_at as SQLInputValue;
				if (table === 'crypto_payment_orders' && column === 'token_symbol') return row.asset_symbol as SQLInputValue;
				if (table === 'crypto_payment_orders' && column === 'token_name') return row.asset_name as SQLInputValue;
				if (table === 'crypto_payment_orders' && column === 'quote_discount_assignment_ids') return '[]';
				throw new Error(`No source column for ${table}.${column}`);
			});
			insert.run(...values);
		}
		console.log(`${table}: ${rows.length}`);
	}

	newDb.exec('commit');
	console.log(`Migrated ${basename(oldPath)} -> ${basename(newPath)}`);
} catch (error) {
	newDb.exec('rollback');
	throw error;
} finally {
	newDb.exec('pragma foreign_keys = on');
	oldDb.close();
	newDb.close();
}

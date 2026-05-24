import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { users } from './users';
import { binaryBlob } from './binary-blob';

export const passkeys = sqliteTable('passkeys', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	credentialId: binaryBlob('credential_id').notNull().unique(),
	publicKey: binaryBlob('public_key').notNull(),
	counter: integer('counter').notNull().default(0),
	transports: text('transports'), // JSON array string
	name: text('name'),
	createdAt: integer('created_at').notNull(),
});

export const backupCodes = sqliteTable('backup_codes', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	codeHash: binaryBlob('code_hash').notNull(),
	usedAt: integer('used_at'), // null = not used
	createdAt: integer('created_at').notNull(),
});

export const passkeysChallenges = sqliteTable('passkeys_challenges', {
	id: text('id').primaryKey(),
	challenge: binaryBlob('challenge').notNull(),
	userId: text('user_id'), // null for authentication (before we know which user)
	type: text('type').notNull(), // 'register' | 'authenticate'
	expiresAt: integer('expires_at').notNull(),
});

import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { binaryBlob } from './binary-blob';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	email: text('email'),
	emailVerifiedAt: integer('email_verified_at'),
	passwordHash: binaryBlob('password_hash'),
	googleId: text('google_id').unique(),
	misskeyId: text('misskey_id').unique(),
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	isSuspended: integer('is_suspended', { mode: 'boolean' }).notNull().default(false),
	termsAgreedAt: integer('terms_agreed_at'),
	effectiveMaxBuckets: integer('effective_max_buckets'),
	effectiveMaxBucketSizeBytes: integer('effective_max_bucket_size_bytes'),
	effectiveMaxFilesPerBucket: integer('effective_max_files_per_bucket'),
	effectiveMaxDailyUploads: integer('effective_max_daily_uploads'),
	effectiveCanUseDownloadCount: integer('effective_can_use_download_count', { mode: 'boolean' }).notNull().default(false),
	effectiveShowAds: integer('effective_show_ads', { mode: 'boolean' }).notNull().default(true),
	effectiveCanDisableFileAds: integer('effective_can_disable_file_ads', { mode: 'boolean' }).notNull().default(false),
	effectiveQuotaExpiresAt: integer('effective_quota_expires_at'),
	effectiveQuotaUpdatedAt: integer('effective_quota_updated_at'),
	effectiveQuotaSource: text('effective_quota_source'),
}, (table) => [
	uniqueIndex('users_username_lower_unique_idx').on(sql`lower(${table.username})`),
]);

export const tokens = sqliteTable('tokens', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	token: binaryBlob('token').notNull().unique(),
	isRevoked: integer('is_revoked', { mode: 'boolean' }).notNull().default(false),
	reauthenticatedAt: integer('reauthenticated_at'),
}, (table) => [
	index('tokens_user_id_id_idx').on(table.userId, table.id),
	index('tokens_user_id_is_revoked_idx').on(table.userId, table.isRevoked),
]);

export const oauthStates = sqliteTable('oauth_states', {
	id: text('id').primaryKey(),
	state: binaryBlob('state').notNull().unique(),
	codeVerifier: binaryBlob('code_verifier'),
	profileUrl: text('profile_url'),
	linkUserId: text('link_user_id').references(() => users.id, { onDelete: 'cascade' }),
	signupPassphrase: text('signup_passphrase'),
	signupUsername: text('signup_username'),
	expiresAt: integer('expires_at').notNull(),
});

export const emailVerificationTokens = sqliteTable('email_verification_tokens', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	email: text('email').notNull(),
	token: binaryBlob('token').notNull().unique(),
	expiresAt: integer('expires_at').notNull(),
	createdAt: integer('created_at').notNull(),
	usedAt: integer('used_at'),
}, (table) => [
	index('email_verification_tokens_user_id_idx').on(table.userId),
	index('email_verification_tokens_expires_at_idx').on(table.expiresAt),
]);

export const emailNotificationEvents = sqliteTable('email_notification_events', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	eventKey: text('event_key').notNull(),
	type: text('type', { enum: ['login', 'purchase_receipt', 'quota_exceeded'] }).notNull(),
	createdAt: integer('created_at').notNull(),
}, (table) => [
	uniqueIndex('email_notification_events_user_event_key_idx').on(table.userId, table.eventKey),
	index('email_notification_events_user_type_idx').on(table.userId, table.type),
]);

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { binaryBlob } from './binary-blob';

export const users = sqliteTable('users', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
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
	effectiveQuotaExpiresAt: integer('effective_quota_expires_at'),
	effectiveQuotaUpdatedAt: integer('effective_quota_updated_at'),
	effectiveQuotaSource: text('effective_quota_source'),
});

export const tokens = sqliteTable('tokens', {
	id: text('id').primaryKey(),
	userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	token: binaryBlob('token').notNull().unique(),
	isRevoked: integer('is_revoked', { mode: 'boolean' }).notNull().default(false),
	reauthenticatedAt: integer('reauthenticated_at'),
});

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

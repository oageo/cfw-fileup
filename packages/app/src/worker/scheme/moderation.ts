import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { users, tokens } from './users';

export const moderationEvents = sqliteTable('moderation_events', {
	id: text('id').primaryKey(),
	userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
	userTokenId: text('user_token_id').references(() => tokens.id, { onDelete: 'set null' }),
	action: text('action').notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	data: text('data', { mode: 'json' }).$type<Record<string, unknown> | null>(),
}, (table) => [
	index('moderation_events_user_token_id_id_idx').on(table.userTokenId, table.id),
]);

export const ipBans = sqliteTable('ip_bans', {
	id: text('id').primaryKey(),
	cidr: text('cidr').notNull().unique(),
	reason: text('reason'),
	sourceEventId: text('source_event_id').references(() => moderationEvents.id, { onDelete: 'set null' }),
	createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
	expiresAt: integer('expires_at'),
});

export const moderationAuditLogs = sqliteTable('moderation_audit_logs', {
	id: text('id').primaryKey(),
	adminUserId: text('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
	action: text('action').notNull(),
	targetFileId: text('target_file_id'),
	targetUserId: text('target_user_id').references(() => users.id, { onDelete: 'set null' }),
	data: text('data', { mode: 'json' }).$type<Record<string, unknown> | null>(),
}, (table) => [
	index('moderation_audit_logs_admin_user_id_id_idx').on(table.adminUserId, table.id),
	index('moderation_audit_logs_target_file_id_id_idx').on(table.targetFileId, table.id),
	index('moderation_audit_logs_target_user_id_id_idx').on(table.targetUserId, table.id),
]);

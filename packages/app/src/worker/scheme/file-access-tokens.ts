import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { files } from './files';
import { binaryBlob } from './binary-blob';

export const fileAccessTokens = sqliteTable('file_access_tokens', {
	id: text('id').primaryKey(),
	fileId: text('file_id').notNull().references(() => files.id, { onDelete: 'cascade' }),
	token: binaryBlob('token').notNull().unique(),
	expiresAt: integer('expires_at'),
}, (table) => [
	index('file_access_tokens_file_id_id_idx').on(table.fileId, table.id),
]);

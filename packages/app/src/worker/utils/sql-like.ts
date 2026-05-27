import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

type LikeColumn = SQL | SQLWrapper;

export function escapeLikePattern(value: string): string {
	return value
		.replaceAll('\\', '\\\\')
		.replaceAll('%', '\\%')
		.replaceAll('_', '\\_');
}

export function prefixLikePattern(prefix: string): string {
	return `${escapeLikePattern(prefix)}%`;
}

export function likePrefix(column: LikeColumn, prefix: string): SQL {
	return sql`${column} LIKE ${prefixLikePattern(prefix)} ESCAPE ${'\\'}`;
}

export function notLikePrefix(column: LikeColumn, prefix: string): SQL {
	return sql`${column} NOT LIKE ${prefixLikePattern(prefix)} ESCAPE ${'\\'}`;
}

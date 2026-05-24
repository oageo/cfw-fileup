export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export type PageInput = {
	limit?: number;
	cursor?: string | null;
};

export type PageResult<T> = {
	items: T[];
	nextCursor: string | null;
	hasMore: boolean;
};

export function pageParams(input: PageInput): { limit: number; cursor: string | null } {
	const rawLimit = Number.isFinite(input.limit) ? input.limit : DEFAULT_PAGE_LIMIT;
	const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(rawLimit ?? DEFAULT_PAGE_LIMIT)));
	return {
		limit,
		cursor: input.cursor ?? null,
	};
}

export function idPage<T extends { id: string }, U>(
	rows: T[],
	limit: number,
	mapper: (row: T) => U,
): PageResult<U> {
	const items = rows.slice(0, limit).map(mapper);
	return {
		items,
		nextCursor: rows.length > limit ? rows[limit - 1]?.id ?? null : null,
		hasMore: rows.length > limit,
	};
}

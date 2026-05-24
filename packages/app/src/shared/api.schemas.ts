import * as v from 'valibot';
import { MAX_ID_LENGTH } from './const.js';
import { apiErrorCodes, type ApiErrorCode } from './api-errors.js';

export const IdString = v.pipe(
	v.string(),
	v.maxLength(MAX_ID_LENGTH),
	v.metadata({ ref: 'IdString' }),
);

export const PageRequestFields = {
	limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)), 50),
	cursor: v.optional(v.nullable(v.string()), null),
} as const;

export const PageRequestSchema = v.pipe(
	v.object(PageRequestFields),
	v.metadata({ ref: 'PageRequest' }),
);

export function pagedResponse<ItemSchema extends v.GenericSchema>(itemSchema: ItemSchema) {
	return v.object({
		items: v.array(itemSchema),
		nextCursor: v.nullable(v.string()),
		hasMore: v.boolean(),
	});
}

export function createErrorResponseSchema<const Codes extends readonly [ApiErrorCode, ...ApiErrorCode[]]>(codes: Codes) {
	return v.object({
		error: v.picklist(codes),
		message: v.string(),
	});
}

export function errorResponse<const Codes extends readonly [ApiErrorCode, ...ApiErrorCode[]]>(
	description: string,
	codes: Codes = apiErrorCodes as unknown as Codes,
) {
	return {
		description,
		content: {
			'application/json': {
				vSchema: createErrorResponseSchema(codes),
			},
		},
	};
}

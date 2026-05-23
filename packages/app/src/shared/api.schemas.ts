import * as v from 'valibot';
import { MAX_ID_LENGTH } from './const.js';
import { apiErrorCodes, type ApiErrorCode } from './api-errors.js';

export const IdString = v.pipe(
	v.string(),
	v.maxLength(MAX_ID_LENGTH),
	v.metadata({ ref: 'IdString' }),
);

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

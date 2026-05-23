import * as v from 'valibot';
import { MAX_ID_LENGTH } from './const.js';
import { apiErrorMessages } from './api-errors.js';

export const IdString = v.pipe(
	v.string(),
	v.maxLength(MAX_ID_LENGTH),
	v.metadata({ ref: 'IdString' }),
);

export const ErrorResponse = v.pipe(
	v.object({
		error: v.picklist(Object.keys(apiErrorMessages) as [keyof typeof apiErrorMessages, ...(keyof typeof apiErrorMessages)[]]),
		message: v.string(),
	}),
	v.metadata({ ref: 'ErrorResponse' }),
);

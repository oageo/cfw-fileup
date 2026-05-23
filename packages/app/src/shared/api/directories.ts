import * as v from 'valibot';
import { errorResponse, IdString } from '../api.schemas.js';
import { MAX_FILE_PATH_LENGTH } from '../const.js';
import { directoryPathValidation } from '../name-validation.js';
import type { ApiEndpointDefinitionRecord } from '../api.types.js';

export const directoriesApiDef = {
	'/api/directories/create': {
		summary: 'Create a directory',
		tags: ['directories'],
		req: v.object({
			bucketId: IdString,
			path: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_FILE_PATH_LENGTH), directoryPathValidation),
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ ok: v.literal(true) }) } } },
			400: errorResponse('Bad request (missing bucketId or path)', ['INVALID_DIRECTORY_PATH']),
			404: errorResponse('Bucket not found', ['BUCKET_NOT_FOUND']),
		},
	},
	'/api/directories/delete': {
		summary: 'Delete a directory',
		tags: ['directories'],
		req: v.object({
			bucketId: IdString,
			path: v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_FILE_PATH_LENGTH)),
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ ok: v.literal(true) }) } } },
			400: errorResponse('Bad request (missing bucketId or path)', ['INVALID_DIRECTORY_PATH']),
			404: errorResponse('Bucket not found', ['BUCKET_NOT_FOUND']),
		},
	},
} as const satisfies ApiEndpointDefinitionRecord;

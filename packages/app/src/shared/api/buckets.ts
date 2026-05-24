import * as v from 'valibot';
import { errorResponse, IdString } from '../api.schemas.js';
import { nameFormatValidation } from '../name-validation.js';
import { MAX_BUCKET_NAME_LENGTH } from '../const.js';
import type { ApiEndpointDefinitionRecord } from '../api.types.js';

export const bucketsApiDef = {
	'/api/buckets/create': {
		summary: 'Create a bucket',
		tags: ['buckets'],
		req: v.object({
			bucketName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_BUCKET_NAME_LENGTH), nameFormatValidation),
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ bucketId: v.string() }) } } },
			400: errorResponse('Bad request (invalid bucket name)', ['BUCKET_NAME_IS_REQUIRED', 'INVALID_FILE_PATH']),
			409: errorResponse('Bucket name already exists', ['BUCKET_NAME_ALREADY_EXISTS']),
			429: errorResponse('Bucket limit exceeded', ['BUCKET_LIMIT_EXCEEDED']),
		},
	},
	'/api/buckets/delete': {
		summary: 'Delete a bucket',
		tags: ['buckets'],
		req: v.object({
			bucketId: IdString,
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ ok: v.literal(true) }) } } },
			400: errorResponse('Bad request (missing bucketId)', ['BUCKET_NOT_FOUND']),
			404: errorResponse('Bucket not found', ['BUCKET_NOT_FOUND']),
		},
	},
	'/api/buckets/list': {
		summary: 'List buckets',
		tags: ['buckets'],
		req: v.object({}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({
				buckets: v.array(v.object({ id: v.string(), name: v.string(), usedBytes: v.number() })),
				maxBucketSizeBytes: v.nullable(v.number()),
				canUseDownloadCount: v.boolean(),
			}) } } },
		},
	},
} as const satisfies ApiEndpointDefinitionRecord;

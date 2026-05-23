import * as v from 'valibot';
import { errorResponse, IdString } from '../api.schemas.js';
import { MAX_BUCKET_NAME_LENGTH, MAX_FILE_PATH_LENGTH, MAX_PASSPHRASE_LENGTH, MAX_TURNSTILE_TOKEN_LENGTH } from '../const.js';
import type { ApiEndpointDefinitionRecord } from '../api.types.js';

const BucketNameString = v.pipe(v.string(), v.maxLength(MAX_BUCKET_NAME_LENGTH));
const FilePathString = v.pipe(v.string(), v.maxLength(MAX_FILE_PATH_LENGTH));

export const fileTokensApiDef = {
	'/api/file-tokens/create': {
		summary: 'Create a file access token',
		tags: ['file-tokens'],
		req: v.object({
			bucketName: BucketNameString,
			filePath: FilePathString,
			expiresIn: v.nullable(v.number()),
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ id: v.string(), token: v.string(), expiresAt: v.nullable(v.number()) }) } } },
			400: errorResponse('Bad request (invalid expiresIn, file not closed, or file is public)', ['FILE_IS_NOT_CLOSED', 'CANNOT_CREATE_TOKEN_FOR_PUBLIC_FILE']),
			404: errorResponse('Bucket or file not found', ['BUCKET_NOT_FOUND', 'FILE_NOT_FOUND']),
		},
	},
	'/api/file-tokens/list': {
		summary: 'List file access tokens',
		tags: ['file-tokens'],
		req: v.object({
			bucketName: BucketNameString,
			filePath: FilePathString,
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({
				tokens: v.array(v.object({ id: v.string(), expiresAt: v.nullable(v.number()), createdAt: v.number() })),
			}) } } },
			400: errorResponse('Bad request (missing fields)', ['BUCKET_NAME_IS_REQUIRED']),
			404: errorResponse('Bucket or file not found', ['BUCKET_NOT_FOUND', 'FILE_NOT_FOUND']),
		},
	},
	'/api/file-tokens/delete': {
		summary: 'Delete a file access token',
		tags: ['file-tokens'],
		req: v.object({
			tokenId: IdString,
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ ok: v.literal(true) }) } } },
			400: errorResponse('Bad request (missing tokenId)', ['TOKEN_IS_REQUIRED']),
			404: errorResponse('Token not found', ['TOKEN_NOT_FOUND']),
		},
	},
	'/api/file-tokens/create-by-passphrase': {
		summary: 'Create a file access token by passphrase',
		tags: ['file-tokens'],
		req: v.object({
			bucketName: BucketNameString,
			filePath: FilePathString,
			passphrase: v.pipe(v.string(), v.maxLength(MAX_PASSPHRASE_LENGTH)),
			turnstileToken: v.optional(v.pipe(v.string(), v.maxLength(MAX_TURNSTILE_TOKEN_LENGTH))),
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ id: v.string(), token: v.string(), expiresAt: v.number(), fileId: v.string() }) } } },
			400: errorResponse('Bad request (missing fields, Turnstile verification failed, file not closed, or file is public)', ['TOKEN_IS_REQUIRED', 'TURNSTILE_TOKEN_IS_REQUIRED', 'TURNSTILE_VERIFICATION_FAILED', 'FILE_IS_NOT_CLOSED', 'CANNOT_CREATE_TOKEN_FOR_PUBLIC_FILE']),
			403: errorResponse('Forbidden (no passphrase set or invalid passphrase)', ['NO_PASSPHRASE_SET_FOR_THIS_FILE', 'INVALID_PASSPHRASE']),
			404: errorResponse('Bucket or file not found', ['BUCKET_NOT_FOUND', 'FILE_NOT_FOUND']),
		},
	},
} as const satisfies ApiEndpointDefinitionRecord;

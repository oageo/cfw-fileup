import * as v from 'valibot';
import { ErrorResponse } from '../api.schemas.js';
import { nameFormatValidation } from '../name-validation.js';
import { MAX_PASSPHRASE_LENGTH, MAX_USERNAME_LENGTH } from '../const.js';
import type { ApiEndpointDefinitionRecord } from '../api.types.js';

export const accountApiDef = {
	'/api/account/me': {
		summary: 'Get account info from authentication information',
		tags: ['account'],
		req: v.object({}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ id: v.string(), username: v.string(), isAdmin: v.boolean(), termsAgreedAt: v.nullable(v.number()) }) } } },
		},
	},
	'/api/account/agree-terms': {
		summary: 'Record terms agreement',
		tags: ['account'],
		req: v.object({ agreedAt: v.number() }),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ ok: v.literal(true), termsAgreedAt: v.number() }) } } },
		},
	},
	'/api/account/update': {
		summary: 'Update account info',
		tags: ['account'],
		req: v.object({
			username: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_USERNAME_LENGTH), nameFormatValidation)),
			newPassword: v.optional(v.pipe(v.string(), v.minLength(8), v.maxLength(MAX_PASSPHRASE_LENGTH))),
			currentPassword: v.pipe(v.string(), v.maxLength(MAX_PASSPHRASE_LENGTH)),
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ ok: v.literal(true) }) } } },
			400: { description: 'Bad request (missing currentPassword or password too short)', content: { 'application/json': { vSchema: ErrorResponse } } },
			404: { description: 'User not found', content: { 'application/json': { vSchema: ErrorResponse } } },
			409: { description: 'Username already exists', content: { 'application/json': { vSchema: ErrorResponse } } },
		},
	},
} as const satisfies ApiEndpointDefinitionRecord;

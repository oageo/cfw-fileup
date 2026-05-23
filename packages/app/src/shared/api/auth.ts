import * as v from 'valibot';
import { errorResponse } from '../api.schemas.js';
import { nameFormatValidation } from '../name-validation.js';
import { MAX_PASSPHRASE_LENGTH, MAX_TURNSTILE_TOKEN_LENGTH, MAX_USERNAME_LENGTH } from '../const.js';
import type { ApiEndpointDefinitionRecord } from '../api.types.js';

export const authApiDef = {
	'/api/signup': {
		summary: 'Sign up',
		tags: ['auth'],
		req: v.object({
			username: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_USERNAME_LENGTH), nameFormatValidation),
			password: v.pipe(v.string(), v.minLength(8), v.maxLength(MAX_PASSPHRASE_LENGTH)),
			passphrase: v.optional(v.pipe(v.string(), v.maxLength(MAX_PASSPHRASE_LENGTH))),
			turnstileToken: v.optional(v.pipe(v.string(), v.maxLength(MAX_TURNSTILE_TOKEN_LENGTH))),
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ userId: v.string(), token: v.string() }) } } },
			400: errorResponse('Bad request (missing fields, invalid username/password, or Turnstile failure)', ['INVALID_USERNAME_FORMAT', 'INVALID_PASSWORD', 'PASSPHRASE_TOO_LONG', 'TURNSTILE_TOKEN_IS_REQUIRED', 'TURNSTILE_VERIFICATION_FAILED']),
			403: errorResponse('Forbidden (invalid passphrase or registration closed)', ['INVALID_PASSPHRASE', 'REGISTRATION_IS_CLOSED', 'ONLY_GOOGLE_ACCOUNT_REGISTRATION_IS_ALLOWED']),
			409: errorResponse('Username already exists', ['USERNAME_ALREADY_EXISTS']),
		},
	},
	'/api/signin': {
		summary: 'Sign in',
		tags: ['auth'],
		req: v.object({
			username: v.pipe(v.string(), v.maxLength(MAX_USERNAME_LENGTH)),
			password: v.pipe(v.string(), v.maxLength(MAX_PASSPHRASE_LENGTH)),
			backupCode: v.optional(v.pipe(v.string(), v.maxLength(128))),
			turnstileToken: v.optional(v.pipe(v.string(), v.maxLength(MAX_TURNSTILE_TOKEN_LENGTH))),
		}),
		res: {
			200: { description: 'Success', content: { 'application/json': { vSchema: v.object({ token: v.string() }) } } },
			400: errorResponse('Bad request (missing fields or Turnstile failure)', ['TURNSTILE_TOKEN_IS_REQUIRED', 'TURNSTILE_VERIFICATION_FAILED', 'BACKUP_CODE_REQUIRED']),
			401: errorResponse('Invalid credentials or account suspended', ['INVALID_CREDENTIALS', 'INVALID_CREDENTIALS_OR_CODE', 'ACCOUNT_IS_SUSPENDED', 'ONLY_GOOGLE_ACCOUNT_SIGN_IN_IS_ALLOWED']),
		},
	},
} as const satisfies ApiEndpointDefinitionRecord;

import { apiError } from './api-error';

export type RateLimitBindingName =
	| 'AUTH_RATE_LIMITER'
	| 'FILE_PASSPHRASE_RATE_LIMITER'
	| 'PUBLIC_FORM_RATE_LIMITER';

export async function assertRateLimit(env: Env, bindingName: RateLimitBindingName, key: string): Promise<void> {
	const limiter = (env as Partial<Record<RateLimitBindingName, RateLimit>>)[bindingName];
	if (!limiter) return;
	const { success } = await limiter.limit({ key });
	if (!success) throw apiError(429, 'RATE_LIMITED');
}

export function rateLimitKey(...parts: Array<string | number | null | undefined>): string {
	return parts.map(part => String(part ?? 'unknown')).join(':');
}

import { gt, isNull, or } from 'drizzle-orm';
import { genEaidx } from '../../shared/eaid-x';
import { ipBans, moderationEvents } from '../scheme/index';
import { apiError } from './api-error';
import { getDb } from './db';
import { getRequestIp } from './request-ip';
import { ipMatchesCidr } from './cidr';
import type { Context } from 'hono';

export type ModerationAction =
	| 'user_token_created'
	| 'file_uploaded'
	| 'file_renamed'
	| 'file_deleted'
	| 'file_token_created';

export async function recordModerationEvent(
	c: Context<{ Bindings: Env }>,
	action: ModerationAction,
	data: Record<string, unknown> | null = null,
	userId?: string | null,
	userTokenId?: string | null,
): Promise<void> {
	const db = getDb(c.env);
	await db.insert(moderationEvents).values({
		id: genEaidx(Date.now()),
		userId: userId ?? null,
		userTokenId: userTokenId ?? null,
		action,
		ipAddress: getRequestIp(c.req),
		userAgent: c.req.header('User-Agent') ?? null,
		data,
	});
}

export async function rejectIpBan(c: Context<{ Bindings: Env }>): Promise<void> {
	const ipAddress = getRequestIp(c.req);
	if (!ipAddress) return;

	const db = getDb(c.env);
	const rows = await db
		.select({ cidr: ipBans.cidr })
		.from(ipBans)
		.where(or(isNull(ipBans.expiresAt), gt(ipBans.expiresAt, Date.now())));

	for (const row of rows) {
		if (ipMatchesCidr(ipAddress, row.cidr)) {
			throw apiError(403, 'IP_BANNED');
		}
	}
}

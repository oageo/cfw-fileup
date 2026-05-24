import { Hono } from 'hono';
import { describeResponse, describeRoute, validator } from 'hono-openapi';
import { and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { users, usedUsernames, tokens, moderationEvents } from '../scheme/index';
import { getDb } from '../utils/db';
import { authMiddleware } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { validateUsername } from '../utils/name-validation';
import { apiDef, getResponseDefWithAuth } from '../../shared/api';
import { omitResAndReq } from '../utils/omit';
import { apiError } from '../utils/api-error';
import { parseEaidx } from '../../shared/eaid-x';
import { idPage, pageParams } from '../utils/pagination';
import { getEffectiveQuotaForUser } from '../utils/rate-limit';
import type { JsonCtx } from '../../shared/api';

const app = new Hono<{ Bindings: Env }>();

app.use(authMiddleware);

app.post(
	'/me',
	describeRoute(omitResAndReq(apiDef['/api/account/me'])),
	validator('json', apiDef['/api/account/me'].req),
	describeResponse(async (c) => {
		const user = c.get('user');
		return c.json({
			id: user.id,
			username: user.username,
			isAdmin: user.isAdmin,
			termsAgreedAt: user.termsAgreedAt,
		}, 200);
	}, getResponseDefWithAuth('/api/account/me')),
);

app.post(
	'/agree-terms',
	describeRoute(omitResAndReq(apiDef['/api/account/agree-terms'])),
	validator('json', apiDef['/api/account/agree-terms'].req),
	describeResponse(async (c: JsonCtx<'/api/account/agree-terms', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');
		await db.update(users).set({ termsAgreedAt: body.agreedAt }).where(eq(users.id, user.id));
		return c.json({ ok: true, termsAgreedAt: body.agreedAt }, 200);
	}, getResponseDefWithAuth('/api/account/agree-terms')),
);

app.post(
	'/effective-quota',
	describeRoute(omitResAndReq(apiDef['/api/account/effective-quota'])),
	validator('json', apiDef['/api/account/effective-quota'].req),
	describeResponse(async (c: JsonCtx<'/api/account/effective-quota', Env>) => {
		const user = c.get('user');
		const quota = await getEffectiveQuotaForUser(c.env, user.id);
		return c.json(quota, 200);
	}, getResponseDefWithAuth('/api/account/effective-quota')),
);

app.post(
	'/update',
	describeRoute(omitResAndReq(apiDef['/api/account/update'])),
	validator('json', apiDef['/api/account/update'].req),
	describeResponse(async (c: JsonCtx<'/api/account/update', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');

		if (!body.currentPassword) {
			throw apiError(400, 'CURRENT_PASSWORD_IS_REQUIRED');
		}

		const userRecord = await db.select().from(users).where(eq(users.id, user.id)).get();

		if (!userRecord) {
			throw apiError(404, 'USER_NOT_FOUND');
		}

		if (!userRecord.passwordHash) {
			throw apiError(401, 'INVALID_PASSWORD');
		}
		const passwordValid = await verifyPassword(body.currentPassword, userRecord.passwordHash);
		if (!passwordValid) {
			throw apiError(401, 'INVALID_PASSWORD');
		}

		if (body.username) {
			const newUsername = body.username.trim();

			if (newUsername.length < 1 || newUsername.length > 32) {
				throw apiError(400, 'INVALID_USERNAME_FORMAT', 'username must be 1-32 characters');
			}

			if (newUsername.toLowerCase() !== userRecord.username.toLowerCase()) {
				// 文字種・禁止ワード・重複（大文字小文字を区別しない）チェック
				const usernameError = await validateUsername(db, newUsername);
				if (usernameError) {
					const status = usernameError === 'Username already exists' ? 409 : 400;
					throw apiError(status, usernameError === 'Username already exists' ? 'USERNAME_ALREADY_EXISTS' : 'INVALID_USERNAME_FORMAT', usernameError);
				}

				await db.update(users).set({ username: newUsername }).where(eq(users.id, user.id));

				// lowercaseで used_usernames に登録（削除後も同名再利用不可）
				await db
					.insert(usedUsernames)
					.values({ username: newUsername.toLowerCase() })
					.onConflictDoNothing();
			}
		}

		if (body.newPassword) {
			if (body.newPassword.length < 8) {
				throw apiError(400, 'INVALID_PASSWORD', 'password must be at least 8 characters');
			}

			const passwordHash = await hashPassword(body.newPassword);
			await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
		}

		return c.json({ ok: true }, 200);
	}, getResponseDefWithAuth('/api/account/update')),
);

app.post(
	'/tokens',
	describeRoute(omitResAndReq(apiDef['/api/account/tokens'])),
	validator('json', apiDef['/api/account/tokens'].req),
	describeResponse(async (c: JsonCtx<'/api/account/tokens', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const { limit, cursor } = pageParams(c.req.valid('json'));
		const rows = await db
			.select({
				id: tokens.id,
				isRevoked: tokens.isRevoked,
			})
			.from(tokens)
			.where(cursor ? and(eq(tokens.userId, user.id), lt(tokens.id, cursor)) : eq(tokens.userId, user.id))
			.orderBy(desc(tokens.id))
			.limit(limit + 1);
		const pageRows = rows.slice(0, limit);
		const tokenIds = pageRows.map(token => token.id);
		const latestEventIds = tokenIds.length === 0
			? []
			: await db
				.select({
					id: sql<string>`max(${moderationEvents.id})`,
				})
				.from(moderationEvents)
				.where(inArray(moderationEvents.userTokenId, tokenIds))
				.groupBy(moderationEvents.userTokenId);
		const latestEvents = latestEventIds.length === 0
			? []
			: await db
				.select({
					userTokenId: moderationEvents.userTokenId,
					ipAddress: moderationEvents.ipAddress,
				})
				.from(moderationEvents)
				.where(inArray(moderationEvents.id, latestEventIds.map(event => event.id)));
		const lastIpByTokenId = new Map<string, string | null>();
		for (const event of latestEvents) {
			if (event.userTokenId === null || lastIpByTokenId.has(event.userTokenId)) continue;
			lastIpByTokenId.set(event.userTokenId, event.ipAddress);
		}

		return c.json({
			...idPage(rows, limit, token => ({
				id: token.id,
				createdAt: parseEaidx(token.id).date.getTime(),
				lastIpAddress: lastIpByTokenId.get(token.id) ?? null,
				isCurrent: token.id === user.tokenId,
				isRevoked: token.isRevoked,
			})),
		}, 200);
	}, getResponseDefWithAuth('/api/account/tokens')),
);

app.post(
	'/tokens/revoke-all',
	describeRoute(omitResAndReq(apiDef['/api/account/tokens/revoke-all'])),
	validator('json', apiDef['/api/account/tokens/revoke-all'].req),
	describeResponse(async (c: JsonCtx<'/api/account/tokens/revoke-all', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const [{ revokedCount }] = await db
			.select({ revokedCount: count() })
			.from(tokens)
			.where(and(eq(tokens.userId, user.id), eq(tokens.isRevoked, false)));

		await db
			.update(tokens)
			.set({ isRevoked: true })
			.where(and(eq(tokens.userId, user.id), eq(tokens.isRevoked, false)));

		return c.json({ ok: true, revokedCount }, 200);
	}, getResponseDefWithAuth('/api/account/tokens/revoke-all')),
);

export const accountRoutes = app;

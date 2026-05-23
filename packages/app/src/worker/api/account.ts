import { Hono } from 'hono';
import { describeResponse, describeRoute, validator } from 'hono-openapi';
import { eq } from 'drizzle-orm';
import { users, usedUsernames } from '../scheme/index';
import { getDb } from '../utils/db';
import { authMiddleware } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { validateUsername } from '../utils/name-validation';
import { apiDef, getResponseDefWithAuth } from '../../shared/api';
import { omitResAndReq } from '../utils/omit';
import { apiError } from '../utils/api-error';
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

export const accountRoutes = app;

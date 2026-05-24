import { Hono } from 'hono';
import { describeResponse, describeRoute, validator } from 'hono-openapi';
import { eq, and, desc, lt } from 'drizzle-orm';
import { buckets, files, fileAccessTokens } from '../scheme/index';
import { getDb } from '../utils/db';
import { generateToken, tokenToDigest, verifyPassword } from '../utils/crypto';
import { genEaidx, parseEaidx } from '../../shared/eaid-x';
import { authMiddleware } from '../middleware/auth';
import { apiDef, getResponseDefWithAuth, type JsonCtx } from '../../shared/api';
import { omitResAndReq } from '../utils/omit';
import { verifyTurnstile } from '../utils/turnstile';
import { apiError } from '../utils/api-error';
import { recordModerationEvent } from '../utils/moderation';
import { idPage, pageParams } from '../utils/pagination';

const app = new Hono<{ Bindings: Env }>();

app.post(
	'/create',
	authMiddleware,
	describeRoute(omitResAndReq(apiDef['/api/file-tokens/create'])),
	validator('json', apiDef['/api/file-tokens/create'].req),
	describeResponse(async (c: JsonCtx<'/api/file-tokens/create', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');

		if (body.expiresIn !== null && body.expiresIn <= 0) {
			throw apiError(400, 'TOKEN_IS_REQUIRED', 'expiresIn must be a positive number or null');
		}

		const bucket = await db.select().from(buckets).where(eq(buckets.name, body.bucketName)).get();
		if (!bucket) throw apiError(404, 'BUCKET_NOT_FOUND');
		if (bucket.userId !== user.id && !user.isAdmin) throw apiError(403, 'FORBIDDEN');

		const file = await db
			.select()
			.from(files)
			.where(and(eq(files.bucketId, bucket.id), eq(files.path, body.filePath)))
			.get();
		if (!file) throw apiError(404, 'FILE_NOT_FOUND');
		if (!file.isClosed) throw apiError(400, 'FILE_IS_NOT_CLOSED');
		if (file.visibility === 'public') throw apiError(400, 'CANNOT_CREATE_TOKEN_FOR_PUBLIC_FILE');

		const id = genEaidx(Date.now());
		const token = generateToken();
		const tokenBytes = await tokenToDigest(token);
		if (tokenBytes === null) throw apiError(500, 'INTERNAL_SERVER_ERROR');
		const expiresAt = body.expiresIn != null ? Date.now() + body.expiresIn * 1000 : null;

		await db.insert(fileAccessTokens).values({ id, fileId: file.id, token: tokenBytes, expiresAt });
		await recordModerationEvent(c, 'file_token_created', {
			tokenId: id,
			fileId: file.id,
			bucketId: bucket.id,
			bucketName: bucket.name,
			filePath: file.path,
			expiresAt,
			method: 'authenticated',
		}, user.id, user.tokenId);

		return c.json({ id, token, expiresAt }, 200);
	}, getResponseDefWithAuth('/api/file-tokens/create')),
);

app.post(
	'/list',
	authMiddleware,
	describeRoute(omitResAndReq(apiDef['/api/file-tokens/list'])),
	validator('json', apiDef['/api/file-tokens/list'].req),
	describeResponse(async (c: JsonCtx<'/api/file-tokens/list', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');
		const { limit, cursor } = pageParams(body);

		const bucket = await db.select().from(buckets).where(eq(buckets.name, body.bucketName)).get();
		if (!bucket) throw apiError(404, 'BUCKET_NOT_FOUND');
		if (bucket.userId !== user.id && !user.isAdmin) throw apiError(403, 'FORBIDDEN');

		const file = await db
			.select()
			.from(files)
			.where(and(eq(files.bucketId, bucket.id), eq(files.path, body.filePath)))
			.get();
		if (!file) throw apiError(404, 'FILE_NOT_FOUND');

		const rows = await db
			.select()
			.from(fileAccessTokens)
			.where(cursor ? and(eq(fileAccessTokens.fileId, file.id), lt(fileAccessTokens.id, cursor)) : eq(fileAccessTokens.fileId, file.id))
			.orderBy(desc(fileAccessTokens.id))
			.limit(limit + 1);

		return c.json(idPage(rows, limit, r => ({
			id: r.id,
			expiresAt: r.expiresAt,
			createdAt: parseEaidx(r.id).date.getTime(),
		})), 200);
	}, getResponseDefWithAuth('/api/file-tokens/list')),
);

app.post(
	'/delete',
	authMiddleware,
	describeRoute(omitResAndReq(apiDef['/api/file-tokens/delete'])),
	validator('json', apiDef['/api/file-tokens/delete'].req),
	describeResponse(async (c: JsonCtx<'/api/file-tokens/delete', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');

		const row = await db
			.select({
				tokenId: fileAccessTokens.id,
				fileId: fileAccessTokens.fileId,
				bucketUserId: buckets.userId,
			})
			.from(fileAccessTokens)
			.innerJoin(files, eq(fileAccessTokens.fileId, files.id))
			.innerJoin(buckets, eq(files.bucketId, buckets.id))
			.where(eq(fileAccessTokens.id, body.tokenId))
			.get();

		if (!row) throw apiError(404, 'TOKEN_NOT_FOUND');
		if (row.bucketUserId !== user.id && !user.isAdmin) throw apiError(403, 'FORBIDDEN');

		await db.delete(fileAccessTokens).where(eq(fileAccessTokens.id, body.tokenId));

		return c.json({ ok: true }, 200);
	}, getResponseDefWithAuth('/api/file-tokens/delete')),
);

app.post(
	'/create-by-passphrase',
	describeRoute(omitResAndReq(apiDef['/api/file-tokens/create-by-passphrase'])),
	validator('json', apiDef['/api/file-tokens/create-by-passphrase'].req),
	describeResponse(async (c: JsonCtx<'/api/file-tokens/create-by-passphrase', Env>) => {
		const db = getDb(c.env);
		const body = c.req.valid('json');

		const turnstileSecret = c.env.TURNSTILE_SECRET as string;
		if (turnstileSecret !== '') {
			if (!body.turnstileToken) {
				throw apiError(400, 'TURNSTILE_TOKEN_IS_REQUIRED');
			}
			const ok = await verifyTurnstile(body.turnstileToken, turnstileSecret);
			if (!ok) {
				throw apiError(400, 'TURNSTILE_VERIFICATION_FAILED');
			}
		}

		const bucket = await db.select().from(buckets).where(eq(buckets.name, body.bucketName)).get();
		if (!bucket) throw apiError(404, 'BUCKET_NOT_FOUND');

		const file = await db
			.select()
			.from(files)
			.where(and(eq(files.bucketId, bucket.id), eq(files.path, body.filePath)))
			.get();
		if (!file) throw apiError(404, 'FILE_NOT_FOUND');
		if (!file.isClosed) throw apiError(400, 'FILE_IS_NOT_CLOSED');
		if (file.visibility !== 'passphrase') throw apiError(403, 'NO_PASSPHRASE_SET_FOR_THIS_FILE');
		if (file.passphraseHash === null || !await verifyPassword(body.passphrase, file.passphraseHash)) {
			throw apiError(403, 'INVALID_PASSPHRASE');
		}

		const id = genEaidx(Date.now());
		const token = generateToken();
		const tokenBytes = await tokenToDigest(token);
		if (tokenBytes === null) throw apiError(500, 'INTERNAL_SERVER_ERROR');
		const expiresAt = Date.now() + 3600 * 1000;

		await db.insert(fileAccessTokens).values({ id, fileId: file.id, token: tokenBytes, expiresAt });
		await recordModerationEvent(c, 'file_token_created', {
			tokenId: id,
			fileId: file.id,
			bucketId: bucket.id,
			bucketName: bucket.name,
			filePath: file.path,
			expiresAt,
			method: 'passphrase',
		});

		return c.json({ id, token, expiresAt, fileId: file.id }, 200);
	}, apiDef['/api/file-tokens/create-by-passphrase'].res),
);

export { app as fileTokenRoutes };

import { Hono } from 'hono';
import { describeResponse, describeRoute, validator } from 'hono-openapi';
import { eq } from 'drizzle-orm';
import { buckets, files, usedBucketNames } from '../scheme/index';
import { getDb } from '../utils/db';
import { getQuotaForUser } from '../utils/rate-limit';
import { authMiddleware } from '../middleware/auth';
import { genEaidx } from '../../shared/eaid-x';
import { validateBucketName } from '../utils/name-validation';
import { apiDef, getResponseDefWithAuth, type JsonCtx } from '../../shared/api';
import { omitResAndReq } from '../utils/omit';
import { apiError } from '../utils/api-error';
import { fileMutationEvents } from '../events/file-mutations';
import { toFileMutationReferences } from '../utils/file-mutation-reference';

const app = new Hono<{ Bindings: Env }>();

app.use(authMiddleware);

app.post(
	'/create',
	describeRoute(omitResAndReq(apiDef['/api/buckets/create'])),
	validator('json', apiDef['/api/buckets/create'].req),
	describeResponse(async (c: JsonCtx<'/api/buckets/create', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');

		if (!body.bucketName) {
			throw apiError(400, 'BUCKET_NAME_IS_REQUIRED');
		}

		// 使用可能な文字・禁止ワード・重複（大文字小文字を区別しない）チェック
		const bucketNameError = await validateBucketName(db, body.bucketName);
		if (bucketNameError) {
			// 重複エラーのみ409、それ以外は400
			const status = bucketNameError === 'Bucket name already exists' ? 409 : 400;
			throw apiError(status, bucketNameError === 'Bucket name already exists' ? 'BUCKET_NAME_ALREADY_EXISTS' : 'INVALID_FILE_PATH', bucketNameError);
		}

		const quota = await getQuotaForUser(c.env, user.id);
		if (quota.maxBuckets !== null) {
			const userBucketCount = await db.query.buckets
				.findMany({ where: eq(buckets.userId, user.id) })
				.then((result) => result.length);

			if (userBucketCount >= quota.maxBuckets) {
				throw apiError(429, 'BUCKET_LIMIT_EXCEEDED');
			}
		}

		const bucketId = genEaidx(Date.now());

		await db.insert(buckets).values({
			id: bucketId,
			userId: user.id,
			name: body.bucketName,
		});

		// lowercaseで used_bucket_names に登録（削除後も同名再利用不可）
		await db
			.insert(usedBucketNames)
			.values({ bucketName: body.bucketName.toLowerCase() })
			.onConflictDoNothing();

		return c.json({ bucketId }, 200);
	}, getResponseDefWithAuth('/api/buckets/create')),
);

app.post(
	'/delete',
	describeRoute(omitResAndReq(apiDef['/api/buckets/delete'])),
	validator('json', apiDef['/api/buckets/delete'].req),
	describeResponse(async (c: JsonCtx<'/api/buckets/delete', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');

		if (!body.bucketId) {
			throw apiError(400, 'BUCKET_NOT_FOUND', 'bucketId is required');
		}

		const bucket = await db.select().from(buckets).where(eq(buckets.id, body.bucketId)).get();

		if (!bucket) {
			throw apiError(404, 'BUCKET_NOT_FOUND');
		}

		if (bucket.userId !== user.id && !user.isAdmin) {
			throw apiError(403, 'FORBIDDEN');
		}

		const bucketFiles = await db.select().from(files).where(eq(files.bucketId, bucket.id));
		const purgeFiles = await toFileMutationReferences(db, bucketFiles);

		for (const file of bucketFiles) {
			try {
				await c.env.R2.delete(file.r2Key);
			} catch (error) {
				console.error('Failed to delete R2 object:', file.r2Key, error);
			}
		}

		await db.delete(buckets).where(eq(buckets.id, bucket.id));

		fileMutationEvents.emit('bucket:deleted', {
			env: c.env,
			origin: new URL(c.req.url).origin,
			waitUntil: promise => c.executionCtx.waitUntil(promise),
			bucket: { id: bucket.id, name: bucket.name },
			files: purgeFiles,
		});

		return c.json({ ok: true as const }, 200);
	}, getResponseDefWithAuth('/api/buckets/delete')),
);

app.post(
	'/list',
	describeRoute(omitResAndReq(apiDef['/api/buckets/list'])),
	validator('json', apiDef['/api/buckets/list'].req),
	describeResponse(async (c: JsonCtx<'/api/buckets/list', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');

		const [userBuckets, quota] = await Promise.all([
			db
				.select({ id: buckets.id, name: buckets.name, usedBytes: buckets.usedBytes })
				.from(buckets)
				.where(eq(buckets.userId, user.id)),
			getQuotaForUser(c.env, user.id),
		]);

		return c.json({
			buckets: userBuckets,
			maxBucketSizeBytes: quota.maxBucketSizeBytes,
			canUseDownloadCount: quota.canUseDownloadCount,
		}, 200);
	}, getResponseDefWithAuth('/api/buckets/list')),
);

export const bucketRoutes = app;

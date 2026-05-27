import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { parseEaidx } from '../../shared/eaid-x';
import { buckets, files, tarFiles, targzFiles } from '../scheme/index';
import { getDb } from '../utils/db';
import { apiError } from '../utils/api-error';
import { deleteResolveRouteCache, resolveRouteCache } from '../middleware/resolve-route-cache';
import { fileMutationEvents, runMutationTask, type FileReference } from '../events/file-mutations';
import { getAppName } from '../utils/app-name';

const app = new Hono<{ Bindings: Env }>();
type AppContext = Context<{ Bindings: Env }>;

const activityJsonContentType = 'application/activity+json; charset=utf-8';
const publicAddress = 'https://www.w3.org/ns/activitystreams#Public';
const activityPubCacheMaxAgeSeconds = 5 * 60;
let activityPubCachePurgeListenersRegistered = false;

function originFromRequest(request: Request): string {
	return new URL(request.url).origin;
}

function activityJson(c: AppContext, value: unknown): Response {
	return c.json(value, 200, { 'Content-Type': activityJsonContentType });
}

function basename(path: string): string {
	return path.replace(/\/$/, '').split('/').pop() ?? path;
}

function encodeFilePath(path: string): string {
	return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function documentTypeForMime(mimeType: string | null): 'Audio' | 'Document' | 'Image' | 'Video' {
	if (mimeType?.startsWith('image/')) return 'Image';
	if (mimeType?.startsWith('video/')) return 'Video';
	if (mimeType?.startsWith('audio/')) return 'Audio';
	return 'Document';
}

function ActivityPubFileContent(props: { name: string }) {
	return <p>{props.name}</p>;
}

function renderActivityPubContent(name: string): string {
	return String(<ActivityPubFileContent name={name} />);
}

function bucketActor(origin: string, bucket: typeof buckets.$inferSelect, appName: string) {
	const id = `${origin}/a/buckets/${bucket.id}`;
	return {
		'@context': 'https://www.w3.org/ns/activitystreams',
		id,
		type: 'Service',
		preferredUsername: bucket.name,
		name: `${bucket.name} @ ${appName}`,
		url: `${origin}/v/${encodeURIComponent(bucket.name)}/`,
		inbox: `${id}/inbox`,
		outbox: `${id}/outbox`,
		followers: `${id}/followers`,
		manuallyApprovesFollowers: false,
		discoverable: true,
	};
}

function emptyOrderedCollection(id: string) {
	return {
		'@context': 'https://www.w3.org/ns/activitystreams',
		id,
		type: 'OrderedCollection',
		totalItems: 0,
		orderedItems: [],
	};
}

function fileNote(options: {
	origin: string;
	bucket: typeof buckets.$inferSelect;
	file: typeof files.$inferSelect;
	entry?: { path: string; mimeType: string; size?: number | null };
}) {
	const actorId = `${options.origin}/a/buckets/${options.bucket.id}`;
	const entry = options.entry;
	const encodedFilePath = encodeFilePath(options.file.path);
	const encodedEntryPath = entry === undefined ? null : encodeURIComponent(entry.path);
	const objectId = entry !== undefined
		? `${options.origin}/a/files/${options.file.id}/${encodeURIComponent(':entries')}/${encodedEntryPath}`
		: `${options.origin}/a/files/${options.file.id}`;
	const viewUrl = entry !== undefined
		? `${options.origin}/v/${encodeURIComponent(options.bucket.name)}/${encodedFilePath}/${encodeURIComponent(':entries')}/${encodedEntryPath}`
		: `${options.origin}/v/${encodeURIComponent(options.bucket.name)}/${encodedFilePath}`;
	const downloadUrl = entry !== undefined
		? `${options.origin}/d/${options.file.id}/${encodeURIComponent(':entries')}/${encodedEntryPath}`
		: `${options.origin}/d/${options.file.id}`;
	const name = entry !== undefined ? basename(entry.path) : basename(options.file.path);
	const mimeType = entry !== undefined ? entry.mimeType : options.file.mimeType;
	const size = entry !== undefined ? entry.size : options.file.size;

	return {
		'@context': 'https://www.w3.org/ns/activitystreams',
		id: objectId,
		type: 'Note',
		attributedTo: actorId,
		to: [publicAddress],
		cc: [`${actorId}/followers`],
		published: parseEaidx(options.file.id).date.toISOString(),
		name,
		content: renderActivityPubContent(name),
		url: viewUrl,
		attachment: [{
			type: documentTypeForMime(mimeType),
			name,
			mediaType: mimeType ?? 'application/octet-stream',
			url: downloadUrl,
			...(typeof size === 'number' ? { size } : {}),
		}],
	};
}

async function getPublicFile(db: ReturnType<typeof getDb>, fileId: string) {
	const file = await db.select().from(files).where(eq(files.id, fileId)).get();
	if (!file || !file.isClosed || file.visibility !== 'public' || !file.isListed || file.isModerationForcedPrivate) throw apiError(404, 'FILE_NOT_FOUND');
	const bucket = await db.select().from(buckets).where(eq(buckets.id, file.bucketId)).get();
	if (!bucket) throw apiError(404, 'BUCKET_NOT_FOUND');
	return { file, bucket };
}

async function getBucket(db: ReturnType<typeof getDb>, bucketId: string) {
	const bucket = await db.select().from(buckets).where(eq(buckets.id, bucketId)).get();
	if (!bucket) throw apiError(404, 'BUCKET_NOT_FOUND');
	return bucket;
}

function getActivityPubFileCachePath(fileId: string): string {
	return `/a/files/${encodeURIComponent(fileId)}`;
}

function getActivityPubEntryCachePath(fileId: string, entryPath: string): string {
	return `${getActivityPubFileCachePath(fileId)}/${encodeURIComponent(':entries')}/${encodeURIComponent(entryPath)}`;
}

function purgeActivityPubFileCache(env: Env, origin: string, file: FileReference): Promise<Array<PromiseSettledResult<boolean>>> {
	return Promise.allSettled([
		deleteResolveRouteCache(env, getActivityPubFileCachePath(file.id), origin),
		...(file.entryPaths ?? []).map(entryPath => deleteResolveRouteCache(env, getActivityPubEntryCachePath(file.id, entryPath), origin)),
	]);
}

function registerActivityPubCachePurgeListeners(): void {
	if (activityPubCachePurgeListenersRegistered) return;
	activityPubCachePurgeListenersRegistered = true;

	fileMutationEvents.on('file:deleted', ({ env, origin, waitUntil, files }) => {
		const promise = Promise.allSettled(files.map(file => purgeActivityPubFileCache(env, origin, file))).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /a deleted file cache:');
	});

	fileMutationEvents.on('file:updated', ({ env, origin, waitUntil, files }) => {
		const promise = Promise.allSettled(files.map(file => purgeActivityPubFileCache(env, origin, file))).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /a updated file cache:');
	});

	fileMutationEvents.on('file:moved', ({ env, origin, waitUntil, files }) => {
		const promise = Promise.allSettled(files.map(file => purgeActivityPubFileCache(env, origin, file))).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /a moved file cache:');
	});

	fileMutationEvents.on('directory:deleted', ({ env, origin, waitUntil, files }) => {
		const promise = Promise.allSettled(files.map(file => purgeActivityPubFileCache(env, origin, file))).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /a deleted directory cache:');
	});

	fileMutationEvents.on('directory:moved', ({ env, origin, waitUntil, files }) => {
		const promise = Promise.allSettled(files.map(file => purgeActivityPubFileCache(env, origin, file))).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /a moved directory cache:');
	});

	fileMutationEvents.on('bucket:deleted', ({ env, origin, waitUntil, bucket, files }) => {
		const promise = Promise.allSettled([
			deleteResolveRouteCache(env, `/a/buckets/${encodeURIComponent(bucket.id)}`, origin),
			deleteResolveRouteCache(env, `/a/buckets/${encodeURIComponent(bucket.id)}/outbox`, origin),
			deleteResolveRouteCache(env, `/a/buckets/${encodeURIComponent(bucket.id)}/followers`, origin),
			...files.map(file => purgeActivityPubFileCache(env, origin, file)),
		]).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /a deleted bucket cache:');
	});
}

registerActivityPubCachePurgeListeners();

app.use('/a/*', resolveRouteCache({ externalMaxAgeSeconds: activityPubCacheMaxAgeSeconds }));

app.get('/a/buckets/:bucketId', async (c) => {
	const db = getDb(c.env);
	const bucket = await getBucket(db, c.req.param('bucketId'));
	const appName = await getAppName(c.env);
	return activityJson(c, bucketActor(originFromRequest(c.req.raw), bucket, appName));
});

app.get('/a/buckets/:bucketId/outbox', async (c) => {
	const db = getDb(c.env);
	await getBucket(db, c.req.param('bucketId'));
	return activityJson(c, emptyOrderedCollection(`${originFromRequest(c.req.raw)}/a/buckets/${c.req.param('bucketId')}/outbox`));
});

app.get('/a/buckets/:bucketId/followers', async (c) => {
	const db = getDb(c.env);
	await getBucket(db, c.req.param('bucketId'));
	return activityJson(c, emptyOrderedCollection(`${originFromRequest(c.req.raw)}/a/buckets/${c.req.param('bucketId')}/followers`));
});

app.post('/a/buckets/:bucketId/inbox', async (c) => {
	const db = getDb(c.env);
	await getBucket(db, c.req.param('bucketId'));
	return c.body(null, 202);
});

app.get('/a/files/:fileId/:entryMarker/:entryPath{.+}', async (c) => {
	if (c.req.param('entryMarker') !== ':entries') throw apiError(404, 'FILE_NOT_FOUND');
	const db = getDb(c.env);
	const { file, bucket } = await getPublicFile(db, c.req.param('fileId'));
	const entryPath = c.req.param('entryPath');
	const entry = file.isTar
		? await db.select().from(tarFiles).where(and(eq(tarFiles.fileId, file.id), eq(tarFiles.path, entryPath))).get()
		: file.isTargz
			? await db.select().from(targzFiles).where(and(eq(targzFiles.fileId, file.id), eq(targzFiles.path, entryPath))).get()
			: undefined;
	if (!entry) throw apiError(404, 'FILE_NOT_FOUND_IN_ARCHIVE');
	return activityJson(c, fileNote({
		origin: originFromRequest(c.req.raw),
		bucket,
		file,
		entry: { path: entry.path, mimeType: entry.mimeType, size: 'size' in entry ? entry.size : null },
	}));
});

app.get('/a/files/:fileId', async (c) => {
	const db = getDb(c.env);
	const { file, bucket } = await getPublicFile(db, c.req.param('fileId'));
	return activityJson(c, fileNote({ origin: originFromRequest(c.req.raw), bucket, file }));
});

export const activityPubRoutes = app;

import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { buckets, files, tarFiles, targzFiles } from '../scheme/index';
import { deleteResolveRouteCache, resolveRouteCache } from '../middleware/resolve-route-cache';
import { getDb } from '../utils/db';
import { fileMutationEvents, runMutationTask, type FileReference } from '../events/file-mutations';

const app = new Hono<{ Bindings: Env }>();
type AppContext = Context<{ Bindings: Env }>;

const activityJsonType = 'application/activity+json';
const viewHtmlCacheMaxAgeSeconds = 3 * 60 * 60;
let viewHtmlCachePurgeListenersRegistered = false;

function decodePathSegment(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

function parseViewPath(url: string): { bucketName: string; filePath: string; entryPath: string | null } | null {
	const pathname = new URL(url).pathname;
	const segments = pathname.split('/').filter(Boolean);
	if (segments[0] !== 'v' || segments.length < 3) return null;

	const bucketName = decodePathSegment(segments[1]);
	if (bucketName === null) return null;

	const entryMarkerIndex = segments.findIndex((segment, index) => index >= 2 && decodePathSegment(segment) === ':entries');
	if (entryMarkerIndex === -1) {
		const filePathSegments = segments.slice(2).map(decodePathSegment);
		if (filePathSegments.some(segment => segment === null)) return null;
		return { bucketName, filePath: filePathSegments.join('/'), entryPath: null };
	}

	if (entryMarkerIndex === 2 || entryMarkerIndex + 1 >= segments.length) return null;
	const filePathSegments = segments.slice(2, entryMarkerIndex).map(decodePathSegment);
	if (filePathSegments.some(segment => segment === null)) return null;
	const entryPath = decodePathSegment(segments[entryMarkerIndex + 1]);
	if (entryPath === null) return null;
	return { bucketName, filePath: filePathSegments.join('/'), entryPath };
}

async function resolveActivityPubHref(c: AppContext): Promise<string | null> {
	const parsed = parseViewPath(c.req.url);
	if (!parsed || parsed.filePath === '' || parsed.filePath.endsWith('/')) return null;

	const db = getDb(c.env);
	const bucket = await db
		.select({ id: buckets.id })
		.from(buckets)
		.where(eq(buckets.name, parsed.bucketName))
		.get();
	if (!bucket) return null;

	const file = await db
		.select({ id: files.id, isTar: files.isTar, isTargz: files.isTargz })
		.from(files)
		.where(and(
			eq(files.bucketId, bucket.id),
			eq(files.path, parsed.filePath),
			eq(files.isClosed, true),
			eq(files.visibility, 'public'),
			eq(files.isListed, true),
		))
		.get();
	if (!file) return null;

	const origin = new URL(c.req.url).origin;
	if (parsed.entryPath === null) return `${origin}/a/files/${file.id}`;

	const entry = file.isTar
		? await db.select({ id: tarFiles.id }).from(tarFiles).where(and(eq(tarFiles.fileId, file.id), eq(tarFiles.path, parsed.entryPath))).get()
		: file.isTargz
			? await db.select({ id: targzFiles.id }).from(targzFiles).where(and(eq(targzFiles.fileId, file.id), eq(targzFiles.path, parsed.entryPath))).get()
			: null;
	if (!entry) return null;
	return `${origin}/a/files/${file.id}/${encodeURIComponent(':entries')}/${encodeURIComponent(parsed.entryPath)}`;
}

function appendLinkHeader(headers: Headers, href: string): void {
	const link = `<${href}>; rel="alternate"; type="${activityJsonType}"`;
	const current = headers.get('Link');
	headers.set('Link', current ? `${current}, ${link}` : link);
}

function withActivityPubAlternate(response: Response, href: string): Response {
	const transformed = new HTMLRewriter()
		.on('head', {
			element(element) {
				element.append(`<link rel="alternate" type="${activityJsonType}" href="${href}">`, { html: true });
			},
		})
		.transform(response);
	const headers = new Headers(transformed.headers);
	appendLinkHeader(headers, href);
	headers.delete('Content-Length');
	headers.delete('ETag');
	return new Response(transformed.body, {
		status: transformed.status,
		statusText: transformed.statusText,
		headers,
	});
}

function encodePath(path: string): string {
	return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function getViewCachePath(bucketName: string, filePath: string): string {
	return `/v/${encodeURIComponent(bucketName)}/${encodePath(filePath)}`;
}

function getArchiveEntryViewCachePath(bucketName: string, filePath: string, entryPath: string): string {
	return `${getViewCachePath(bucketName, filePath)}/${encodeURIComponent(':entries')}/${encodeURIComponent(entryPath)}`;
}

function purgeViewCache(env: Env, origin: string, bucketName: string, file: FileReference): Promise<Array<PromiseSettledResult<boolean>>> {
	return Promise.allSettled([
		deleteResolveRouteCache(env, getViewCachePath(bucketName, file.path), origin),
		...(file.entryPaths ?? []).map(entryPath => deleteResolveRouteCache(env, getArchiveEntryViewCachePath(bucketName, file.path, entryPath), origin)),
	]);
}

function registerViewHtmlCachePurgeListeners(): void {
	if (viewHtmlCachePurgeListenersRegistered) return;
	viewHtmlCachePurgeListenersRegistered = true;

	fileMutationEvents.on('file:deleted', ({ env, origin, waitUntil, bucket, files }) => {
		const promise = Promise.allSettled(files.map(file => purgeViewCache(env, origin, bucket.name, file))).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /v deleted file cache:');
	});

	fileMutationEvents.on('file:updated', ({ env, origin, waitUntil, bucket, files }) => {
		const promise = Promise.allSettled(files.map(file => purgeViewCache(env, origin, bucket.name, file))).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /v updated file cache:');
	});

	fileMutationEvents.on('file:moved', ({ env, origin, waitUntil, sourceBucket, targetBucket, files }) => {
		const promise = Promise.allSettled(files.flatMap(file => [
			purgeViewCache(env, origin, sourceBucket.name, file),
			purgeViewCache(env, origin, targetBucket.name, { id: file.id, path: file.nextPath, entryPaths: file.entryPaths }),
		])).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /v moved file cache:');
	});

	fileMutationEvents.on('directory:deleted', ({ env, origin, waitUntil, bucket, files }) => {
		const promise = Promise.allSettled(files.map(file => purgeViewCache(env, origin, bucket.name, file))).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /v deleted directory cache:');
	});

	fileMutationEvents.on('directory:moved', ({ env, origin, waitUntil, sourceBucket, targetBucket, files }) => {
		const promise = Promise.allSettled(files.flatMap(file => [
			purgeViewCache(env, origin, sourceBucket.name, file),
			purgeViewCache(env, origin, targetBucket.name, { id: file.id, path: file.nextPath, entryPaths: file.entryPaths }),
		])).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /v moved directory cache:');
	});

	fileMutationEvents.on('bucket:deleted', ({ env, origin, waitUntil, bucket, files }) => {
		const promise = Promise.allSettled(files.map(file => purgeViewCache(env, origin, bucket.name, file))).then(() => undefined);
		runMutationTask(waitUntil, promise, 'Failed to purge /v deleted bucket cache:');
	});
}

registerViewHtmlCachePurgeListeners();

app.use('/v/*', resolveRouteCache({ externalMaxAgeSeconds: viewHtmlCacheMaxAgeSeconds }));

app.get('/v/*', async (c) => {
	const response = await c.env.ASSETS.fetch(c.req.raw);
	const href = await resolveActivityPubHref(c);
	if (!href || !response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return response;
	return withActivityPubAlternate(response, href);
});

export const viewHtmlRoutes = app;

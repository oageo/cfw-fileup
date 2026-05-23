import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { buckets, files, tarFiles, targzFiles } from '../scheme/index';
import { shortGetCache } from '../middleware/short-get-cache';
import { getDb } from '../utils/db';

const app = new Hono<{ Bindings: Env }>();
type AppContext = Context<{ Bindings: Env }>;

const activityJsonType = 'application/activity+json';
const viewHtmlCacheMaxAgeSeconds = 3 * 60 * 60;

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

app.use('/v/*', shortGetCache({ maxAgeSeconds: viewHtmlCacheMaxAgeSeconds }));

app.get('/v/*', async (c) => {
	const response = await c.env.ASSETS.fetch(c.req.raw);
	const href = await resolveActivityPubHref(c);
	if (!href || !response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return response;
	return withActivityPubAlternate(response, href);
});

export const viewHtmlRoutes = app;

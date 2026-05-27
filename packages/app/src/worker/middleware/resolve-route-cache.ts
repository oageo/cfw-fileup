import { createMiddleware } from 'hono/factory';
import { openWorkerCache, workerCacheBaseNames } from '../utils/cache-names';

const internalCacheMaxAgeSeconds = 12 * 60 * 60;
const internalExpiresHeader = 'X-Cfw-Fileup-Cache-Expires';
const internalStatusHeader = 'X-Cfw-Fileup-Cache-Status';
const internalStatusTextHeader = 'X-Cfw-Fileup-Cache-Status-Text';

type ResolveRouteCacheOptions = {
	externalMaxAgeSeconds?: number;
	cacheKeyVariant?: (request: Request) => string;
};

export function createResolveRouteCacheRequest(input: Request | URL | string, variant?: string): Request {
	const sourceUrl = input instanceof Request ? new URL(input.url) : new URL(input);
	const keyUrl = new URL('https://cache.cfw-fileup.local/resolve-route');
	keyUrl.searchParams.set('v', '1');
	keyUrl.searchParams.set('origin', sourceUrl.origin);
	keyUrl.searchParams.set('path', sourceUrl.pathname);
	if (variant !== undefined && variant !== '') keyUrl.searchParams.set('variant', variant);
	return new Request(keyUrl, { method: 'GET' });
}

function isExpired(response: Response): boolean {
	const expires = response.headers.get(internalExpiresHeader);
	if (expires === null) return false;

	const expiresAt = Date.parse(expires);
	return !Number.isNaN(expiresAt) && expiresAt <= Date.now();
}

function stripInternalHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	const cachedStatus = Number(headers.get(internalStatusHeader));
	const status = Number.isInteger(cachedStatus) && cachedStatus >= 100 && cachedStatus <= 599
		? cachedStatus
		: response.status;
	const statusText = headers.get(internalStatusTextHeader) ?? response.statusText;
	headers.delete(internalExpiresHeader);
	headers.delete(internalStatusHeader);
	headers.delete(internalStatusTextHeader);
	return new Response(response.body, {
		status,
		statusText,
		headers,
	});
}

async function matchResolveRouteCache(env: Env, request: Request, variant?: string): Promise<Response | null> {
	const cacheRequest = createResolveRouteCacheRequest(request, variant);
	const cache = await openWorkerCache(env, workerCacheBaseNames.resolveRoute);
	const cached = await cache.match(cacheRequest);
	if (cached === undefined) return null;

	if (isExpired(cached)) {
		await cache.delete(cacheRequest);
		return null;
	}

	return stripInternalHeaders(cached);
}

function putResolveRouteCache(
	env: Env,
	request: Request,
	response: Response,
	waitUntil: (promise: Promise<void>) => void,
	variant?: string,
): void {
	const cacheRequest = createResolveRouteCacheRequest(request, variant);
	const cacheResponse = response.clone();
	const putPromise = (async () => {
		const cache = await openWorkerCache(env, workerCacheBaseNames.resolveRoute);
		const headers = new Headers(cacheResponse.headers);
		headers.set(internalExpiresHeader, new Date(Date.now() + internalCacheMaxAgeSeconds * 1000).toUTCString());
		headers.set(internalStatusHeader, String(cacheResponse.status));
		headers.set(internalStatusTextHeader, cacheResponse.statusText);
		await cache.put(cacheRequest, new Response(cacheResponse.body, {
			status: 200,
			statusText: 'OK',
			headers,
		}));
	})();

	try {
		waitUntil(putPromise);
	} catch {
		void putPromise.catch((error: unknown) => {
			console.error('Failed to put resolve route response into cache:', error);
		});
	}
}

export function resolveRouteCache(options: ResolveRouteCacheOptions = {}) {
	return createMiddleware<{ Bindings: Env }>(async (c, next) => {
		if (c.req.method !== 'GET') {
			await next();
			return;
		}

		const cacheKeyVariant = options.cacheKeyVariant?.(c.req.raw);
		const cached = await matchResolveRouteCache(c.env, c.req.raw, cacheKeyVariant);
		if (cached !== null) {
			const headers = new Headers(cached.headers);
			headers.set('X-Cache', 'HIT');
			c.res = new Response(cached.body, {
				status: cached.status,
				statusText: cached.statusText,
				headers,
			});
			return;
		}

		await next();

		if (c.res.status !== 200 || c.res.headers.has('Set-Cookie')) return;

		const headers = new Headers(c.res.headers);
		if (options.externalMaxAgeSeconds !== undefined) {
			headers.set('Cache-Control', `public, max-age=${options.externalMaxAgeSeconds}`);
			headers.set('Expires', new Date(Date.now() + options.externalMaxAgeSeconds * 1000).toUTCString());
		}
		headers.set('X-Cache', 'MISS');

		c.res = new Response(c.res.body, {
			status: c.res.status,
			statusText: c.res.statusText,
			headers,
		});

		putResolveRouteCache(c.env, c.req.raw, c.res, (promise) => c.executionCtx.waitUntil(promise), cacheKeyVariant);
	});
}

export async function deleteResolveRouteCache(env: Env, path: string, origin = 'https://cache.cfw-fileup.local', variant?: string): Promise<boolean> {
	const cache = await openWorkerCache(env, workerCacheBaseNames.resolveRoute);
	return cache.delete(createResolveRouteCacheRequest(new URL(path, origin), variant));
}

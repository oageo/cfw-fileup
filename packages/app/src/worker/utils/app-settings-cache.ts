import { eq } from 'drizzle-orm';
import { appSettings } from '../scheme/index';
import { getDb } from './db';

const appSettingsCacheName = 'app-settings';
const appSettingsCacheMaxAgeSeconds = 10;
const expiresHeader = 'X-Cfw-Fileup-App-Setting-Expires';

function createAppSettingCacheRequest(key: string): Request {
	const url = new URL('https://cache.cfw-fileup.local/app-settings');
	url.searchParams.set('key', key);
	return new Request(url, { method: 'GET' });
}

function isExpired(response: Response): boolean {
	const expires = response.headers.get(expiresHeader);
	if (expires === null) return false;

	const expiresAt = Date.parse(expires);
	return !Number.isNaN(expiresAt) && expiresAt <= Date.now();
}

async function putAppSettingCache(key: string, value: string | null): Promise<void> {
	const cache = await caches.open(appSettingsCacheName);
	const headers = new Headers({
		'Content-Type': 'application/json',
		[expiresHeader]: new Date(Date.now() + appSettingsCacheMaxAgeSeconds * 1000).toUTCString(),
	});
	await cache.put(createAppSettingCacheRequest(key), new Response(JSON.stringify({ value }), { headers }));
}

export async function getAppSettingCached(env: Env, key: string): Promise<string | null> {
	const cacheRequest = createAppSettingCacheRequest(key);
	const cache = await caches.open(appSettingsCacheName);
	const cached = await cache.match(cacheRequest);
	if (cached !== undefined) {
		if (!isExpired(cached)) {
			const body = await cached.json<{ value: string | null }>();
			return body.value;
		}
		await cache.delete(cacheRequest);
	}

	const row = await getDb(env)
		.select({ value: appSettings.value })
		.from(appSettings)
		.where(eq(appSettings.key, key))
		.get();
	const value = row?.value ?? null;
	await putAppSettingCache(key, value);
	return value;
}

export async function setAppSettingCache(key: string, value: string | null): Promise<void> {
	await putAppSettingCache(key, value);
}

export async function deleteAppSettingCache(key: string): Promise<boolean> {
	const cache = await caches.open(appSettingsCacheName);
	return cache.delete(createAppSettingCacheRequest(key));
}

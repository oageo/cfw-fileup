import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env, app, setupDb, clearDb, signup, authHeaders, createAdminUser } from './helpers';

beforeAll(async () => {
	await setupDb();
});

beforeEach(async () => {
	await clearDb();
});

async function setupPublicFile(path = 'hello.txt', options: { isListed?: boolean; visibility?: 'public' | 'private' | 'passphrase'; passphrase?: string } = {}) {
	const { data } = await signup('user1');
	const token = String(data.token);

	const bucketRes = await app.request('/api/buckets/create', {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ bucketName: 'ap_bucket' }),
	}, env);
	const { bucketId } = await bucketRes.json() as { bucketId: string };

	const openRes = await app.request('/api/files/create/open', {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ bucketId, path }),
	}, env);
	const { fileId } = await openRes.json() as { fileId: string };

	await env.R2.put(fileId, 'Hello ActivityPub');
	await app.request('/api/files/create/close', {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ fileId, visibility: options.visibility ?? 'public', isListed: options.isListed, passphrase: options.passphrase }),
	}, env);

	return { token, bucketId, fileId };
}

function envWithAssets(): Env {
	return {
		...env,
		ASSETS: {
			fetch: () => new Response('<!doctype html><html><head><title>CFW FileUp</title></head><body><div id="app"></div></body></html>', {
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
			}),
		},
	};
}

describe('ActivityPub routes', () => {
	test('serves a bucket actor', async () => {
		const { bucketId } = await setupPublicFile();

		const res = await app.request(`https://example.test/a/buckets/${bucketId}`, {}, env);
		expect(res.status).toBe(200);
		expect(res.headers.get('Content-Type')).toContain('application/activity+json');
		const actor = await res.json() as { id: string; type: string; preferredUsername: string; inbox: string; outbox: string };
		expect(actor.id).toBe(`https://example.test/a/buckets/${bucketId}`);
		expect(actor.type).toBe('Service');
		expect(actor.preferredUsername).toBe('ap_bucket');
		expect(actor.inbox).toBe(`https://example.test/a/buckets/${bucketId}/inbox`);
		expect(actor.outbox).toBe(`https://example.test/a/buckets/${bucketId}/outbox`);
	});

	test('does not serve collections or inbox for unknown buckets', async () => {
		const outboxRes = await app.request('https://example.test/a/buckets/unknown/outbox', {}, env);
		expect(outboxRes.status).toBe(404);

		const followersRes = await app.request('https://example.test/a/buckets/unknown/followers', {}, env);
		expect(followersRes.status).toBe(404);

		const inboxRes = await app.request('https://example.test/a/buckets/unknown/inbox', { method: 'POST' }, env);
		expect(inboxRes.status).toBe(404);
	});

	test('serves a public file as Note with attachment', async () => {
		const { bucketId, fileId } = await setupPublicFile();

		const res = await app.request(`https://example.test/a/files/${fileId}`, {}, env);
		expect(res.status).toBe(200);
		const note = await res.json() as {
			id: string;
			type: string;
			attributedTo: string;
			url: string;
			attachment: Array<{ type: string; name: string; url: string }>;
		};
		expect(note.id).toBe(`https://example.test/a/files/${fileId}`);
		expect(note.type).toBe('Note');
		expect(note.attributedTo).toBe(`https://example.test/a/buckets/${bucketId}`);
		expect(note.url).toBe('https://example.test/v/ap_bucket/hello.txt');
		expect(note.attachment[0]).toEqual(expect.objectContaining({
			type: 'Document',
			name: 'hello.txt',
			url: `https://example.test/d/${fileId}`,
		}));
	});

	test('does not serve an unlisted public file as Note', async () => {
		const { fileId } = await setupPublicFile('hidden.txt', { isListed: false });

		const res = await app.request(`https://example.test/a/files/${fileId}`, {}, env);
		expect(res.status).toBe(404);
	});

	test('adds ActivityPub alternate tags to public listed file pages', async () => {
		const { fileId } = await setupPublicFile('dir/hello #1 & 2.txt');

		const res = await app.request('https://example.test/v/ap_bucket/dir/hello%20%231%20%26%202.txt', {}, envWithAssets());
		expect(res.status).toBe(200);
		const href = `https://example.test/a/files/${fileId}`;
		expect(res.headers.get('Link')).toContain(`<${href}>; rel="alternate"; type="application/activity+json"`);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=10800');
		expect(res.headers.get('X-Cache')).toBe('MISS');
		expect(await res.text()).toContain(`<link rel="alternate" type="application/activity+json" href="${href}">`);
	});

	test('serves /v file pages from resolve route cache while keeping short external cache headers', async () => {
		const { fileId } = await setupPublicFile('cached-view.txt');
		const requestUrl = 'https://example.test/v/ap_bucket/cached-view.txt';

		const firstRes = await app.request(requestUrl, {}, envWithAssets());
		expect(firstRes.status).toBe(200);
		expect(firstRes.headers.get('X-Cache')).toBe('MISS');
		expect(firstRes.headers.get('Cache-Control')).toBe('public, max-age=10800');
		expect(await firstRes.text()).toContain(`/a/files/${fileId}`);
		await new Promise(resolve => setTimeout(resolve, 0));

		const secondRes = await app.request(requestUrl, {}, envWithAssets());
		expect(secondRes.status).toBe(200);
		expect(secondRes.headers.get('X-Cache')).toBe('HIT');
		expect(secondRes.headers.get('Cache-Control')).toBe('public, max-age=10800');
		expect(await secondRes.text()).toContain(`/a/files/${fileId}`);
	});

	test('normalizes resolve route cache keys by ignoring query strings', async () => {
		const { fileId } = await setupPublicFile('query-cache.txt');
		const requestUrl = 'https://example.test/v/ap_bucket/query-cache.txt';

		const firstRes = await app.request(`${requestUrl}?utm_source=first`, {}, envWithAssets());
		expect(firstRes.status).toBe(200);
		expect(firstRes.headers.get('X-Cache')).toBe('MISS');
		expect(await firstRes.text()).toContain(`/a/files/${fileId}`);
		await new Promise(resolve => setTimeout(resolve, 0));

		const secondRes = await app.request(`${requestUrl}?utm_source=second`, {}, envWithAssets());
		expect(secondRes.status).toBe(200);
		expect(secondRes.headers.get('X-Cache')).toBe('HIT');
		expect(await secondRes.text()).toContain(`/a/files/${fileId}`);
	});

	test('keeps resolve route cache scoped by origin', async () => {
		const { fileId } = await setupPublicFile('origin-cache.txt');
		const path = '/v/ap_bucket/origin-cache.txt';

		const firstRes = await app.request(`https://example.test${path}`, {}, envWithAssets());
		expect(firstRes.headers.get('X-Cache')).toBe('MISS');
		expect(await firstRes.text()).toContain(`https://example.test/a/files/${fileId}`);
		await new Promise(resolve => setTimeout(resolve, 0));

		const otherOriginRes = await app.request(`https://alt.example.test${path}`, {}, envWithAssets());
		expect(otherOriginRes.headers.get('X-Cache')).toBe('MISS');
		expect(await otherOriginRes.text()).toContain(`https://alt.example.test/a/files/${fileId}`);
		await new Promise(resolve => setTimeout(resolve, 0));

		const cachedFirstOriginRes = await app.request(`https://example.test${path}`, {}, envWithAssets());
		expect(cachedFirstOriginRes.headers.get('X-Cache')).toBe('HIT');
		expect(await cachedFirstOriginRes.text()).toContain(`https://example.test/a/files/${fileId}`);
	});

	test('serves ActivityPub file notes from resolve route cache', async () => {
		const { fileId } = await setupPublicFile('cached-note.txt');

		const firstRes = await app.request(`https://example.test/a/files/${fileId}`, {}, env);
		expect(firstRes.status).toBe(200);
		expect(firstRes.headers.get('X-Cache')).toBe('MISS');
		expect(firstRes.headers.get('Cache-Control')).toBe('public, max-age=300');
		await firstRes.text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const secondRes = await app.request(`https://example.test/a/files/${fileId}`, {}, env);
		expect(secondRes.status).toBe(200);
		expect(secondRes.headers.get('X-Cache')).toBe('HIT');
		const note = await secondRes.json() as { url: string };
		expect(note.url).toBe('https://example.test/v/ap_bucket/cached-note.txt');
	});

	test('purges /v and /a file resolve caches when a file is deleted', async () => {
		const { token, bucketId, fileId } = await setupPublicFile('delete-cached.txt');

		const viewRes = await app.request('https://example.test/v/ap_bucket/delete-cached.txt', {}, envWithAssets());
		expect(viewRes.headers.get('X-Cache')).toBe('MISS');
		await viewRes.text();
		const noteRes = await app.request(`https://example.test/a/files/${fileId}`, {}, env);
		expect(noteRes.headers.get('X-Cache')).toBe('MISS');
		await noteRes.text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const deleteRes = await app.request('https://example.test/api/files/delete', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({ bucketId, path: 'delete-cached.txt' }),
		}, env);
		expect(deleteRes.status).toBe(200);
		await new Promise(resolve => setTimeout(resolve, 0));

		const afterDeleteViewRes = await app.request('https://example.test/v/ap_bucket/delete-cached.txt', {}, envWithAssets());
		expect(afterDeleteViewRes.status).toBe(200);
		expect(afterDeleteViewRes.headers.get('X-Cache')).toBe('MISS');
		expect(afterDeleteViewRes.headers.get('Link')).toBeNull();
		expect(await afterDeleteViewRes.text()).not.toContain(`/a/files/${fileId}`);

		const afterDeleteNoteRes = await app.request(`https://example.test/a/files/${fileId}`, {}, env);
		expect(afterDeleteNoteRes.status).toBe(404);
	});

	test('purges /v and /a file resolve caches when a public file is unlisted', async () => {
		const { token, bucketId, fileId } = await setupPublicFile('unlist-cached.txt');

		await (await app.request('https://example.test/v/ap_bucket/unlist-cached.txt', {}, envWithAssets())).text();
		await (await app.request(`https://example.test/a/files/${fileId}`, {}, env)).text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const updateRes = await app.request('https://example.test/api/files/update-listing', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({ bucketId, isListed: false, targets: [{ type: 'file', path: 'unlist-cached.txt' }] }),
		}, env);
		expect(updateRes.status).toBe(200);
		await new Promise(resolve => setTimeout(resolve, 0));

		const viewRes = await app.request('https://example.test/v/ap_bucket/unlist-cached.txt', {}, envWithAssets());
		expect(viewRes.headers.get('X-Cache')).toBe('MISS');
		expect(viewRes.headers.get('Link')).toBeNull();
		expect(await viewRes.text()).not.toContain(`/a/files/${fileId}`);

		const noteRes = await app.request(`https://example.test/a/files/${fileId}`, {}, env);
		expect(noteRes.status).toBe(404);
	});

	test('purges query-normalized resolve caches when a public file is unlisted', async () => {
		const { token, bucketId, fileId } = await setupPublicFile('unlist-query-cached.txt');
		const viewUrl = 'https://example.test/v/ap_bucket/unlist-query-cached.txt';

		await (await app.request(`${viewUrl}?preview=1`, {}, envWithAssets())).text();
		await (await app.request(`https://example.test/a/files/${fileId}?preview=1`, {}, env)).text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const updateRes = await app.request('https://example.test/api/files/update-listing', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({ bucketId, isListed: false, targets: [{ type: 'file', path: 'unlist-query-cached.txt' }] }),
		}, env);
		expect(updateRes.status).toBe(200);
		await new Promise(resolve => setTimeout(resolve, 0));

		const viewRes = await app.request(`${viewUrl}?preview=2`, {}, envWithAssets());
		expect(viewRes.headers.get('X-Cache')).toBe('MISS');
		expect(viewRes.headers.get('Link')).toBeNull();
		expect(await viewRes.text()).not.toContain(`/a/files/${fileId}`);

		const noteRes = await app.request(`https://example.test/a/files/${fileId}?preview=2`, {}, env);
		expect(noteRes.status).toBe(404);
	});

	test('purges old and new resolve cache paths when a file is renamed', async () => {
		const { token, bucketId, fileId } = await setupPublicFile('before-rename.txt');
		const oldUrl = 'https://example.test/v/ap_bucket/before-rename.txt';
		const newUrl = 'https://example.test/v/ap_bucket/after-rename.txt';

		await (await app.request(oldUrl, {}, envWithAssets())).text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const moveRes = await app.request('https://example.test/api/files/move', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				type: 'file',
				sourceBucketId: bucketId,
				sourcePath: 'before-rename.txt',
				targetBucketId: bucketId,
				targetPath: 'after-rename.txt',
			}),
		}, env);
		expect(moveRes.status).toBe(200);
		await new Promise(resolve => setTimeout(resolve, 0));

		const oldRes = await app.request(oldUrl, {}, envWithAssets());
		expect(oldRes.headers.get('X-Cache')).toBe('MISS');
		expect(oldRes.headers.get('Link')).toBeNull();
		await oldRes.text();

		const newRes = await app.request(newUrl, {}, envWithAssets());
		expect(newRes.headers.get('X-Cache')).toBe('MISS');
		expect(newRes.headers.get('Link')).toContain(`/a/files/${fileId}`);
		expect(await newRes.text()).toContain(`/a/files/${fileId}`);
	});

	test('purges bucket actor resolve cache when a bucket is deleted', async () => {
		const { token, bucketId } = await setupPublicFile('bucket-delete.txt');

		const firstRes = await app.request(`https://example.test/a/buckets/${bucketId}`, {}, env);
		expect(firstRes.status).toBe(200);
		expect(firstRes.headers.get('X-Cache')).toBe('MISS');
		await firstRes.text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const deleteRes = await app.request('https://example.test/api/buckets/delete', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({ bucketId }),
		}, env);
		expect(deleteRes.status).toBe(200);
		await new Promise(resolve => setTimeout(resolve, 0));

		const afterDeleteRes = await app.request(`https://example.test/a/buckets/${bucketId}`, {}, env);
		expect(afterDeleteRes.status).toBe(404);
	});

	test('does not add ActivityPub alternate tags to unlisted file pages', async () => {
		await setupPublicFile('hidden.txt', { isListed: false });

		const res = await app.request('https://example.test/v/ap_bucket/hidden.txt', {}, envWithAssets());
		expect(res.status).toBe(200);
		expect(res.headers.get('Link')).toBeNull();
		expect(await res.text()).not.toContain('application/activity+json');
	});

	test('does not serve listed non-public files as Note', async () => {
		const { fileId: privateFileId } = await setupPublicFile('private.txt', { visibility: 'private', isListed: true });
		const { fileId: passphraseFileId } = await setupPublicFile('passphrase.txt', { visibility: 'passphrase', isListed: true, passphrase: 'secret' });

		const privateRes = await app.request(`https://example.test/a/files/${privateFileId}`, {}, env);
		expect(privateRes.status).toBe(404);
		const passphraseRes = await app.request(`https://example.test/a/files/${passphraseFileId}`, {}, env);
		expect(passphraseRes.status).toBe(404);
	});

	test('encodes file paths in public Note URLs', async () => {
		const { fileId } = await setupPublicFile('dir/hello #1 & 2.txt');

		const res = await app.request(`https://example.test/a/files/${fileId}`, {}, env);
		expect(res.status).toBe(200);
		const note = await res.json() as { content: string; url: string };
		expect(note.url).toBe('https://example.test/v/ap_bucket/dir/hello%20%231%20%26%202.txt');
		expect(note.content).toBe('<p>hello #1 &amp; 2.txt</p>');
	});

	test('serves a public tar entry as its own Note', async () => {
		const { token, fileId } = await setupPublicFile('archive.tar');

		await app.request('/api/files/create/tar-index', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				fileId,
				files: [{ path: 'dir/entry.txt', mimeType: 'text/plain', offset: 0, size: 5 }],
			}),
		}, env);

		const encodedEntryPath = encodeURIComponent('dir/entry.txt');
		const res = await app.request(`https://example.test/a/files/${fileId}/%3Aentries/${encodedEntryPath}`, {}, env);
		expect(res.status).toBe(200);
		const note = await res.json() as { id: string; url: string; attachment: Array<{ name: string; url: string }> };
		expect(note.id).toBe(`https://example.test/a/files/${fileId}/%3Aentries/${encodedEntryPath}`);
		expect(note.url).toBe(`https://example.test/v/ap_bucket/archive.tar/%3Aentries/${encodedEntryPath}`);
		expect(note.attachment[0]).toEqual(expect.objectContaining({
			name: 'entry.txt',
			url: `https://example.test/d/${fileId}/%3Aentries/${encodedEntryPath}`,
		}));
	});

	test('adds ActivityPub alternate tags to public archive entry pages', async () => {
		const { token, fileId } = await setupPublicFile('archive.tar');

		await app.request('/api/files/create/tar-index', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				fileId,
				files: [{ path: 'dir/entry.txt', mimeType: 'text/plain', offset: 0, size: 5 }],
			}),
		}, env);

		const encodedEntryPath = encodeURIComponent('dir/entry.txt');
		const href = `https://example.test/a/files/${fileId}/%3Aentries/${encodedEntryPath}`;
		const res = await app.request(`https://example.test/v/ap_bucket/archive.tar/%3Aentries/${encodedEntryPath}`, {}, envWithAssets());
		expect(res.status).toBe(200);
		expect(res.headers.get('Link')).toContain(`<${href}>; rel="alternate"; type="application/activity+json"`);
		expect(await res.text()).toContain(`<link rel="alternate" type="application/activity+json" href="${href}">`);
	});

	test('purges archive entry resolve caches when the archive is deleted', async () => {
		const { token, bucketId, fileId } = await setupPublicFile('delete-archive.tar');

		await app.request('/api/files/create/tar-index', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				fileId,
				files: [{ path: 'dir/entry.txt', mimeType: 'text/plain', offset: 0, size: 5 }],
			}),
		}, env);

		const encodedEntryPath = encodeURIComponent('dir/entry.txt');
		const viewUrl = `https://example.test/v/ap_bucket/delete-archive.tar/%3Aentries/${encodedEntryPath}`;
		const noteUrl = `https://example.test/a/files/${fileId}/%3Aentries/${encodedEntryPath}`;
		await (await app.request(viewUrl, {}, envWithAssets())).text();
		await (await app.request(noteUrl, {}, env)).text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const deleteRes = await app.request('https://example.test/api/files/delete', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({ bucketId, path: 'delete-archive.tar' }),
		}, env);
		expect(deleteRes.status).toBe(200);
		await new Promise(resolve => setTimeout(resolve, 0));

		const viewRes = await app.request(viewUrl, {}, envWithAssets());
		expect(viewRes.headers.get('X-Cache')).toBe('MISS');
		expect(viewRes.headers.get('Link')).toBeNull();
		await viewRes.text();

		const noteRes = await app.request(noteUrl, {}, env);
		expect(noteRes.status).toBe(404);
	});

	test('purges archive entry resolve caches when a directory is deleted', async () => {
		const { token, bucketId, fileId } = await setupPublicFile('dir/delete-archive.tar');

		await app.request('/api/files/create/tar-index', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				fileId,
				files: [{ path: 'dir/entry.txt', mimeType: 'text/plain', offset: 0, size: 5 }],
			}),
		}, env);

		const encodedEntryPath = encodeURIComponent('dir/entry.txt');
		const viewUrl = `https://example.test/v/ap_bucket/dir/delete-archive.tar/%3Aentries/${encodedEntryPath}`;
		const noteUrl = `https://example.test/a/files/${fileId}/%3Aentries/${encodedEntryPath}`;
		await (await app.request(viewUrl, {}, envWithAssets())).text();
		await (await app.request(noteUrl, {}, env)).text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const deleteRes = await app.request('https://example.test/api/directories/delete', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({ bucketId, path: 'dir/' }),
		}, env);
		expect(deleteRes.status).toBe(200);
		await new Promise(resolve => setTimeout(resolve, 0));

		const viewRes = await app.request(viewUrl, {}, envWithAssets());
		expect(viewRes.headers.get('X-Cache')).toBe('MISS');
		expect(viewRes.headers.get('Link')).toBeNull();
		await viewRes.text();

		const noteRes = await app.request(noteUrl, {}, env);
		expect(noteRes.status).toBe(404);
	});

	test('purges archive entry resolve caches when a bucket is deleted', async () => {
		const { token, bucketId, fileId } = await setupPublicFile('bucket-delete-archive.tar');

		await app.request('/api/files/create/tar-index', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				fileId,
				files: [{ path: 'dir/entry.txt', mimeType: 'text/plain', offset: 0, size: 5 }],
			}),
		}, env);

		const encodedEntryPath = encodeURIComponent('dir/entry.txt');
		const viewUrl = `https://example.test/v/ap_bucket/bucket-delete-archive.tar/%3Aentries/${encodedEntryPath}`;
		const noteUrl = `https://example.test/a/files/${fileId}/%3Aentries/${encodedEntryPath}`;
		await (await app.request(viewUrl, {}, envWithAssets())).text();
		await (await app.request(noteUrl, {}, env)).text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const deleteRes = await app.request('https://example.test/api/buckets/delete', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({ bucketId }),
		}, env);
		expect(deleteRes.status).toBe(200);
		await new Promise(resolve => setTimeout(resolve, 0));

		const viewRes = await app.request(viewUrl, {}, envWithAssets());
		expect(viewRes.headers.get('X-Cache')).toBe('MISS');
		expect(viewRes.headers.get('Link')).toBeNull();
		await viewRes.text();

		const noteRes = await app.request(noteUrl, {}, env);
		expect(noteRes.status).toBe(404);
	});

	test('purges archive entry resolve caches when an admin deletes an archive', async () => {
		const { token: adminToken } = await createAdminUser();
		const { token, fileId } = await setupPublicFile('admin-delete-archive.tar');

		await app.request('/api/files/create/tar-index', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				fileId,
				files: [{ path: 'dir/entry.txt', mimeType: 'text/plain', offset: 0, size: 5 }],
			}),
		}, env);

		const encodedEntryPath = encodeURIComponent('dir/entry.txt');
		const viewUrl = `https://example.test/v/ap_bucket/admin-delete-archive.tar/%3Aentries/${encodedEntryPath}`;
		const noteUrl = `https://example.test/a/files/${fileId}/%3Aentries/${encodedEntryPath}`;
		await (await app.request(viewUrl, {}, envWithAssets())).text();
		await (await app.request(noteUrl, {}, env)).text();
		await new Promise(resolve => setTimeout(resolve, 0));

		const deleteRes = await app.request('https://example.test/api/admin/delete-file', {
			method: 'POST',
			headers: authHeaders(adminToken),
			body: JSON.stringify({ fileId }),
		}, env);
		expect(deleteRes.status).toBe(200);
		await new Promise(resolve => setTimeout(resolve, 0));

		const viewRes = await app.request(viewUrl, {}, envWithAssets());
		expect(viewRes.headers.get('X-Cache')).toBe('MISS');
		expect(viewRes.headers.get('Link')).toBeNull();
		await viewRes.text();

		const noteRes = await app.request(noteUrl, {}, env);
		expect(noteRes.status).toBe(404);
	});

	test('does not serve entries from an unlisted public archive', async () => {
		const { token, fileId } = await setupPublicFile('hidden-archive.tar', { isListed: false });

		await app.request('/api/files/create/tar-index', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify({
				fileId,
				files: [{ path: 'dir/entry.txt', mimeType: 'text/plain', offset: 0, size: 5 }],
			}),
		}, env);

		const encodedEntryPath = encodeURIComponent('dir/entry.txt');
		const res = await app.request(`https://example.test/a/files/${fileId}/%3Aentries/${encodedEntryPath}`, {}, env);
		expect(res.status).toBe(404);
	});
});

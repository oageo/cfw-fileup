import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { env, app, setupDb, clearDb, signup, authHeaders } from './helpers';

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

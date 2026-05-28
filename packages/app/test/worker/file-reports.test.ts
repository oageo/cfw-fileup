import { describe, test, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env, app, setupDb, clearDb, signup, authHeaders } from './helpers';

beforeAll(async () => {
	await setupDb();
});

beforeEach(async () => {
	vi.restoreAllMocks();
	await clearDb();
});

async function createPublicFile(username: string, bucketName: string, path: string) {
	const { data } = await signup(username);
	const token = String(data.token);
	const userId = String(data.userId);

	const bucketRes = await app.request('/api/buckets/create', {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ bucketName }),
	}, env);
	expect(bucketRes.status).toBe(200);
	const { bucketId } = await bucketRes.json() as { bucketId: string };

	const openRes = await app.request('/api/files/create/open', {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ bucketId, path }),
	}, env);
	expect(openRes.status).toBe(200);
	const { fileId } = await openRes.json() as { fileId: string };

	await env.R2.put(fileId, `Content for ${path}`);
	const closeRes = await app.request('/api/files/create/close', {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify({ fileId, visibility: 'public' }),
	}, env);
	expect(closeRes.status).toBe(200);

	return { token, userId, bucketId, fileId };
}

function fileReportBody(fileId: string) {
	return {
		fileId,
		reporterName: 'Reporter',
		reporterEmail: 'reporter@gmail.com',
		reasonId: 'copyright',
		relationshipId: 'rights_holder',
		contact: null,
		summary: '',
		detail: '',
	};
}

function mailEnv(sent: Array<{ to: string; raw: string }>): typeof env {
	return Object.assign({}, env, {
		MAIL_FROM: 'noreply@example.com',
		MAIL_MX_CHECK_DISABLED: 'true',
		PUBLIC_APP_URL: 'https://files.example.com',
		MAILER: {
			async send(message: { to: string; raw?: string }): Promise<void> {
				sent.push({ to: message.to, raw: message.raw ?? '' });
			},
		},
	});
}

async function waitForSent(sent: unknown[], count: number): Promise<void> {
	for (let i = 0; i < 20 && sent.length < count; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

function mockMxLookup(): void {
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
		Status: 0,
		Answer: [{ type: 15, data: '10 mail.example.com.' }],
	}), { status: 200, headers: { 'Content-Type': 'application/dns-json' } }));
}

describe('POST /api/file-reports/create', () => {
	test('anonymous users can report a file', async () => {
		const { fileId } = await createPublicFile('owner', 'owner_bucket', 'hello.txt');

		const res = await app.request('/api/file-reports/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(fileReportBody(fileId)),
		}, env);

		expect(res.status).toBe(200);
		const body = await res.json() as { id: string };
		expect(typeof body.id).toBe('string');
	});

	test('logged-in users can report another user file and reporterUserId is recorded', async () => {
		const { token: adminToken, fileId } = await createPublicFile('owner', 'owner_bucket', 'hello.txt');
		const { data } = await signup('reporter');
		const reporterToken = String(data.token);
		const reporterUserId = String(data.userId);

		const createRes = await app.request('/api/file-reports/create', {
			method: 'POST',
			headers: authHeaders(reporterToken),
			body: JSON.stringify(fileReportBody(fileId)),
		}, env);
		expect(createRes.status).toBe(200);
		const created = await createRes.json() as { id: string };

		const detailRes = await app.request('/api/admin/get-file-report', {
			method: 'POST',
			headers: authHeaders(adminToken),
			body: JSON.stringify({ reportId: created.id }),
		}, env);
		expect(detailRes.status).toBe(200);
		const detail = await detailRes.json() as { reporterUserId: string | null };
		expect(detail.reporterUserId).toBe(reporterUserId);
	});

	test('owners cannot report their own file', async () => {
		const { token, fileId } = await createPublicFile('owner', 'owner_bucket', 'hello.txt');

		const res = await app.request('/api/file-reports/create', {
			method: 'POST',
			headers: authHeaders(token),
			body: JSON.stringify(fileReportBody(fileId)),
		}, env);

		expect(res.status).toBe(403);
	});

	test('sends only a report receipt to the reporter email address', async () => {
		mockMxLookup();
		const sent: Array<{ to: string; raw: string }> = [];
		const customEnv = mailEnv(sent);
		const { fileId } = await createPublicFile('owner', 'owner_bucket', 'hello.txt');
		const body = {
			...fileReportBody(fileId),
			summary: 'Copyrighted file',
			detail: 'This file includes my work.',
		};

		const res = await app.request('/api/file-reports/create', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		}, customEnv);

		expect(res.status).toBe(200);
		const created = await res.json() as { id: string };
		await waitForSent(sent, 1);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe('reporter@gmail.com');
		expect(sent[0]?.raw).toContain(created.id);
		expect(sent[0]?.raw).toContain(fileId);
		expect(sent[0]?.raw).toContain('通報を受け付けました');
		expect(sent[0]?.raw).not.toContain('Copyrighted file');
		expect(sent[0]?.raw).not.toContain('This file includes my work.');
	});
});

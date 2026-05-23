import type { FullConfig } from '@playwright/test';

export const E2E_ADMIN_USERNAME = 'e2e_admin';
export const E2E_ADMIN_PASSWORD = 'e2e_password_123';
export const E2E_SIGNUP_PASSPHRASE = 'PASSPHRASE';

const sleep = async (ms: number): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, ms));
};

const waitForServer = async (baseURL: string): Promise<void> => {
	const deadline = Date.now() + 120_000;
	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			const res = await fetch(baseURL);
			if (res.ok) return;
		} catch (error) {
			lastError = error;
		}

		await sleep(500);
	}

	throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${baseURL}`);
};

export default async function globalSetup(config: FullConfig): Promise<void> {
	const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:5173';
	await waitForServer(baseURL);

	// Attempt to create the e2e admin user.
	// On a fresh DB the first signup automatically becomes admin.
	// On an existing DB this returns 409 (user exists) which is fine.
	const res = await fetch(`${baseURL}/api/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			username: E2E_ADMIN_USERNAME,
			password: E2E_ADMIN_PASSWORD,
			passphrase: E2E_SIGNUP_PASSPHRASE,
		}),
	});

	if (!res.ok && res.status !== 409) {
		const text = await res.text();
		console.warn(`[globalSetup] signup failed (${res.status}): ${text}`);
		console.warn('[globalSetup] Admin-only tests may fail. Run `pnpm test:e2e:fresh` for a clean state.');
	}
}

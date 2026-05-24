const ITERATIONS = 100_000;
const HASH_LENGTH_BITS = 256;
const HASH_LENGTH_BYTES = HASH_LENGTH_BITS / 8;
const SALT_LENGTH = 16;

// workerd supports Uint8Array base64 helpers, but Node v24.16.0 does not yet.
// Keep this btoa/atob path until the local test runtime catches up.
export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]!);
	}
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
	try {
		const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	} catch {
		return null;
	}
}

export async function hashPassword(password: string): Promise<Uint8Array> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		'PBKDF2',
		false,
		['deriveBits'],
	);

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt,
			hash: 'SHA-256',
			iterations: ITERATIONS,
		},
		keyMaterial,
		HASH_LENGTH_BITS,
	);

	const result = new Uint8Array(SALT_LENGTH + HASH_LENGTH_BYTES);
	result.set(salt, 0);
	result.set(new Uint8Array(derivedBits), SALT_LENGTH);
	return result;
}

export async function verifyPassword(password: string, stored: Uint8Array): Promise<boolean> {
	if (stored.length !== SALT_LENGTH + HASH_LENGTH_BYTES) return false;

	const salt = stored.slice(0, SALT_LENGTH);
	const expectedHash = stored.slice(SALT_LENGTH);
	const encoder = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		encoder.encode(password),
		'PBKDF2',
		false,
		['deriveBits'],
	);

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt,
			hash: 'SHA-256',
			iterations: ITERATIONS,
		},
		keyMaterial,
		HASH_LENGTH_BITS,
	);

	const hash = new Uint8Array(derivedBits);
	return hash.length === expectedHash.length && hash.every((byte, i) => byte === expectedHash[i]);
}

export function generateToken(): string {
	return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function tokenToBytes(token: string): Uint8Array<ArrayBuffer> | null {
	const bytes = base64UrlToBytes(token);
	return bytes?.length === 32 ? bytes : null;
}

import { lookup } from 'mrmime';

const executableMimeTypes = new Set([
	'application/vnd.microsoft.portable-executable',
	'application/x-msdownload',
	'application/x-msdos-program',
	'application/x-dosexec',
	'application/x-executable',
	'application/x-elf',
	'application/wasm',
]);

const executableExtensions = new Set(['bat', 'cmd', 'com', 'exe', 'msi', 'ps1', 'sh', 'wasm']);

export function inferMimeTypeByExtension(path: string): string | undefined {
	return lookup(path);
}

function normalizeMimeType(mimeType: string): string {
	return mimeType.split(';', 1)[0].trim().toLowerCase();
}

export function preferExtensionMimeTypeForStorage(path: string, detectedMimeType: string | undefined): string | undefined {
	if (normalizeMimeType(detectedMimeType ?? '') === 'application/xml' && inferMimeTypeByExtension(path) === 'image/svg+xml') {
		return 'image/svg+xml';
	}
	return detectedMimeType;
}

function getExtension(path: string): string | undefined {
	const filename = path.split('/').pop() ?? path;
	return filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : undefined;
}

export function isExecutableMimeType(mimeType: string | undefined): boolean {
	if (!mimeType) return false;
	return executableMimeTypes.has(normalizeMimeType(mimeType));
}

export function hasExecutableExtension(path: string): boolean {
	const extension = getExtension(path);
	return extension != null && executableExtensions.has(extension);
}

export function looksLikeUtf8Text(bytes: Uint8Array): boolean {
	if (bytes.length === 0) return true;
	if (bytes.includes(0)) return false;
	try {
		const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		let suspiciousControlChars = 0;
		for (let i = 0; i < decoded.length; i++) {
			const charCode = decoded.charCodeAt(i);
			if (charCode < 0x20 && charCode !== 0x09 && charCode !== 0x0a && charCode !== 0x0d) {
				suspiciousControlChars++;
			}
		}
		return suspiciousControlChars / decoded.length < 0.02;
	} catch {
		return false;
	}
}

export function detectExecutableMimeType(bytes: Uint8Array): string | undefined {
	if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'application/x-msdownload';
	if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return 'application/x-elf';
	if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d) return 'application/wasm';
	if (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) return 'application/x-executable';
	if (bytes.length < 4) return undefined;
	const signature = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
	switch (signature >>> 0) {
		case 0xfeedface:
		case 0xfeedfacf:
		case 0xcefaedfe:
		case 0xcffaedfe:
		case 0xcafebabe:
			return 'application/x-executable';
		default:
			return undefined;
	}
}

export function hasMimeTypeMismatch(path: string, detectedMimeType: string | undefined): boolean {
	const extensionMimeType = inferMimeTypeByExtension(path);
	if (!extensionMimeType || !detectedMimeType) return false;

	const normalizedExtensionMimeType = normalizeMimeType(extensionMimeType);
	const normalizedDetectedMimeType = normalizeMimeType(detectedMimeType);
	if (normalizedExtensionMimeType === normalizedDetectedMimeType) return false;
	if (normalizedDetectedMimeType === 'application/octet-stream') return true;
	if (normalizedExtensionMimeType === 'application/octet-stream') return false;

	return true;
}

export function hasSuspiciousFileType(path: string, detectedMimeType: string | undefined): boolean {
	if (isExecutableMimeType(detectedMimeType) && !hasExecutableExtension(path)) return true;
	return hasMimeTypeMismatch(path, detectedMimeType);
}

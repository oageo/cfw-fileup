export const TEXT_PREVIEW_MAX_CHARS = 1000;
export const TEXT_PREVIEW_MAX_BYTES = 64 * 1024;

export interface TextPreviewResult {
	text: string;
	truncated: boolean;
}

function decodeTextPreviewBytes(bytes: Uint8Array): string {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return new TextDecoder('utf-8').decode(bytes.slice(3));
	}
	if (bytes[0] === 0xff && bytes[1] === 0xfe) {
		return new TextDecoder('utf-16le').decode(bytes.slice(2));
	}
	if (bytes[0] === 0xfe && bytes[1] === 0xff) {
		return new TextDecoder('utf-16be').decode(bytes.slice(2));
	}

	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder('shift-jis').decode(bytes);
	}
}

function concatBytes(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export function limitTextPreviewChars(source: string): string {
	return source.length > TEXT_PREVIEW_MAX_CHARS
		? source.slice(0, TEXT_PREVIEW_MAX_CHARS)
		: source;
}

export async function readBlobTextPreview(blob: Blob): Promise<TextPreviewResult> {
	const truncated = blob.size > TEXT_PREVIEW_MAX_BYTES;
	const bytes = new Uint8Array(await blob.slice(0, truncated ? TEXT_PREVIEW_MAX_BYTES : undefined).arrayBuffer());
	const text = decodeTextPreviewBytes(bytes);
	return {
		text: truncated ? limitTextPreviewChars(text) : text,
		truncated,
	};
}

export async function readTextPreview(response: Response): Promise<TextPreviewResult> {
	const contentLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(contentLength) && contentLength <= TEXT_PREVIEW_MAX_BYTES) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		return { text: decodeTextPreviewBytes(bytes), truncated: false };
	}

	const reader = response.body?.getReader();
	if (!reader) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		const text = decodeTextPreviewBytes(bytes);
		const truncated = !Number.isFinite(contentLength) || contentLength > TEXT_PREVIEW_MAX_BYTES;
		return {
			text: truncated ? limitTextPreviewChars(text) : text,
			truncated,
		};
	}

	const chunks: Uint8Array[] = [];
	let received = 0;
	let reachedLimit = false;

	try {
		while (received < TEXT_PREVIEW_MAX_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			const remaining = TEXT_PREVIEW_MAX_BYTES - received;
			if (value.byteLength > remaining) {
				chunks.push(value.slice(0, remaining));
				received += remaining;
				reachedLimit = true;
				break;
			}
			chunks.push(value);
			received += value.byteLength;
		}
		if (received >= TEXT_PREVIEW_MAX_BYTES) reachedLimit = true;
	} finally {
		if (reachedLimit) await reader.cancel().catch(() => undefined);
	}

	const text = decodeTextPreviewBytes(concatBytes(chunks, received));

	return {
		text: limitTextPreviewChars(text),
		truncated: reachedLimit || !Number.isFinite(contentLength) || contentLength > TEXT_PREVIEW_MAX_BYTES,
	};
}

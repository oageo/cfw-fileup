import { isBgzf, createBgzfDecompressor } from 'bgzf';

declare global {
	interface WorkerGlobalScope {
		__WB_MANIFEST: unknown[];
	}
}

const sw = self as unknown as ServiceWorkerGlobalScope;
void self.__WB_MANIFEST;

// Issue #15: Individual file from BGZF tar.gz
// If the filename (from Content-Disposition) does not end with .gz but the
// content bytes are gzip, decompress before handing to the browser.
type PeekResult = { rebuilt: ReadableStream<Uint8Array<ArrayBuffer>> } & (
	| { gzip: false; bgzf: false }
	| { gzip: true; bgzf: boolean }
);

function getContentDispositionFilename(disposition: string | null): string {
	if (!disposition) return '';
	const parts = disposition.split(';').map(part => part.trim());
	const encodedPart = parts.find(part => part.toLowerCase().startsWith('filename*='));
	if (encodedPart) {
		const value = encodedPart.slice(encodedPart.indexOf('=') + 1).replace(/^"|"$/g, '');
		const match = value.match(/^([^']*)'[^']*'(.*)$/);
		if (match && match[1].toLowerCase() === 'utf-8') {
			try {
				return decodeURIComponent(match[2]);
			} catch {
				return match[2];
			}
		}
	}
	const filenamePart = parts.find(part => part.toLowerCase().startsWith('filename='));
	if (!filenamePart) return '';
	return filenamePart.slice(filenamePart.indexOf('=') + 1).replace(/^"|"$/g, '');
}

function toAsciiFilenameFallback(filename: string): string {
	const fallback = filename
		.replace(/[^\x20-\x7e]/g, '_')
		.replace(/["\\]/g, '_')
		.trim();
	return fallback || 'download';
}

function createContentDisposition(filename: string): string {
	return `attachment; filename="${toAsciiFilenameFallback(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function peekStream(body: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<PeekResult | null> {
	const reader = body.getReader();
	const { done, value: firstChunk } = await reader.read();
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (done || !firstChunk) return null;

	const rebuilt = new ReadableStream<Uint8Array<ArrayBuffer>>({
		start(controller) { controller.enqueue(firstChunk); },
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				controller.close();
			} else {
				controller.enqueue(value);
			}
		},
		cancel() { reader.releaseLock(); },
	});

	const gzip = firstChunk.length >= 2 && firstChunk[0] === 0x1f && firstChunk[1] === 0x8b;
	if (!gzip) return { rebuilt, gzip: false, bgzf: false };
	return { rebuilt, gzip: true, bgzf: isBgzf(firstChunk) };
}

async function handleDecompressDownload(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const originUrl = new URL(request.url);
	originUrl.searchParams.delete('decompress');
	const fetchTarget = new Request(originUrl, { headers: request.headers });

	const response = await fetch(fetchTarget);
	if (!response.body) return response;

	const peek = await peekStream(response.body);
	if (!peek) return response;
	const { rebuilt, bgzf, gzip } = peek;

	if (gzip) {
		const decompressed = bgzf
			? rebuilt.pipeThrough(createBgzfDecompressor())
			: rebuilt.pipeThrough(new DecompressionStream('gzip'));

		const newHeaders = new Headers(response.headers);
		newHeaders.delete('Content-Length');
		newHeaders.delete('Content-Encoding');
		newHeaders.delete('Content-Type');

		const rawFilename = getContentDispositionFilename(response.headers.get('content-disposition'))
			|| url.pathname.split('/').pop()
			|| '';
		const originalFilename = rawFilename.endsWith('.gz') ? rawFilename.slice(0, -3) : rawFilename;
		newHeaders.set('Content-Disposition', createContentDisposition(originalFilename));
		return new Response(decompressed, { status: response.status, headers: newHeaders });
	}

	return new Response(rebuilt, { status: response.status, headers: response.headers });
}

sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (!url.pathname.startsWith('/d/')) return;

	const params = url.searchParams;
	if (params.has('decompress') && !params.has('list') && !params.has('file')) {
		event.respondWith(handleDecompressDownload(event.request));
	}
});

sw.skipWaiting();
sw.addEventListener('activate', (event) => {
	event.waitUntil(sw.clients.claim());
});

import { apiError } from './api-error';

export const MAX_BGZF_EDGE_BLOCK_BYTES = 128 * 1024;

type TarIndexEntry = {
	offset: number;
	size: number;
};

type TargzIndexEntry = {
	aStart: number;
	aFirstEnd: number;
	aFinalStart: number;
	aEnd: number;
	rStartOffset: number;
	rEndOffset: number;
};

function assertSafeNonNegativeInteger(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw apiError(400, 'INVALID_FILE_PATH');
	}
}

function assertRangeEndWithinFile(offset: number, length: number, fileSize: number): void {
	if (offset > fileSize || length > fileSize - offset) {
		throw apiError(400, 'INVALID_FILE_PATH');
	}
}

export function assertValidTarIndexEntry(entry: TarIndexEntry, fileSize: number): void {
	assertSafeNonNegativeInteger(entry.offset);
	assertSafeNonNegativeInteger(entry.size);
	assertRangeEndWithinFile(entry.offset, entry.size, fileSize);
}

export function assertValidTargzIndexEntry(entry: TargzIndexEntry, fileSize: number): void {
	for (const value of [
		entry.aStart,
		entry.aFirstEnd,
		entry.aFinalStart,
		entry.aEnd,
		entry.rStartOffset,
		entry.rEndOffset,
	]) {
		assertSafeNonNegativeInteger(value);
	}

	if (
		entry.aStart > entry.aFirstEnd
		|| entry.aFirstEnd > entry.aEnd
		|| entry.aStart > entry.aFinalStart
		|| entry.aFinalStart > entry.aEnd
		|| (entry.aStart !== entry.aFinalStart && entry.aFirstEnd > entry.aFinalStart)
	) {
		throw apiError(400, 'INVALID_FILE_PATH');
	}
	assertRangeEndWithinFile(entry.aStart, entry.aEnd - entry.aStart, fileSize);

	const firstBlockLength = entry.aFirstEnd - entry.aStart;
	const lastBlockLength = entry.aEnd - entry.aFinalStart;
	if (firstBlockLength > MAX_BGZF_EDGE_BLOCK_BYTES || lastBlockLength > MAX_BGZF_EDGE_BLOCK_BYTES) {
		throw apiError(400, 'INVALID_FILE_PATH');
	}
}

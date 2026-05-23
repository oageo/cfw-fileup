export type ByteSizeUnit = 'B' | 'KiB' | 'MiB' | 'GiB' | 'TiB';

export const BYTE_SIZE_UNITS: readonly ByteSizeUnit[] = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

export function byteSizeUnitMultiplier(unit: ByteSizeUnit): number {
	return 1024 ** BYTE_SIZE_UNITS.indexOf(unit);
}

export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const unitIndex = Math.min(BYTE_SIZE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / 1024 ** unitIndex;
	if (unitIndex === 0) return `${bytes} B`;
	return `${value.toFixed(1)} ${BYTE_SIZE_UNITS[unitIndex]}`;
}

export function pickByteSizeUnit(bytes: number | null): ByteSizeUnit {
	if (bytes == null || bytes === 0) return 'MiB';
	for (let i = BYTE_SIZE_UNITS.length - 1; i >= 0; i--) {
		const unit = BYTE_SIZE_UNITS[i]!;
		const multiplier = byteSizeUnitMultiplier(unit);
		if (bytes >= multiplier && bytes % multiplier === 0) return unit;
	}
	return 'B';
}

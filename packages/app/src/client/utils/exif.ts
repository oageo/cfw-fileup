import * as ExifReader from 'exifreader';

export type ExifDisplayItem = {
	label: string;
	value: string;
};

type ExifTag = {
	description?: string;
	value?: unknown;
	computed?: unknown;
};

type ExifTags = Record<string, ExifTag | undefined> & {
	gps?: {
		Latitude?: number;
		Longitude?: number;
	};
};

const displayTags: Array<[label: string, keys: string[]]> = [
	['撮影日時', ['DateTimeOriginal', 'DateTime']],
	['カメラ', ['Make', 'Model']],
	['レンズ', ['LensModel']],
	['露出', ['ExposureTime', 'ShutterSpeedValue']],
	['F値', ['FNumber', 'ApertureValue']],
	['ISO', ['ISOSpeedRatings', 'PhotographicSensitivity']],
	['焦点距離', ['FocalLength']],
	['画像サイズ', ['Image Width', 'Image Height', 'PixelXDimension', 'PixelYDimension']],
	['向き', ['Orientation']],
	['ソフトウェア', ['Software']],
];

function tagValue(tags: ExifTags, key: string): string | undefined {
	const tag = tags[key];
	if (!tag) return undefined;
	if (typeof tag.description === 'string' && tag.description.trim()) return tag.description.trim();
	if (typeof tag.computed === 'string') return tag.computed.trim() || undefined;
	if (typeof tag.computed === 'number') return String(tag.computed);
	if (typeof tag.value === 'string') return tag.value.trim() || undefined;
	if (typeof tag.value === 'number') return String(tag.value);
	if (Array.isArray(tag.value)) {
		return tag.value
			.map(value => typeof value === 'string' || typeof value === 'number' ? String(value) : '')
			.filter(Boolean)
			.join(' ')
			.trim() || undefined;
	}
	return undefined;
}

function add(items: ExifDisplayItem[], label: string, value: string | undefined): void {
	if (value) items.push({ label, value });
}

function firstTagValue(tags: ExifTags, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = tagValue(tags, key);
		if (value) return value;
	}
	return undefined;
}

function imageSizeValue(tags: ExifTags): string | undefined {
	const fileWidth = firstTagValue(tags, ['Image Width', 'PixelXDimension']);
	const fileHeight = firstTagValue(tags, ['Image Height', 'PixelYDimension']);
	return fileWidth && fileHeight ? `${fileWidth} x ${fileHeight}` : undefined;
}

function cameraValue(tags: ExifTags): string | undefined {
	return ['Make', 'Model']
		.map(key => tagValue(tags, key))
		.filter(Boolean)
		.filter((value, index, values) => values.indexOf(value) === index)
		.join(' ') || undefined;
}

export function parseExifDisplayItems(bytes: Uint8Array): ExifDisplayItem[] {
	const tags = ExifReader.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { expanded: false, computed: true }) as ExifTags;
	const items: ExifDisplayItem[] = [];

	for (const [label, keys] of displayTags) {
		const value = label === '画像サイズ'
			? imageSizeValue(tags)
			: label === 'カメラ'
				? cameraValue(tags)
				: firstTagValue(tags, keys);
		add(items, label, value);
	}
	if (typeof tags.gps?.Latitude === 'number' && typeof tags.gps.Longitude === 'number') {
		add(items, 'GPS', `${tags.gps.Latitude.toFixed(6)}, ${tags.gps.Longitude.toFixed(6)}`);
	} else {
		const latitude = firstTagValue(tags, ['GPSLatitude']);
		const longitude = firstTagValue(tags, ['GPSLongitude']);
		add(items, 'GPS', latitude && longitude ? `${latitude}, ${longitude}` : undefined);
	}

	return items;
}

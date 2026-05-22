import * as v from 'valibot';

const VALID_NAME_PATTERN = /^[0-9a-zA-Z_]+$/;
const INVALID_PATH_SEGMENT_CHARS_PATTERN = /[\u0000-\u001F\u007F<>:"|?*\\/]/;

export const NAME_FORMAT_ERROR = '英数字とアンダースコア [0-9a-zA-Z_] のみ使用できます';
export const PATH_SEGMENT_FORMAT_ERROR = '名前に制御文字、/、\\、< > : " | ? * は使えません。また、末尾をスペースやドットにはできません';
export const FILE_PATH_FORMAT_ERROR = 'ファイルパスに使用できない名前が含まれています';
export const DIRECTORY_PATH_FORMAT_ERROR = 'ディレクトリパスに使用できない名前が含まれています';

/** 名前が使用可能な文字のみで構成されているか確認 */
export function isValidNameFormat(name: string): boolean {
	return VALID_NAME_PATTERN.test(name);
}

/** ユーザー名/バケット名のフォーマット検証 valibot アクション */
export const nameFormatValidation = v.regex(VALID_NAME_PATTERN, NAME_FORMAT_ERROR);

/** ファイル/ディレクトリパスの1セグメントが使用可能な文字のみで構成されているか確認 */
export function isValidPathSegmentName(name: string): boolean {
	return name.length > 0
		&& name !== '.'
		&& name !== '..'
		&& !INVALID_PATH_SEGMENT_CHARS_PATTERN.test(name)
		&& !/[ .]$/.test(name)
		&& !/ \./.test(name);
}

export function getInvalidPathSegment(path: string, options: { allowTrailingSlash: boolean }): string | null {
	if (path === '') return '';
	if (path.startsWith('/') || path.startsWith('\\')) return path[0] ?? '';
	const trimmed = options.allowTrailingSlash && path.endsWith('/') ? path.slice(0, -1) : path;
	if (trimmed === '') return '';
	const segments = trimmed.split('/');
	for (const segment of segments) {
		if (!isValidPathSegmentName(segment)) return segment;
	}
	return null;
}

/** ファイルパスが使用可能な名前セグメントのみで構成されているか確認 */
export function isValidFilePath(path: string): boolean {
	return getInvalidPathSegment(path, { allowTrailingSlash: false }) === null && !path.endsWith('/');
}

/** ディレクトリパスが使用可能な名前セグメントのみで構成されているか確認 */
export function isValidDirectoryPath(path: string): boolean {
	return getInvalidPathSegment(path, { allowTrailingSlash: true }) === null;
}

/** ファイル/ディレクトリ名のフォーマット検証 valibot アクション */
export const pathSegmentNameValidation = v.check(isValidPathSegmentName, PATH_SEGMENT_FORMAT_ERROR);
export const filePathValidation = v.check(isValidFilePath, FILE_PATH_FORMAT_ERROR);
export const directoryPathValidation = v.check(isValidDirectoryPath, DIRECTORY_PATH_FORMAT_ERROR);

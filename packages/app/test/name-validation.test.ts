import { describe, expect, test } from 'vitest';
import { getInvalidPathSegment, isValidDirectoryPath, isValidFilePath, isValidPathSegmentName } from '../src/shared/name-validation';

describe('path segment name validation', () => {
	test.each([
		'日本語.txt',
		'hello world.txt',
		'a_b-1.2.txt',
		'子',
	])('allows valid segment: %s', (name) => {
		expect(isValidPathSegmentName(name)).toBe(true);
	});

	test.each([
		{ label: 'unicode nested path', path: 'dir/子/file.txt' },
	])('allows valid file path: $label', ({ path }) => {
		expect(isValidFilePath(path)).toBe(true);
	});

	test.each([
		{ label: 'unicode directory path', path: 'dir/子/' },
	])('allows valid directory path: $label', ({ path }) => {
		expect(isValidDirectoryPath(path)).toBe(true);
	});

	test.each([
		{ label: '<empty>', path: '' },
		{ label: 'empty segment', path: 'a//b.txt' },
		{ label: 'parent traversal', path: '../x' },
		{ label: 'current directory segment', path: './x' },
		{ label: 'backslash', path: 'a\\b.txt' },
		{ label: 'colon', path: 'a:b.txt' },
		{ label: 'question mark', path: 'bad?.txt' },
		{ label: 'space before dot', path: 'trailingspace .txt' },
		{ label: 'trailing dot', path: 'trailingdot..' },
		{ label: '<control char>', path: 'bad\u0001.txt' },
	])('rejects invalid file path: $label', ({ path }) => {
		expect(isValidFilePath(path)).toBe(false);
		expect(getInvalidPathSegment(path, { allowTrailingSlash: false })).not.toBeNull();
	});
});

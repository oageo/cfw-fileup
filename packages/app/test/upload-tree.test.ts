import { describe, expect, test } from 'vitest';
import { UploadTree } from '../src/client/utils/upload-tree';

const enc = new TextEncoder();

function file(name: string, content = name, type = 'text/plain'): File {
	return new File([enc.encode(content)], name, { type, lastModified: 1 });
}

function withRelativePath(base: File, path: string): File {
	Object.defineProperty(base, 'webkitRelativePath', { value: path });
	return base;
}

interface MockFileSystemEntry {
	name: string;
	fullPath: string;
	isFile: boolean;
	isDirectory: boolean;
}

interface MockFileSystemFileEntry extends MockFileSystemEntry {
	file(success: (file: File) => void): void;
}

interface MockFileSystemDirectoryEntry extends MockFileSystemEntry {
	createReader(): { readEntries(success: (entries: MockFileSystemEntry[]) => void): void };
}

function mockEntryFile(name: string, content = name): MockFileSystemFileEntry {
	return {
		name,
		fullPath: `/${name}`,
		isFile: true,
		isDirectory: false,
		file: (success) => success(file(name, content)),
	};
}

function mockEntryDir(name: string, entries: MockFileSystemEntry[]): MockFileSystemDirectoryEntry {
	let done = false;
	return {
		name,
		fullPath: `/${name}`,
		isFile: false,
		isDirectory: true,
		createReader: () => ({
			readEntries: (success) => {
				if (done) {
					success([]);
					return;
				}
				done = true;
				success(entries);
			},
		}),
	};
}

function mockDataTransferItems(entries: MockFileSystemEntry[]): DataTransferItemList {
	const items = entries.map(entry => ({
		kind: 'file',
		webkitGetAsEntry: () => entry,
		getAsFile: () => null,
	}));
	return Object.assign(items, {
		add: () => null,
		clear: () => undefined,
		remove: () => undefined,
	}) as unknown as DataTransferItemList;
}

function mockFileHandle(name: string, content = name): FileSystemFileHandle {
	const handleFile = file(name, content);
	return { kind: 'file', name, getFile: async () => handleFile } as unknown as FileSystemFileHandle;
}

function mockDirHandle(name: string, entries: Array<[string, FileSystemHandle]>): FileSystemDirectoryHandle {
	return {
		kind: 'directory',
		name,
		getFileHandle: async () => mockFileHandle('unused'),
		[Symbol.asyncIterator]() {
			let i = 0;
			return {
				async next() {
					if (i >= entries.length) return { done: true as const, value: undefined as unknown as [string, FileSystemHandle] };
					return { done: false as const, value: entries[i++] };
				},
			};
		},
	} as unknown as FileSystemDirectoryHandle;
}

describe('UploadTree', () => {
	test('builds from File[]', async () => {
		const tree = await UploadTree.from([file('b.txt'), file('a.txt')]);
		expect(tree.entries.map(entry => entry.path)).toEqual(['a.txt', 'b.txt']);
		expect(tree.totalSize).toBe(10);
		expect(tree.hasDirectories).toBe(false);
	});

	test('uses webkitRelativePath from folder inputs', async () => {
		const tree = await UploadTree.from([
			withRelativePath(file('a.txt'), 'root/a.txt'),
			withRelativePath(file('b.txt'), 'root/sub/b.txt'),
		]);
		expect(tree.rootName).toBe('root');
		expect(tree.entries.map(entry => entry.path)).toEqual(['root/a.txt', 'root/sub/b.txt']);
		expect(tree.hasDirectories).toBe(true);
	});

	test('reads directories from webkitGetAsEntry drag items', async () => {
		const items = mockDataTransferItems([
			mockEntryDir('drop', [
				mockEntryFile('a.txt'),
				mockEntryDir('sub', [mockEntryFile('b.txt')]),
			]),
		]);
		const tree = await UploadTree.from(items);
		expect(tree.entries.map(entry => entry.path)).toEqual(['drop/a.txt', 'drop/sub/b.txt']);
	});

	test('walks FileSystemDirectoryHandle inputs', async () => {
		const dir = mockDirHandle('picked', [
			['a.txt', mockFileHandle('a.txt')],
			['sub', mockDirHandle('sub', [['b.txt', mockFileHandle('b.txt')]]) as unknown as FileSystemHandle],
		]);
		const tree = await UploadTree.from(dir);
		expect(tree.rootName).toBe('picked');
		expect(tree.entries.map(entry => entry.path)).toEqual(['a.txt', 'sub/b.txt']);
	});

	test('copies another UploadTree', async () => {
		const source = await UploadTree.from([file('a.txt')], { rootName: 'source' });
		const copy = await UploadTree.from(source, { rootName: 'copy' });
		expect(copy).not.toBe(source);
		expect(copy.rootName).toBe('copy');
		expect(copy.entries.map(entry => entry.path)).toEqual(['a.txt']);
	});

	test('rejects invalid and duplicate paths', async () => {
		await expect(UploadTree.from({ entries: [{ path: '../bad.txt', file: file('bad.txt') }] })).rejects.toThrow('Invalid upload path');
		await expect(UploadTree.from({ entries: [
			{ path: 'same.txt', file: file('same.txt') },
			{ path: 'same.txt', file: file('same.txt') },
		] })).rejects.toThrow('Duplicate upload path');
	});
});

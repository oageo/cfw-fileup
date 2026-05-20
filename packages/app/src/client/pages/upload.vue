<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import type { FileVisibility } from '../../shared/file-visibility';
import { Button, Popover, Progress } from '@vuetify/v0';
import { authHeaders, authStore } from '../store/auth';
import { apiPost } from '../utils/api';
import NirA from '@/components/nira.vue';
import { TarArchiver, BgzfTarArchiver, type TarIndex, type TarGzIndex, type ArchiveProgress } from 'bgzf';
import { takePendingUpload } from '@/store/pending-upload';
import UploadDestinationDialog from '@/components/upload-destination-dialog.vue';
import ConfirmDialog from '@/components/confirm-dialog.vue';
import { MAX_FILE_PATH_LENGTH } from '../../shared/const';
import { UploadTree, type UploadDirectory, type UploadEntry } from '@/utils/upload-tree';

type ArchiveMode = 'individual' | 'gz' | 'tar' | 'targz';

interface Bucket {
	id: string;
	name: string;
	usedBytes: number;
}

/** デフォルトのチャンクサイズ: 32MiB
 * R2のマルチパートアップロードはパートごとにClass A操作となるため、
 * コストを抑えるためにデフォルトを大きく設定する。
 * サーバーからpartSizeが返された場合はそちらを優先する。
 */
const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024;

const buckets = ref<Bucket[]>([]);
const selectedBucketName = ref('');
const destinationDialogOpen = ref(false);
const bucket = computed(() => buckets.value.find(b => b.name === selectedBucketName.value) ?? null);
const maxBucketSizeBytes = ref<number | null>(null);
const loadError = ref('');

const selectedTree = ref<UploadTree | null>(null);
const selectedEntry = ref<UploadEntry | null>(null);
const uploadPrefix = ref('');
const archiveMode = ref<ArchiveMode>('individual');
const libraryName = ref('');
const visibility = ref<FileVisibility>('public');
const passphrase = ref('');
const isDragOver = ref(false);
const selectionError = ref('');
const previewUrl = ref('');
const previewText = ref('');
const previewLoading = ref(false);
const fileRowElements = ref(new Map<string, HTMLButtonElement>());
interface UploadProgress {
	filename: string;
	fileIndex: number;
	totalFiles: number;
	uploadedBytes: number;
	totalBytes: number;
}

const uploadProgress = ref<UploadProgress | null>(null);
const uploadError = ref('');
const uploadDone = ref(false);
const quotaWarningOpen = ref(false);
const quotaWarningConfirmed = ref(false);

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function getUploadPaths(): string[] {
	if (!selectedTree.value) return [];
	if (archiveMode.value === 'tar') return [`${uploadPrefix.value}${archiveUploadBaseName.value}.tar`];
	if (archiveMode.value === 'targz') return [`${uploadPrefix.value}${archiveUploadBaseName.value}.tar.gz`];
	return selectedTree.value.entries.map(entry =>
		archiveMode.value === 'gz'
			? `${uploadPrefix.value}${entry.path}.gz`
			: `${uploadPrefix.value}${entry.path}`,
	);
}

function validateUploadPaths(paths: string[]): boolean {
	if ((archiveMode.value === 'tar' || archiveMode.value === 'targz') && /[\\/]/.test(archiveUploadBaseName.value)) {
		uploadError.value = 'ライブラリ名に / または \\ は使えません。';
		return false;
	}
	const tooLongPath = paths.find(path => path.length > MAX_FILE_PATH_LENGTH);
	if (!tooLongPath) return true;
	uploadError.value = `パスは${MAX_FILE_PATH_LENGTH}文字以内で入力してください: ${tooLongPath}`;
	return false;
}

const hasSelection = computed(() => selectedTree.value != null && selectedTree.value.entries.length > 0);
const archiveBaseName = computed(() => {
	if (!selectedTree.value) return 'archive';
	if (selectedTree.value.hasDirectories && selectedTree.value.rootName) return selectedTree.value.rootName;
	return selectedTree.value.entries[0]?.name.replace(/\.[^.]*$/, '') || 'archive';
});
const archiveUploadBaseName = computed(() => libraryName.value.trim() || archiveBaseName.value);
const flatDisplayEntries = computed(() => selectedTree.value ? flattenDirectory(selectedTree.value.root) : []);
const selectedUploadBytes = computed(() => selectedTree.value?.totalSize ?? 0);
const quotaRemainingBytes = computed(() => {
	if (!bucket.value || maxBucketSizeBytes.value === null) return null;
	return Math.max(0, maxBucketSizeBytes.value - bucket.value.usedBytes);
});
const isQuotaWarningNeeded = computed(() => (
	bucket.value != null
	&& maxBucketSizeBytes.value !== null
	&& selectedUploadBytes.value > quotaRemainingBytes.value!
));
const quotaWarningMessage = computed(() => {
	if (!bucket.value || maxBucketSizeBytes.value === null || quotaRemainingBytes.value === null) return '';
	return [
		`選択中のファイルは約 ${formatBytes(selectedUploadBytes.value)} です。`,
		`アップロード先バケットの残り容量は ${formatBytes(quotaRemainingBytes.value)} です。`,
		'圧縮後サイズによっては成功する場合もありますが、クォータ超過で失敗する可能性があります。',
	].join('\n');
});
const previewKind = computed(() => {
	const entry = selectedEntry.value;
	if (!entry) return 'empty';
	if (entry.type.startsWith('image/')) return 'image';
	if (entry.type.startsWith('video/')) return 'video';
	if (entry.type.startsWith('audio/')) return 'audio';
	if (entry.type === 'application/pdf') return 'pdf';
	if (isTextLike(entry)) return 'text';
	return 'meta';
});

async function loadBucket(): Promise<void> {
	const result = await apiPost('/api/buckets/list');
	if (!result.ok) {
		loadError.value = result.data.error;
		return;
	}
	buckets.value = result.data.buckets;
	maxBucketSizeBytes.value = result.data.maxBucketSizeBytes;
	if (!selectedBucketName.value && buckets.value.length > 0) {
		selectedBucketName.value = buckets.value[0].name;
	}
}

async function handleFileInputChange(event: Event): Promise<void> {
	const input = event.target as HTMLInputElement;
	await selectFiles(input.files);
	input.value = '';
}

async function selectFiles(files: FileList | null): Promise<void> {
	if (!files || files.length === 0) return;
	try {
		await addSelectedTree(await UploadTree.from(files));
	} catch (err) {
		selectionError.value = err instanceof Error ? err.message : String(err);
	}
}

async function handleDrop(event: DragEvent): Promise<void> {
	isDragOver.value = false;
	const data = event.dataTransfer;
	if (!data) return;
	try {
		await addSelectedTree(await UploadTree.from(data));
	} catch (err) {
		selectionError.value = err instanceof Error ? err.message : String(err);
	}
}

async function setSelectedTree(tree: UploadTree, entryToSelect: UploadEntry | null = tree.entries[0] ?? null): Promise<void> {
	selectionError.value = '';
	uploadError.value = '';
	uploadDone.value = false;
	selectedTree.value = tree;
	selectEntry(entryToSelect);
	if (archiveMode.value === 'gz' && tree.hasDirectories) archiveMode.value = 'individual';
}

async function addSelectedTree(tree: UploadTree): Promise<void> {
	if (!selectedTree.value) {
		await setSelectedTree(tree);
		return;
	}

	const entriesByPath = new Map<string, UploadEntry>();
	for (const entry of selectedTree.value.entries) entriesByPath.set(entry.path, entry);
	for (const entry of tree.entries) entriesByPath.set(entry.path, entry);
	const entries = Array.from(entriesByPath.values());
	const mergedTree = await UploadTree.from({
		entries,
		rootName: inferUploadRootName(entries.map(entry => entry.path)),
	});
	await setSelectedTree(mergedTree, tree.entries[0] ?? selectedEntry.value);
}

function clearSelectedTree(): void {
	selectedTree.value = null;
	selectEntry(null);
	selectionError.value = '';
	uploadError.value = '';
	uploadDone.value = false;
	uploadProgress.value = null;
}

async function removeSelectedEntry(path: string): Promise<void> {
	if (!selectedTree.value) return;
	const currentEntries = selectedTree.value.entries;
	const removeIndex = currentEntries.findIndex(entry => entry.path === path);
	if (removeIndex === -1) return;

	const entries = currentEntries.filter(entry => entry.path !== path);
	if (entries.length === 0) {
		clearSelectedTree();
		return;
	}

	const nextEntry = selectedEntry.value?.path === path
		? entries[Math.min(removeIndex, entries.length - 1)]
		: selectedEntry.value;
	const nextTree = await UploadTree.from({
		entries,
		rootName: inferUploadRootName(entries.map(entry => entry.path)),
	});
	await setSelectedTree(nextTree, nextEntry);
}

function inferUploadRootName(paths: readonly string[]): string {
	if (paths.length === 0) return '';
	const first = paths[0].split('/')[0] ?? '';
	return paths.every(path => path.split('/')[0] === first) ? first : '';
}

interface FlatDisplayDirectory {
	type: 'dir';
	key: string;
	name: string;
	path: string;
	depth: number;
}

interface FlatDisplayFile {
	type: 'file';
	key: string;
	entry: UploadEntry;
	depth: number;
}

type FlatDisplayEntry = FlatDisplayDirectory | FlatDisplayFile;

function flattenDirectory(dir: UploadDirectory, depth = -1): FlatDisplayEntry[] {
	const result: FlatDisplayEntry[] = [];
	for (const child of dir.directories) {
		result.push({ type: 'dir', key: `dir:${child.path}`, name: child.name, path: child.path, depth: depth + 1 });
		result.push(...flattenDirectory(child, depth + 1));
	}
	for (const entry of dir.files) {
		result.push({ type: 'file', key: `file:${entry.path}`, entry, depth: depth + 1 });
	}
	return result;
}

function isTextLike(entry: UploadEntry): boolean {
	return entry.type.startsWith('text/')
		|| /(?:^|\/)(?:json|xml|javascript|typescript|csv|yaml|x-yaml)$/.test(entry.type)
		|| /\.(?:txt|md|json|csv|ts|js|vue|css|scss|html|xml|ya?ml)$/i.test(entry.name);
}

function revokePreviewUrl(): void {
	if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
	previewUrl.value = '';
}

function setFileRowElement(path: string, element: unknown): void {
	if (element instanceof HTMLButtonElement) {
		fileRowElements.value.set(path, element);
	} else {
		fileRowElements.value.delete(path);
	}
}

function selectEntry(entry: UploadEntry | null, focus = false): void {
	selectedEntry.value = entry;
	if (!entry || !focus) return;
	requestAnimationFrame(() => {
		const element = fileRowElements.value.get(entry.path);
		element?.focus();
		element?.scrollIntoView({ block: 'nearest' });
	});
}

function moveSelectedEntry(direction: 1 | -1): void {
	const entries = selectedTree.value?.entries ?? [];
	if (entries.length === 0) return;
	const currentIndex = selectedEntry.value
		? entries.findIndex(entry => entry.path === selectedEntry.value?.path)
		: -1;
	const nextIndex = currentIndex === -1
		? direction === 1 ? 0 : entries.length - 1
		: Math.min(entries.length - 1, Math.max(0, currentIndex + direction));
	selectEntry(entries[nextIndex], true);
}

function onFileListKeydown(event: KeyboardEvent): void {
	if (event.key === 'ArrowDown') {
		event.preventDefault();
		moveSelectedEntry(1);
	} else if (event.key === 'ArrowUp') {
		event.preventDefault();
		moveSelectedEntry(-1);
	}
}

watch(selectedEntry, async (entry) => {
	revokePreviewUrl();
	previewText.value = '';
	previewLoading.value = false;
	if (!entry) return;
	if (
		entry.type.startsWith('image/')
		|| entry.type.startsWith('video/')
		|| entry.type.startsWith('audio/')
		|| entry.type === 'application/pdf'
	) {
		previewUrl.value = URL.createObjectURL(entry.file);
		return;
	}
	if (isTextLike(entry)) {
		previewLoading.value = true;
		try {
			previewText.value = await entry.file.slice(0, 64 * 1024).text();
		} finally {
			previewLoading.value = false;
		}
	}
}, { immediate: true });

onUnmounted(() => {
	revokePreviewUrl();
});

// ---- OPFS helpers ----

async function streamToOpfs(stream: ReadableStream<Uint8Array>, name: string): Promise<FileSystemFileHandle> {
	const root = await navigator.storage.getDirectory();
	const handle = await root.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	await stream.pipeTo(writable);
	return handle;
}

async function deleteFromOpfs(name: string): Promise<void> {
	const root = await navigator.storage.getDirectory();
	await root.removeEntry(name).catch(() => {});
}

// ---- TUS upload (Blob.slice — only CHUNK_SIZE bytes in memory at a time) ----

async function getResumeOffset(fileId: string): Promise<number> {
	const res = await fetch(`/upload/${fileId}/resume`, {
		headers: { 'Tus-Resumable': '1.0.0', ...authHeaders() },
	}).catch(() => null);
	if (!res?.ok) return -1;
	return parseInt(res.headers.get('Upload-Offset') ?? '-1', 10);
}

async function getUploadPartCount(fileId: string): Promise<number> {
	const result = await apiPost('/api/files/create/status', { fileId }).catch(() => null);
	if (!result?.ok) return -1;
	return result.data.partCount;
}

async function tusUpload(fileId: string, blob: Blob, filename: string, partSize: number, onProgress?: (uploaded: number) => void): Promise<boolean> {
	const total = blob.size;
	let offset = Math.max(0, await getResumeOffset(fileId));
	onProgress?.(offset);

	while (offset < total) {
		const chunk = blob.slice(offset, offset + partSize);
		const chunkIndex = offset / partSize; // 0始まりのチャンク番号
		let success = false;

		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const res = await fetch(`/upload/${fileId}/resume`, {
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/offset+octet-stream',
						'Upload-Offset': String(offset),
						'Content-Length': String(chunk.size),
						'Tus-Resumable': '1.0.0',
						...authHeaders(),
					},
					body: chunk,
				});
				if (res.ok) { success = true; break; }
				if (res.status >= 400 && res.status < 500) {
					const err = (await res.json().catch(() => ({}))) as { error?: string };
					uploadError.value = `アップロード失敗 (${filename}): ${err.error ?? res.status}`;
					return false;
				}
			} catch {
				// ネットワークエラー — コミット済みパーツ数で受信確認
				if (attempt < 2) {
					await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
					const partCount = await getUploadPartCount(fileId);
					if (partCount > chunkIndex) {
						offset = partCount * partSize;
						onProgress?.(offset);
						success = true;
						break;
					}
				}
			}
			if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
		}

		if (!success) {
			uploadError.value = `アップロード失敗 (${filename}): ネットワークエラー（リトライ上限）`;
			return false;
		}

		offset += chunk.size;
		onProgress?.(offset);
	}
	return true;
}

// ---- Core upload primitives ----

async function deleteExistingFile(path: string): Promise<boolean> {
	if (!bucket.value) return false;
	const result = await apiPost('/api/files/delete', { bucketId: bucket.value.id, path });
	return result.ok;
}

interface OpenUploadResult {
	fileId: string;
	partSize: number;
}

async function openUpload(path: string): Promise<OpenUploadResult | null> {
	if (!bucket.value) return null;
	// サーバーのデフォルト (32MiB) を使用するためpartSizeは省略可能
	const result = await apiPost('/api/files/create/open', { bucketId: bucket.value.id, path });
	if (!result.ok) { uploadError.value = result.data.error; return null; }
	return { fileId: result.data.fileId, partSize: result.data.partSize };
}

async function closeUpload(fileId: string): Promise<boolean> {
	const result = await apiPost('/api/files/create/close', { fileId, visibility: visibility.value, passphrase: passphrase.value || undefined });
	if (!result.ok) {
		uploadError.value = result.data.error;
		return false;
	}
	return true;
}

/** Upload a Blob (File or OPFS File) via TUS. */
async function uploadBlob(blob: Blob, path: string, onProgress?: (uploaded: number) => void): Promise<boolean> {
	const result = await openUpload(path);
	if (!result) return false;
	const { fileId, partSize } = result;
	if (!(await tusUpload(fileId, blob, path, partSize, onProgress)) || !(await closeUpload(fileId))) {
		await deleteExistingFile(path);
		return false;
	}
	return true;
}

/** Write stream to OPFS, upload as blob, delete temp file. */
async function uploadStream(stream: ReadableStream<Uint8Array>, path: string, onProgress?: (uploaded: number) => void): Promise<boolean> {
	const tmpName = `__up_${Date.now()}`;
	const handle = await streamToOpfs(stream, tmpName);
	const file = await handle.getFile();
	const ok = await uploadBlob(file, path, onProgress);
	await deleteFromOpfs(tmpName);
	return ok;
}

class TusChunkQueue {
	private fileId: string;
	private path: string;
	private partSize: number;
	private onUploadedBytes?: (total: number) => void;
	private queueChain: Promise<boolean> = Promise.resolve(true);
	private hasError = false;
	private pendingUploads: Promise<boolean>[] = [];

	constructor(fileId: string, path: string, partSize: number, onUploadedBytes?: (total: number) => void) {
		this.fileId = fileId;
		this.path = path;
		this.partSize = partSize;
		this.onUploadedBytes = onUploadedBytes;
	}

	async appendChunk(chunk: Uint8Array<ArrayBuffer>, offset: number, partNum: number, isFinal: boolean): Promise<boolean> {
		const tmpName = `__chunk_${Date.now()}_${partNum}`;
		try {
			const root = await navigator.storage.getDirectory();
			const handle = await root.getFileHandle(tmpName, { create: true });
			const writable = await handle.createWritable();
			await writable.write(chunk);
			await writable.close();

			this.queueUpload({ handle, tmpName, offset, partNum, length: chunk.length, isFinal });
			return true;
		} catch (err) {
			console.error('OPFS チャンク保存失敗', err);
			return false;
		}
	}

	private queueUpload(info: {
		handle: FileSystemFileHandle;
		tmpName: string;
		offset: number;
		partNum: number;
		length: number;
		isFinal: boolean;
	}) {
		const { handle, tmpName, offset, partNum, length, isFinal } = info;
		const promise = this.queueChain.then((prevOk) => {
			if (!prevOk || this.hasError) return false;
			return this.sendChunk(handle, tmpName, offset, partNum, isFinal);
		}).then((ok) => {
			if (!ok) {
				this.hasError = true;
				return false;
			}
			this.onUploadedBytes?.(offset + length);
			return true;
		}).catch(() => {
			this.hasError = true;
			return false;
		});

		this.queueChain = promise.catch(() => false);
		this.pendingUploads.push(promise);
	}

	private async sendChunk(
		handle: FileSystemFileHandle,
		tmpName: string,
		offset: number,
		_partNum: number,
		isFinal: boolean,
	): Promise<boolean> {
		for (let attempt = 0; attempt < 3; attempt++) {
			const file = await handle.getFile();
			const extraHeaders: Record<string, string> = {
				'Content-Length': String(file.size),
			};
			if (isFinal) extraHeaders['Upload-Final'] = '1';

			try {
				const res = await fetch(`/upload/${this.fileId}/resume`, {
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/offset+octet-stream',
						'Upload-Offset': String(offset),
						'Tus-Resumable': '1.0.0',
						...authHeaders(),
						...extraHeaders,
					},
					body: file,
				});

				if (res.ok) {
					const root = await navigator.storage.getDirectory();
					await root.removeEntry(tmpName).catch(() => {});
					return true;
				}

				// 4xx は恒久的エラー
				if (res.status >= 400 && res.status < 500) {
					const root = await navigator.storage.getDirectory();
					await root.removeEntry(tmpName).catch(() => {});
					const err = (await res.json().catch(() => ({}))) as { error?: string };
					uploadError.value = `アップロード失敗 (${this.path}): ${err.error ?? res.status}`;
					return false;
				}
				// 5xx はリトライ
			} catch {
				// ネットワークエラー — コミット済みパーツ数で受信確認
				if (attempt < 2) {
					await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
					const partCount = await getUploadPartCount(this.fileId);
					if (partCount > _partNum) {
						const root = await navigator.storage.getDirectory();
						await root.removeEntry(tmpName).catch(() => {});
						return true;
					}
				}
			}

			if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
		}

		const root = await navigator.storage.getDirectory();
		await root.removeEntry(tmpName).catch(() => {});
		uploadError.value = `アップロード失敗 (${this.path}): ネットワークエラー（リトライ上限）`;
		return false;
	}

	async waitAll(): Promise<boolean> {
		const results = await Promise.all(this.pendingUploads);
		return !this.hasError && results.every((ok) => ok);
	}
}

/** Open upload then stream in partSize pieces via OPFS. Returns fileId or null on error. */
async function uploadChunkedStream(
	stream: ReadableStream<Uint8Array>,
	path: string,
	onUploadedBytes?: (total: number) => void,
): Promise<string | null> {
	const result = await openUpload(path);
	if (!result) return null;
	const { fileId, partSize } = result;

	const reader = stream.getReader();
	const queue = new TusChunkQueue(fileId, path, partSize, onUploadedBytes);
	let buf = new Uint8Array(0);
	let offset = 0;
	let partNum = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (value) {
				const next = new Uint8Array(buf.length + value.length);
				next.set(buf);
				next.set(value, buf.length);
				buf = next;
			}

			if (buf.length >= partSize) {
				const chunk = buf.slice(0, partSize);
				buf = buf.slice(partSize);
				if (!(await queue.appendChunk(chunk, offset, partNum++, false))) {
					await deleteExistingFile(path);
					return null;
				}
				offset += chunk.length;
			}

			if (done) {
				// 残りのバッファを全て送信（partSize超過でも分割して対応）
				while (buf.length > 0) {
					const isFinal = buf.length <= partSize;
					const chunk = isFinal ? buf : buf.slice(0, partSize);
					buf = buf.slice(chunk.length);
					if (!(await queue.appendChunk(chunk, offset, partNum++, isFinal))) {
						await deleteExistingFile(path);
						return null;
					}
					offset += chunk.length;
				}
				break;
			}
		}
	} finally {
		reader.releaseLock();
	}

	if (!(await queue.waitAll())) {
		await deleteExistingFile(path);
		return null;
	}

	return fileId;
}

/** Upload tar stream in chunks, then register index. */
async function uploadTarStream(
	stream: ReadableStream<Uint8Array>,
	index: Promise<TarIndex[]>,
	archivePath: string,
	onUploadedBytes?: (total: number) => void,
): Promise<boolean> {
	const fileId = await uploadChunkedStream(stream, archivePath, onUploadedBytes);
	if (!fileId) return false;

	const resolvedIndex = await index;

	const indexResult = await apiPost('/api/files/create/tar-index', { fileId, files: resolvedIndex });
	if (!indexResult.ok) {
		uploadError.value = indexResult.data.error;
		await deleteExistingFile(archivePath);
		return false;
	}

	if (!(await closeUpload(fileId))) {
		await deleteExistingFile(archivePath);
		return false;
	}
	return true;
}

/** Upload BGZF stream in chunks, then register index. */
async function uploadBgzfStream(
	stream: ReadableStream<Uint8Array>,
	index: Promise<TarGzIndex[]>,
	archivePath: string,
	onUploadedBytes?: (total: number) => void,
): Promise<boolean> {
	const fileId = await uploadChunkedStream(stream, archivePath, onUploadedBytes);
	if (!fileId) return false;

	const resolvedIndex = await index;

	const bgzfIndexResult = await apiPost('/api/files/create/targz-index', { fileId, files: resolvedIndex });
	if (!bgzfIndexResult.ok) {
		uploadError.value = bgzfIndexResult.data.error;
		await deleteExistingFile(archivePath);
		return false;
	}

	if (!(await closeUpload(fileId))) {
		await deleteExistingFile(archivePath);
		return false;
	}
	return true;
}

// ---- startUpload ----

async function startUpload(): Promise<void> {
	if (isQuotaWarningNeeded.value && !quotaWarningConfirmed.value) {
		quotaWarningOpen.value = true;
		return;
	}
	quotaWarningConfirmed.value = false;
	await executeUpload();
}

async function confirmQuotaWarning(): Promise<void> {
	quotaWarningOpen.value = false;
	quotaWarningConfirmed.value = true;
	await startUpload();
}

async function executeUpload(): Promise<void> {
	uploadError.value = '';
	uploadDone.value = false;
	uploadProgress.value = null;
	if (!bucket.value) return;

	// Pre-upload existence check
	const paths = getUploadPaths();
	if (!validateUploadPaths(paths)) return;
	if (paths.length > 0) {
		const conflicts: string[] = [];
		for (const path of paths) {
			const lastSlash = path.lastIndexOf('/');
			const parentPath = lastSlash === -1 ? '' : path.slice(0, lastSlash + 1);
			const fileName = path.slice(lastSlash + 1);
			const result = await apiPost('/api/files/ls', {
				bucketName: selectedBucketName.value,
				path: parentPath,
			});
			if (result.ok) {
				if (result.data.entries.some(e => e.type === 'file' && e.name === fileName)) {
					conflicts.push(path);
				}
			}
		}
		if (conflicts.length > 0) {
			const msg = `以下のパスにすでにファイルが存在します:\n${conflicts.join('\n')}\n\n上書きしますか？`;
			if (!confirm(msg)) return;
			for (const path of conflicts) {
				if (!(await deleteExistingFile(path))) {
					uploadError.value = `既存ファイルの削除に失敗しました: ${path}`;
					return;
				}
			}
		}
	}

	if (selectedTree.value && selectedTree.value.entries.length > 0) {
		const fileArr = selectedTree.value.entries;
		const totalFiles = fileArr.length;
		const isGz = archiveMode.value === 'gz';
		const totalBytes = isGz ? 0 : fileArr.reduce((s, entry) => s + entry.size, 0);
		let cumulativeBytes = 0;

		if (archiveMode.value === 'individual' || archiveMode.value === 'gz') {
			for (let i = 0; i < fileArr.length; i++) {
				const entry = fileArr[i];
				const file = entry.file;
				uploadProgress.value = { filename: entry.path, fileIndex: i + 1, totalFiles, uploadedBytes: cumulativeBytes, totalBytes };
				if (isGz) {
					const stream = file.stream().pipeThrough(new CompressionStream('gzip'));
					if (!(await uploadStream(stream, `${uploadPrefix.value}${entry.path}.gz`, (n) => {
						if (uploadProgress.value) uploadProgress.value = { ...uploadProgress.value, uploadedBytes: cumulativeBytes + n };
					}))) return;
					cumulativeBytes += file.size;
				} else {
					if (!(await uploadBlob(file, `${uploadPrefix.value}${entry.path}`, (n) => {
						if (uploadProgress.value) uploadProgress.value = { ...uploadProgress.value, uploadedBytes: cumulativeBytes + n };
					}))) return;
					cumulativeBytes += file.size;
				}
			}
		} else if (archiveMode.value === 'tar') {
			uploadProgress.value = { filename: '', fileIndex: 0, totalFiles: 0, uploadedBytes: 0, totalBytes: selectedTree.value.totalSize };
			const archiver = await TarArchiver.createFromEntries(selectedTree.value.toFileEntries(), (p: ArchiveProgress) => {
				if (!uploadProgress.value) return;
				uploadProgress.value = { ...uploadProgress.value, filename: p.currentFile, fileIndex: p.processedFiles + 1, totalFiles: p.totalFiles };
			});
			if (!(await uploadTarStream(archiver.stream, archiver.index, `${uploadPrefix.value}${archiveUploadBaseName.value}.tar`, (n) => {
				if (uploadProgress.value) uploadProgress.value = { ...uploadProgress.value, uploadedBytes: n };
			}))) return;
		} else {
			uploadProgress.value = { filename: '', fileIndex: 0, totalFiles: 0, uploadedBytes: 0, totalBytes: selectedTree.value.totalSize };
			const archiver = await BgzfTarArchiver.createFromEntries(selectedTree.value.toFileEntries(), (p: ArchiveProgress) => {
				if (!uploadProgress.value) return;
				uploadProgress.value = { ...uploadProgress.value, filename: p.currentFile, fileIndex: p.processedFiles + 1, totalFiles: p.totalFiles };
			});
			if (!(await uploadBgzfStream(archiver.stream, archiver.index, `${uploadPrefix.value}${archiveUploadBaseName.value}.tar.gz`, (n) => {
				if (uploadProgress.value) uploadProgress.value = { ...uploadProgress.value, uploadedBytes: n };
			}))) return;
		}
		uploadDone.value = true;
	}
}

onMounted(async () => {
	await loadBucket();
	const pending = takePendingUpload();
	if (pending) {
		if (pending.bucketName) selectedBucketName.value = pending.bucketName;
		if (pending.files.length > 0) await setSelectedTree(await UploadTree.from(pending.files));
		uploadPrefix.value = pending.prefix;
	}
});
</script>

<template>
  <div>
    <div class="section-header">
      <h2 class="section-title">アップロード</h2>
    </div>

    <div v-if="!authStore.user" class="alert alert-info">ログインが必要です。</div>
    <div v-else-if="loadError" class="alert alert-error">{{ loadError }}</div>
    <template v-else>
      <!-- アップロード先選択 -->
      <div :class="['card']">
        <p :class="$style.cardTitle">アップロード先</p>
        <div :class="$style.destinationRow">
          <template v-if="selectedBucketName">
            <span :class="[$style.destinationDisplay, 'font-mono']">{{ selectedBucketName }}/{{ uploadPrefix }}</span>
            <Button.Root class="btn btn-secondary" @click="destinationDialogOpen = true">
              <Button.Content>変更</Button.Content>
            </Button.Root>
          </template>
          <template v-else>
            <Button.Root class="btn btn-primary" @click="destinationDialogOpen = true">
              <Button.Content>アップロード先を選択</Button.Content>
            </Button.Root>
          </template>
        </div>
        <UploadDestinationDialog
          v-model:open="destinationDialogOpen"
          :initial-bucket-name="selectedBucketName"
          :initial-prefix="uploadPrefix"
          @select="({ bucketName, prefix }) => { selectedBucketName = bucketName; uploadPrefix = prefix; }"
        />
      </div>

      <!-- ファイル選択 -->
      <div
        :class="['card', $style.dropSection, { [$style.dropSectionActive]: isDragOver }]"
        @dragenter.prevent="isDragOver = true"
        @dragover.prevent="isDragOver = true"
        @dragleave.prevent="isDragOver = false"
        @drop.prevent="handleDrop"
      >
        <p :class="[$style.cardTitle, $style.fileSelectCardTitle]">
          ファイル選択
          <span v-if="selectedTree" class="badge badge-info">
            {{ selectedTree.entries.length }} ファイル / {{ formatBytes(selectedTree.totalSize) }}
          </span>
        </p>
        <p :class="[$style.dropHint]">ここにファイルやフォルダをドラッグ＆ドロップで追加</p>

        <div class="flex items-center gap-2 flex-wrap mt-2">
          <label :class="[$style.fileLabel, 'btn', 'btn-primary']">
            ファイルを選択
            <input
              type="file"
              multiple
              :class="$style.hiddenInput"
              @change="handleFileInputChange"
            >
          </label>

          <label :class="[$style.fileLabel, 'btn', 'btn-primary']">
            フォルダを選択
            <input
              type="file"
              webkitdirectory
              multiple
              :class="$style.hiddenInput"
              @change="handleFileInputChange"
            >
          </label>

          <Button.Root
            v-if="selectedTree"
            class="btn btn-secondary"
            @click="clearSelectedTree"
          >
            <Button.Content>初期化</Button.Content>
          </Button.Root>

        </div>
        <div v-if="selectionError" class="alert alert-error mt-3">{{ selectionError }}</div>

        <div v-if="hasSelection" class="mt-3">
          <div :class="$style.fileBrowser">
            <div :class="$style.previewPane">
              <template v-if="!selectedEntry">
                <p :class="$style.previewEmpty">ファイルを選択</p>
              </template>
              <template v-else-if="previewKind === 'image'">
                <img :src="previewUrl" :alt="selectedEntry.name" :class="$style.previewImage">
              </template>
              <template v-else-if="previewKind === 'video'">
                <video :src="previewUrl" :class="$style.previewVideo" controls preload="metadata" />
              </template>
              <template v-else-if="previewKind === 'audio'">
                <div :class="$style.previewAudioWrap">
                  <span :class="$style.previewName">{{ selectedEntry.name }}</span>
                  <audio :src="previewUrl" :class="$style.previewAudio" controls preload="metadata" />
                </div>
              </template>
              <template v-else-if="previewKind === 'pdf'">
                <object :data="previewUrl" type="application/pdf" :class="$style.previewObject">
                  <p :class="$style.previewEmpty">{{ selectedEntry.name }}</p>
                </object>
              </template>
              <template v-else-if="previewKind === 'text'">
                <pre :class="$style.previewText">{{ previewLoading ? '読み込み中...' : previewText }}</pre>
              </template>
              <template v-else>
                <div :class="$style.previewMeta">
                  <span :class="$style.previewName">{{ selectedEntry.name }}</span><br>
                  <span>{{ selectedEntry.path }}</span><br>
                  <span>{{ selectedEntry.type || 'application/octet-stream' }}</span><br>
                  <span>{{ formatBytes(selectedEntry.size) }}</span>
                </div>
              </template>
            </div>
            <div :class="$style.fileListPane" @keydown="onFileListKeydown">
              <div
                v-for="item in flatDisplayEntries"
                :key="item.key"
                :class="[
                  $style.fileRow,
                  item.type === 'dir' ? $style.dirRow : $style.fileItemRow,
                  item.type === 'file' && selectedEntry?.path === item.entry.path ? $style.fileRowSelected : '',
                ]"
                :style="{ paddingLeft: `${12 + item.depth * 18}px` }"
              >
                <button
                  v-if="item.type === 'file'"
                  :ref="element => setFileRowElement(item.entry.path, element)"
                  type="button"
                  :class="$style.fileSelectButton"
                  @click="selectEntry(item.entry)"
                >
                  <span :class="$style.fileIcon">[F]</span>
                  <span :class="$style.fileName">{{ item.entry.name }}</span>
                  <span :class="$style.fileSize">{{ formatBytes(item.entry.size) }}</span>
                </button>
                <template v-else>
                  <span :class="$style.fileIcon">[D]</span>
                  <span :class="$style.fileName">{{ item.name }}</span>
                </template>
                <Popover.Root v-if="item.type === 'file'">
                  <Popover.Activator
                    :class="['btn', 'btn-ghost', 'btn-icon', $style.fileMenuButton]"
                    aria-label="ファイル操作メニュー"
                    @click.stop
                  >
                    …
                  </Popover.Activator>
                  <Popover.Content class="action-menu">
                    <div class="action-menu-inner">
                      <Button.Root class="btn btn-ghost-danger w-full" @click="removeSelectedEntry(item.entry.path)">
                        <Button.Content>削除</Button.Content>
                      </Button.Root>
                    </div>
                  </Popover.Content>
                </Popover.Root>
              </div>
            </div>
          </div>

          <p class="form-label" :class="$style.archiveModeLabel">アップロード形式</p>
          <div :class="$style.archiveModeList">
            <label :class="['checkbox-label', $style.archiveModeOption]">
              <input v-model="archiveMode" type="radio" value="individual" :class="$style.radioInput">
              <span :class="$style.archiveModeText">個別ファイルとしてアップロード</span>
            </label>
            <label :class="['checkbox-label', $style.archiveModeOption]">
              <input v-model="archiveMode" type="radio" value="gz" :class="$style.radioInput">
              <span :class="$style.archiveModeText">gzip 圧縮してアップロード</span>
              <span class="badge badge-muted">.gz</span>
            </label>
            <label :class="['checkbox-label', $style.archiveModeOption]">
              <input v-model="archiveMode" type="radio" value="tar" :class="$style.radioInput">
              <span :class="$style.archiveModeText">tar にまとめてアップロード</span>
              <span class="badge badge-muted">無圧縮</span>
            </label>
            <label :class="['checkbox-label', $style.archiveModeOption]">
              <input v-model="archiveMode" type="radio" value="targz" :class="$style.radioInput">
              <span :class="$style.archiveModeText">tar.gz にまとめてアップロード</span>
              <span class="badge badge-info">BGZF・ランダムアクセス対応</span>
            </label>
          </div>
          <div v-if="archiveMode === 'tar' || archiveMode === 'targz'" :class="[$style.libraryNameGroup, 'form-group']">
            <label class="form-label" for="upload-library-name">ライブラリ名</label>
            <input
              id="upload-library-name"
              v-model="libraryName"
              class="form-input form-input-mono"
              type="text"
              :placeholder="archiveBaseName"
            >
            <div class="form-hint">
              {{ archiveUploadBaseName }}{{ archiveMode === 'tar' ? '.tar' : '.tar.gz' }}
            </div>
          </div>
        </div>
      </div>

      <!-- オプション -->
      <div class="card">
        <p :class="$style.cardTitle">オプション</p>
        <div :class="$style.optionsList">
          <label class="radio-label">
            <input v-model="visibility" type="radio" value="public" :class="$style.radioInput">
            公開
          </label>
          <label class="radio-label">
            <input v-model="visibility" type="radio" value="private" :class="$style.radioInput">
            非公開
          </label>
          <label class="radio-label">
            <input v-model="visibility" type="radio" value="passphrase" :class="$style.radioInput">
            合言葉で保護
          </label>
          <div v-if="visibility === 'public'" class="form-hint">
            一度公開したファイルは非公開に戻せません。
          </div>
          <div v-if="visibility === 'passphrase'" :class="[$style.passphraseGroup, 'form-group']">
            <label class="form-label" for="upload-passphrase">合言葉</label>
            <input
              id="upload-passphrase"
              v-model="passphrase"
              class="form-input"
              type="text"
              placeholder="アクセス用の合言葉"
            >
          </div>
        </div>
      </div>

      <!-- 開始ボタン -->
      <div class="mt-4">
        <Button.Root
          class="btn btn-primary btn-lg w-full"
          :class="$style.fullButton"
          :disabled="!selectedTree || selectedTree.entries.length === 0 || !!uploadProgress && !uploadDone && !uploadError"
          @click="startUpload"
        >
          <Button.Content>アップロード開始</Button.Content>
        </Button.Root>
      </div>

      <!-- 進捗 -->
      <div v-if="uploadProgress" :class="[$style.uploadProgressBox, 'mt-4']">
        <p :class="$style.uploadProgressFilename">
          <template v-if="uploadProgress.totalFiles > 0">
            <span class="badge badge-info" :class="$style.progressBadge">{{ uploadProgress.fileIndex }}/{{ uploadProgress.totalFiles }}</span>
          </template>
          {{ uploadProgress.filename || 'アーカイブ作成中...' }}
        </p>
        <Progress.Root
          class="progress-root"
          :model-value="uploadProgress.totalBytes > 0 ? Math.round(uploadProgress.uploadedBytes / uploadProgress.totalBytes * 100) : 0"
          :max="100"
        >
          <Progress.Track class="progress-track">
            <Progress.Fill class="progress-fill" />
          </Progress.Track>
        </Progress.Root>
        <p :class="$style.uploadProgressMeta">
          {{ formatBytes(uploadProgress.uploadedBytes) }}
          <template v-if="uploadProgress.totalBytes > 0">
            / {{ formatBytes(uploadProgress.totalBytes) }}
            ({{ Math.round(uploadProgress.uploadedBytes / uploadProgress.totalBytes * 100) }}%)
          </template>
          <template v-else>転送済み</template>
        </p>
      </div>

      <div v-if="uploadError" class="alert alert-error mt-3">{{ uploadError }}</div>
      <div v-if="uploadDone" class="alert alert-success mt-3">
        アップロード完了！
        <NirA :to="`/v/${selectedBucketName}/`" :class="$style.doneLink">ファイル一覧を見る →</NirA>
      </div>

      <ConfirmDialog
        v-model:open="quotaWarningOpen"
        title="クォータを超える可能性があります"
        :message="quotaWarningMessage"
        confirm-label="続行"
        cancel-label="キャンセル"
        danger
        @confirm="confirmQuotaWarning"
        @cancel="quotaWarningOpen = false"
      />
    </template>
  </div>
</template>

<style module lang="scss">
.destinationRow {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.destinationDisplay {
  font-size: 0.9rem;
  background: var(--color-surface);
  border-radius: var(--radius);
  padding: 6px 10px;
  word-break: break-all;
}

.cardTitle {
  font-size: 0.8125rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  margin-bottom: 14px;
}

.uploadProgressBox {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 14px 16px;
}

.uploadProgressFilename {
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.uploadProgressMeta {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  margin-top: 6px;
}

.fileLabel {
  cursor: pointer;
}

.hiddenInput {
  display: none;
}

.dropSection {
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.dropSectionActive {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 18%, transparent);
}

.filePickerBar {
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 14px;
  background: var(--color-bg);
}

.fileSelectCardTitle {
  margin-bottom: 4px;
}

.dropHint {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}

.fileBrowser {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(260px, 1.2fr);
  gap: 12px;
  margin-bottom: 16px;
}

.previewPane,
.fileListPane {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-bg);
  min-height: 260px;
  overflow: auto;
}

.previewPane {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  height: 360px;
}

.fileListPane {
  min-height: 100px;
  max-height: 360px
}

.previewImage {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.previewVideo {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.previewAudioWrap {
  width: min(100%, 420px);
  padding: 16px;
  text-align: center;
}

.previewAudio {
  width: 100%;
  margin-top: 12px;
}

.previewObject {
  width: 100%;
  height: 380px;
  border: 0;
}

.previewText {
  width: 100%;
  height: 100%;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8125rem;
  line-height: 1.45;
}

.previewEmpty,
.previewMeta {
  color: var(--color-text-muted);
  font-size: 0.875rem;
  padding: 16px;
  text-align: center;
}

.previewMeta {
  width: 100%;
  word-break: break-all;
}

.previewName {
  color: var(--color-text);
  font-weight: 600;
}

.fileListPane {
  padding: 0;
}

.fileRow {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
  font: inherit;
  padding: 7px 12px;
}

.fileItemRow {
  padding-top: 2px;
  padding-bottom: 2px;
}

.fileItemRow:hover {
  background: var(--color-surface);
}

.fileRowSelected {
  background: var(--color-primary-surface, color-mix(in srgb, var(--color-primary) 12%, transparent));
  border-left: 3px solid var(--color-primary);
  padding-left: 9px;
}

.fileRowSelected .fileSelectButton {
  color: var(--color-primary);
  font-weight: 600;
}

.dirRow {
  grid-template-columns: auto minmax(0, 1fr);
  color: var(--color-text-muted);
  font-weight: 600;
}

.fileSelectButton {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 5px 0;
  cursor: pointer;
}

.fileMenuButton {
  align-self: center;
}

.fileIcon {
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.fileName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fileSize {
  color: var(--color-text-muted);
  font-size: 0.75rem;
}

.archiveModeLabel {
  margin-bottom: 8px;
}

.archiveModeList {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.archiveModeOption {
  display: grid;
  grid-template-columns: 16px minmax(0, max-content) auto;
  justify-content: start;
  align-items: center;
  column-gap: 8px;
  row-gap: 4px;
  width: fit-content;
  max-width: 100%;
}

.archiveModeText {
  min-width: 0;
}

.libraryNameGroup {
  margin-top: 14px;
  max-width: 360px;
}

.radioInput {
  accent-color: var(--color-primary);
}

.optionsList {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.passphraseGroup {
  max-width: 320px;
}

.progressBadge {
  margin-right: 6px;
}

.doneLink {
  margin-left: 8px;
  font-weight: 600;
}

.fullButton {
  justify-content: center;
}

@media (max-width: 720px) {
  .fileBrowser {
    grid-template-columns: 1fr;
  }

  .archiveModeOption {
    grid-template-columns: 16px minmax(0, 1fr);
    width: 100%;
  }

  .archiveModeOption :global(.badge) {
    grid-column: 2;
    justify-self: start;
  }
}
</style>

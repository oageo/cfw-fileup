<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Download, Image as ImageIcon, LoaderCircle, Sparkles, Video } from '@lucide/vue';
import { readAndCompressImage } from '@misskey-dev/browser-image-resizer';
import { formatBytes } from '@/utils/byte-size';

type CompressionStatus = 'queued' | 'processing' | 'done' | 'skipped' | 'error';

type CompressionItem = {
	id: string;
	file: File;
	outputName: string;
	status: CompressionStatus;
	error: string;
	outputBlob: Blob | null;
	outputUrl: string;
};

const quality = ref(0.7);
const maxWidth = ref(1920);
const maxHeight = ref(1920);
const outputMimeType = ref<'image/webp' | 'image/jpeg'>('image/webp');
const canEncodeWebp = ref(true);
const items = ref<CompressionItem[]>([]);
const isCompressing = ref(false);
const selectionError = ref('');
const isDragOver = ref(false);

const supported = computed(() => (
	typeof OffscreenCanvas !== 'undefined'
	&& typeof createImageBitmap !== 'undefined'
));
const readyItems = computed(() => items.value.filter(item => item.status !== 'skipped'));
const doneItems = computed(() => items.value.filter(item => item.status === 'done' && item.outputUrl));
const canCompress = computed(() => supported.value && readyItems.value.length > 0 && !isCompressing.value);

const comingSoonItems = [
	{ title: 'EXIF持ち越し + GPS削除', description: '位置情報だけを落として、必要なメタデータを残す処理を追加予定です。', icon: ImageIcon },
	{ title: 'AVIF対応', description: 'VideoEncoderを使ったAVIF出力を追加予定です。', icon: Sparkles },
	{ title: 'HLS生成', description: 'Mediabunnyで動画をHLSへ変換する機能を追加予定です。', icon: Video },
	{ title: 'シーンチェンジ検出', description: 'Mediabunnyで動画の切り替わり位置を検出する機能を追加予定です。', icon: Video },
	{ title: '動画圧縮', description: 'ブラウザ内での動画再エンコードを追加予定です。', icon: Video },
];

async function detectWebpEncodingSupport(): Promise<boolean> {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(1, 1);
		const blob = await canvas.convertToBlob({ type: 'image/webp' }).catch(() => null);
		if (blob?.type === 'image/webp') return true;
	}
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp'));
	return blob?.type === 'image/webp';
}

function outputName(file: File): string {
	const base = file.name.replace(/\.[^/.]+$/, '') || 'image';
	return `${base}${outputMimeType.value === 'image/webp' ? '.webp' : '.jpg'}`;
}

function createItem(file: File): CompressionItem {
	const image = file.type.startsWith('image/');
	return {
		id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
		file,
		outputName: outputName(file),
		status: image ? 'queued' : 'skipped',
		error: image ? '' : '画像ファイルではありません。',
		outputBlob: null,
		outputUrl: '',
	};
}

function revokeItem(item: CompressionItem): void {
	if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
	item.outputUrl = '';
}

function clearItems(): void {
	for (const item of items.value) revokeItem(item);
	items.value = [];
	selectionError.value = '';
}

function addFiles(fileList: FileList | File[]): void {
	selectionError.value = '';
	const files = Array.from(fileList);
	if (files.length === 0) return;
	items.value.push(...files.map(createItem));
}

function handleFileInputChange(event: Event): void {
	const input = event.target as HTMLInputElement;
	if (input.files) addFiles(input.files);
	input.value = '';
}

function handleDrop(event: DragEvent): void {
	isDragOver.value = false;
	if (!event.dataTransfer?.files) return;
	addFiles(event.dataTransfer.files);
}

async function compressAll(): Promise<void> {
	if (!supported.value) {
		selectionError.value = 'このブラウザでは画像圧縮を利用できません。';
		return;
	}
	isCompressing.value = true;
	selectionError.value = '';
	try {
		for (const item of readyItems.value) {
			item.status = 'processing';
			item.error = '';
			revokeItem(item);
			item.outputBlob = null;
			try {
				const blob = await readAndCompressImage(item.file, {
					quality: quality.value,
					maxWidth: maxWidth.value,
					maxHeight: maxHeight.value,
					mimeType: outputMimeType.value,
					argorithm: null,
					processByHalf: true,
				});
				item.outputBlob = blob;
				item.outputName = outputName(item.file);
				item.outputUrl = URL.createObjectURL(blob);
				item.status = 'done';
			} catch (err) {
				item.status = 'error';
				item.error = err instanceof Error ? err.message : String(err);
			}
		}
	} finally {
		isCompressing.value = false;
	}
}

function reductionPercent(item: CompressionItem): string {
	if (!item.outputBlob || item.file.size <= 0) return '-';
	const value = Math.round((1 - item.outputBlob.size / item.file.size) * 100);
	return `${value}%`;
}

function statusLabel(status: CompressionStatus): string {
	if (status === 'queued') return '待機中';
	if (status === 'processing') return '圧縮中';
	if (status === 'done') return '完了';
	if (status === 'skipped') return '対象外';
	return 'エラー';
}

void detectWebpEncodingSupport().then((supported) => {
	canEncodeWebp.value = supported;
	if (!supported && outputMimeType.value === 'image/webp') {
		outputMimeType.value = 'image/jpeg';
	}
});

onBeforeUnmount(clearItems);
</script>

<template>
  <main :class="$style.page">
    <section :class="$style.header">
      <div>
        <p :class="$style.kicker">Tools</p>
        <h1>メディア圧縮ツール</h1>
        <p :class="$style.lead">画像をブラウザ内でJPEGへ圧縮して、ローカルに保存できます。</p>
      </div>
    </section>

    <section class="card" :class="$style.toolCard">
      <div :class="$style.cardHeader">
        <div>
          <h2>画像圧縮</h2>
          <p>EXIFなどのメタデータは出力に引き継がれません。</p>
        </div>
        <span class="badge badge-success">利用可能</span>
      </div>

      <div v-if="!supported" class="alert alert-warning mb-4">
        このブラウザでは画像圧縮を利用できません。
      </div>
      <div v-if="selectionError" class="alert alert-error mb-4">{{ selectionError }}</div>

      <label
        :class="[$style.dropZone, isDragOver ? $style.dropZoneActive : null]"
        @dragover.prevent="isDragOver = true"
        @dragleave.prevent="isDragOver = false"
        @drop.prevent="handleDrop"
      >
        <ImageIcon :size="32" :stroke-width="2" />
        <span>画像を選択</span>
        <input type="file" accept="image/*" multiple :class="$style.fileInput" @change="handleFileInputChange">
      </label>

      <div :class="$style.controls">
        <label class="form-group">
          <span class="form-label">出力形式</span>
          <select v-model="outputMimeType" class="form-input">
            <option value="image/webp" :disabled="!canEncodeWebp">WebP</option>
            <option value="image/jpeg">JPEG</option>
          </select>
        </label>
        <label class="form-group">
          <span class="form-label">品質</span>
          <input v-model.number="quality" class="form-input" type="number" min="0.1" max="1" step="0.05">
        </label>
        <label class="form-group">
          <span class="form-label">最大幅</span>
          <input v-model.number="maxWidth" class="form-input" type="number" min="1" step="1">
        </label>
        <label class="form-group">
          <span class="form-label">最大高さ</span>
          <input v-model.number="maxHeight" class="form-input" type="number" min="1" step="1">
        </label>
      </div>
      <div v-if="!canEncodeWebp" class="alert alert-warning">
        このブラウザではWebP出力を利用できないため、JPEGで保存します。
      </div>

      <div :class="$style.actions">
        <button type="button" class="btn btn-primary" :disabled="!canCompress" @click="compressAll">
          <LoaderCircle v-if="isCompressing" :size="16" :stroke-width="2" :class="$style.spin" />
          <ImageIcon v-else :size="16" :stroke-width="2" />
          圧縮
        </button>
        <button type="button" class="btn btn-secondary" :disabled="items.length === 0 || isCompressing" @click="clearItems">
          クリア
        </button>
      </div>

      <div v-if="items.length > 0" :class="$style.resultTableWrap">
        <table :class="$style.resultTable">
          <thead>
            <tr>
              <th>ファイル</th>
              <th>状態</th>
              <th>元サイズ</th>
              <th>出力サイズ</th>
              <th>削減率</th>
              <th>保存</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td>
                <div :class="$style.fileName">{{ item.file.name }}</div>
                <div v-if="item.error" :class="$style.errorText">{{ item.error }}</div>
              </td>
              <td><span :class="['badge', item.status === 'done' ? 'badge-success' : item.status === 'error' ? 'badge-danger' : 'badge-muted']">{{ statusLabel(item.status) }}</span></td>
              <td>{{ formatBytes(item.file.size) }}</td>
              <td>{{ item.outputBlob ? formatBytes(item.outputBlob.size) : '-' }}</td>
              <td>{{ reductionPercent(item) }}</td>
              <td>
                <a
                  v-if="item.outputUrl"
                  class="btn btn-secondary btn-icon"
                  :href="item.outputUrl"
                  :download="item.outputName"
                  :aria-label="`${item.outputName}を保存`"
                >
                  <Download :size="16" :stroke-width="2" />
                </a>
                <span v-else>-</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section :class="$style.comingSoon">
      <article v-for="item in comingSoonItems" :key="item.title" class="card" :class="$style.soonCard">
        <component :is="item.icon" :size="20" :stroke-width="2" :class="$style.soonIcon" />
        <div>
          <h2>{{ item.title }}</h2>
          <p>{{ item.description }}</p>
        </div>
        <span class="badge badge-muted">Coming soon</span>
      </article>
    </section>
  </main>
</template>

<style module lang="scss">
.page {
  display: grid;
  gap: 24px;
}

.header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.kicker {
  margin: 0 0 4px;
  color: var(--color-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.lead {
  max-width: 640px;
  color: var(--color-text-muted);
}

.toolCard {
  display: grid;
  gap: 18px;
}

.cardHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.cardHeader p {
  margin: 0;
  color: var(--color-text-muted);
}

.dropZone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 160px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  background: var(--color-bg);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.dropZone:hover,
.dropZoneActive {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
}

.fileInput {
  display: none;
}

.controls {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 12px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.spin {
  animation: spin 0.9s linear infinite;
}

.resultTableWrap {
  overflow-x: auto;
}

.resultTable {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
}

.resultTable th,
.resultTable td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  vertical-align: middle;
}

.resultTable th {
  color: var(--color-text-muted);
  font-size: 0.78rem;
  font-weight: 600;
}

.fileName {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.errorText {
  color: var(--color-danger);
  font-size: 0.78rem;
}

.comingSoon {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 14px;
}

.soonCard {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.soonCard h2 {
  font-size: 1rem;
  overflow-wrap: anywhere;
}

.soonCard p {
  margin: 0;
  color: var(--color-text-muted);
}

.soonIcon {
  color: var(--color-primary);
}

.soonCard > :global(.badge) {
  justify-self: end;
  white-space: nowrap;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .controls {
    grid-template-columns: 1fr;
  }

  .cardHeader {
    flex-direction: column;
  }

  .soonCard {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .comingSoon {
    grid-template-columns: 1fr;
  }

  .soonCard > :global(.badge) {
    grid-column: 2;
    justify-self: start;
  }
}
</style>

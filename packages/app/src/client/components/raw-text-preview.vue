<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { authHeaders } from '@/store/auth';

const props = defineProps<{
	url: string;
	filename: string;
}>();

const loading = ref(false);
const error = ref('');
const source = ref('');
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

watch(
	() => props.url,
	async (url) => {
		source.value = '';
		error.value = '';
		if (!url) return;
		loading.value = true;
		try {
			const res = await fetch(url, { headers: authHeaders() });
			if (!res.ok) {
				error.value = `テキストを読み込めませんでした (${res.status})`;
				return;
			}
			source.value = await res.text();
		} catch (err) {
			error.value = err instanceof Error ? err.message : String(err);
		} finally {
			loading.value = false;
		}
	},
	{ immediate: true },
);

async function copyRaw(): Promise<void> {
	if (!source.value) return;
	await navigator.clipboard.writeText(source.value);
	copied.value = true;
	if (copiedTimer !== null) clearTimeout(copiedTimer);
	copiedTimer = setTimeout(() => {
		copied.value = false;
		copiedTimer = null;
	}, 1600);
}

onBeforeUnmount(() => {
	if (copiedTimer !== null) clearTimeout(copiedTimer);
});
</script>

<template>
  <section class="raw-text-preview-wrap" :aria-label="`${filename} のRawプレビュー`">
    <div v-if="!loading && !error" class="raw-text-preview-toolbar">
      <button
        type="button"
        class="btn btn-secondary raw-text-preview-copy"
        :disabled="source.length === 0"
        @click="copyRaw"
      >{{ copied ? 'コピー済み' : '全部コピー' }}</button>
    </div>
    <div v-if="loading" class="page-loading">
      <span class="spinner"></span>読み込み中...
    </div>
    <div v-else-if="error" class="alert alert-error">{{ error }}</div>
    <div v-else class="raw-text-preview">
      <pre class="raw-text-preview-source">{{ source }}</pre>
    </div>
  </section>
</template>

<style>
.raw-text-preview-wrap {
  max-width: 880px;
}

.raw-text-preview-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}

.raw-text-preview-copy {
  flex-shrink: 0;
}

.raw-text-preview {
  padding: 24px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}

.raw-text-preview-source {
  margin: 0;
  color: var(--color-text);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>

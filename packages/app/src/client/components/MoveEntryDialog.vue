<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import * as v from 'valibot';
import UploadDestinationDialog from './UploadDestinationDialog.vue';
import { apiPost } from '@/utils/api';
import { MAX_FILE_PATH_LENGTH } from '../../shared/const';
import { filePathValidation, pathSegmentNameValidation } from '../../shared/name-validation';

type EntryType = 'file' | 'directory';

const props = defineProps<{
	open: boolean;
	type: EntryType;
	sourceBucketId: string | null;
	sourceBucketName: string;
	sourcePath: string;
}>();

const emit = defineEmits<{
	'update:open': [boolean];
	moved: [{ bucketName: string; path: string }];
}>();

const entryName = ref('');
const submitting = ref(false);
const error = ref('');
const nameInput = ref<HTMLInputElement | null>(null);
const currentPrefix = ref('');

const title = computed(() => props.type === 'directory' ? 'フォルダを移動/名前変更' : 'ファイルを移動/名前変更');
const targetPath = computed(() => `${currentPrefix.value}${entryName.value.trim()}${props.type === 'directory' ? '/' : ''}`);
const nameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, '名前を入力してください'),
	pathSegmentNameValidation,
);

const validationError = computed(() => {
	const nameResult = v.safeParse(nameSchema, entryName.value);
	if (!nameResult.success) return nameResult.issues[0]?.message ?? '名前が正しくありません';
	if (targetPath.value.length > MAX_FILE_PATH_LENGTH) return `パスは${MAX_FILE_PATH_LENGTH}文字以内で入力してください`;
	if (!v.safeParse(v.pipe(v.string(), filePathValidation), `${currentPrefix.value}${entryName.value.trim() || 'placeholder'}`).success) {
		return '移動先パスが正しくありません';
	}
	return null;
});
const canSubmit = computed(() => !submitting.value && validationError.value == null && props.sourceBucketId != null);

function splitPath(path: string): { parentPath: string; name: string } {
	const normalized = props.type === 'directory' ? path.replace(/\/$/, '') : path;
	const parts = normalized.split('/');
	const name = parts.pop() ?? '';
	return {
		parentPath: parts.length === 0 ? '' : `${parts.join('/')}/`,
		name,
	};
}

async function submit(destination: { bucketId: string; bucketName: string; prefix: string }): Promise<void> {
	updateDestination(destination);
	if (!canSubmit.value || !props.sourceBucketId) return;
	submitting.value = true;
	error.value = '';
	const result = await apiPost('/api/files/move', {
		type: props.type,
		sourceBucketId: props.sourceBucketId,
		sourcePath: props.sourcePath,
		targetBucketId: destination.bucketId,
		targetPath: targetPath.value,
	});
	submitting.value = false;
	if (!result.ok) {
		error.value = result.data.message;
		return;
	}
	emit('update:open', false);
	emit('moved', { bucketName: destination.bucketName, path: targetPath.value });
}

function updateDestination(destination: { bucketId: string; bucketName: string; prefix: string }): void {
	currentPrefix.value = destination.prefix;
}

watch(() => props.open, async (open) => {
	if (!open) return;
	const initial = splitPath(props.sourcePath);
	entryName.value = initial.name;
	currentPrefix.value = initial.parentPath;
	error.value = '';
	await nextTick();
	nameInput.value?.focus();
	nameInput.value?.select();
}, { immediate: true });
</script>

<template>
  <UploadDestinationDialog
    :open="open"
    :title="title"
    bucket-step-label="移動先バケットを選択してください"
    directory-step-label="移動先フォルダと名前を指定してください"
    :initial-bucket-name="sourceBucketName"
    :initial-prefix="splitPath(sourcePath).parentPath"
    confirm-label="移動する"
    confirm-loading-label="移動中..."
    :confirm-disabled="!canSubmit"
    :confirm-loading="submitting"
    :close-on-select="false"
    :hide-current-path="true"
    @update:open="emit('update:open', $event)"
    @change="updateDestination"
    @select="submit"
  >
    <template #directory-extra="{ bucketName, prefix }">
      <div class="form-group">
        <label class="form-label" for="move-entry-name">名前</label>
        <input id="move-entry-name" ref="nameInput" v-model="entryName" class="form-input form-input-mono" type="text" autocomplete="off">
      </div>
      <p :class="$style.targetPath">
        <span :class="$style.bucketPart">{{ bucketName }}/</span><span>{{ prefix }}{{ entryName.trim() }}{{ type === 'directory' ? '/' : '' }}</span>
      </p>
      <p v-if="validationError" class="form-error">{{ validationError }}</p>
      <p v-if="error" class="form-error">{{ error }}</p>
    </template>
  </UploadDestinationDialog>
</template>

<style module lang="scss">
.targetPath {
  font-family: monospace;
  font-size: 0.875rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 8px 10px;
  margin: 0;
  word-break: break-all;
}

.bucketPart {
  color: var(--color-text);
}
</style>

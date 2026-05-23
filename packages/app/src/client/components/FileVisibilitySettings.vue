<script setup lang="ts">
import type { FileVisibility } from '../../shared/file-visibility';

withDefaults(defineProps<{
	visibility: FileVisibility;
	isListed: boolean;
	passphrase?: string;
	lockVisibility?: boolean;
	passphraseAutocomplete?: string;
}>(), {
	passphrase: '',
	lockVisibility: false,
	passphraseAutocomplete: undefined,
});

const emit = defineEmits<{
	(e: 'update:visibility', value: FileVisibility): void;
	(e: 'update:isListed', value: boolean): void;
	(e: 'update:passphrase', value: string): void;
}>();

function onVisibilityInput(event: Event): void {
	emit('update:visibility', (event.target as HTMLInputElement).value as FileVisibility);
}

function onIsListedInput(event: Event): void {
	emit('update:isListed', (event.target as HTMLInputElement).checked);
}

function onPassphraseInput(event: Event): void {
	emit('update:passphrase', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div :class="$style.root">
    <div v-if="lockVisibility" class="form-hint">
      公開ファイルは非公開に戻せません。
    </div>
    <div v-else :class="$style.visibilityOptions">
      <div :class="$style.visibilitySelectGroup">
        <label class="form-label" for="file-visibility-select">公開設定</label>
        <select
          id="file-visibility-select"
          class="form-input"
          :class="$style.visibilitySelect"
          :value="visibility"
          @change="onVisibilityInput"
        >
          <option value="public">公開</option>
          <option value="private">非公開</option>
          <option value="passphrase">合言葉で保護</option>
        </select>
      </div>
      <div v-if="visibility === 'public'" class="form-hint">
        一度公開したファイルは非公開に戻せません。
      </div>
      <div v-else-if="visibility === 'private'" class="form-hint">
        一時トークンを発行し、URLを共有すればファイルにアクセスできます。
      </div>
    </div>

    <div v-if="visibility === 'passphrase' && !lockVisibility" :class="[$style.passphraseGroup, 'form-group']">
      <label class="form-label" for="file-visibility-passphrase">合言葉</label>
      <input
        id="file-visibility-passphrase"
        :value="passphrase"
        class="form-input"
        type="text"
        :autocomplete="passphraseAutocomplete"
        placeholder="アクセス用の合言葉"
        @input="onPassphraseInput"
      >
    </div>

    <label class="checkbox-label">
      <input type="checkbox" :checked="isListed" @input="onIsListedInput">
      ファイル一覧とActivityPubに表示
    </label>
  </div>
</template>

<style module lang="scss">
.root {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.visibilityOptions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.visibilitySelectGroup {
  max-width: 320px;
}

.visibilitySelect {
  width: 100%;
}

.passphraseGroup {
  max-width: 320px;
}
</style>

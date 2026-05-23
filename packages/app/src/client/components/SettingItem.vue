<!--
  Valibotスキーマを利用し、設定画面の項目を自動で描画します。
-->

<script setup lang="ts" generic="TValue extends string | number | null = string">
import * as v from 'valibot';
import { computed } from 'vue';

type SchemaLike = v.GenericSchema<unknown, string | number | null> & {
	type: string;
	wrapped?: unknown;
	pipe?: unknown[];
	options?: readonly string[];
};

const props = withDefaults(defineProps<{
	modelValue: TValue;
	schema: v.GenericSchema<unknown, TValue>;
	title: string;
	saving?: boolean;
	multiline?: boolean;
	inputType?: 'date';
	showSaveButton?: boolean;
	saveOnChange?: boolean;
	/** selectの選択肢に表示するラベル。未指定時はvalue値をそのまま表示 */
	optionLabels?: Record<string, string>;
}>(), {
	showSaveButton: true,
	saveOnChange: true,
});

const emit = defineEmits<{
	'update:modelValue': [value: TValue];
	save: [value: TValue];
}>();

type InputKind = 'checkbox' | 'select' | 'textarea' | 'text' | 'number' | 'date';

function unwrapSchema(schema: unknown): SchemaLike {
	const s = schema as SchemaLike;
	if (s.type === 'optional' || s.type === 'nullable' || s.type === 'nullish') {
		return unwrapSchema(s.wrapped);
	}
	if (s.type === 'pipe') {
		return unwrapSchema(s.pipe?.[0]);
	}
	return s;
}

const innerSchema = computed<SchemaLike>(() => {
	return unwrapSchema(props.schema);
});

const inputKind = computed<InputKind>(() => {
	if (props.inputType === 'date') return 'date';
	if (innerSchema.value.type === 'number') return 'number';
	if (innerSchema.value.type === 'picklist') {
		const opts = innerSchema.value.options ?? [];
		if (opts.length === 2 && opts[0] === 'true' && opts[1] === 'false') return 'checkbox';
		return 'select';
	}
	return props.multiline ? 'textarea' : 'text';
});

const picklistOptions = computed(() => {
	if (innerSchema.value.type !== 'picklist') return [] as readonly string[];
	return innerSchema.value.options ?? [];
});

const validationError = computed(() => {
	const result = v.safeParse(props.schema, props.modelValue);
	return result.success ? null : result.issues[0]?.message ?? '入力値が正しくありません';
});

function onCheckboxChange(e: Event) {
	const value = (e.target as HTMLInputElement).checked ? 'true' : 'false';
	emit('update:modelValue', value as TValue);
	if (props.saveOnChange) emit('save', value as TValue);
}

function onSelectChange(e: Event) {
	const value = (e.target as HTMLSelectElement).value;
	emit('update:modelValue', value as TValue);
	if (props.saveOnChange) emit('save', value as TValue);
}

function onTextInput(e: Event) {
	emit('update:modelValue', (e.target as HTMLInputElement | HTMLTextAreaElement).value as TValue);
}

function onNumberInput(e: Event) {
	const raw = (e.target as HTMLInputElement).value;
	const value = raw === '' ? null : Number(raw);
	if (value !== null && !Number.isFinite(value)) return;
	emit('update:modelValue', value as TValue);
}

function onSave() {
	if (validationError.value != null) return;
	emit('save', props.modelValue);
}
</script>

<template>
  <div :class="[$style.settingRow, { [$style.settingRowMultiline]: inputKind === 'textarea' }]">
    <!-- textarea -->
    <template v-if="inputKind === 'textarea'">
      <div :class="$style.textareaHeader">
        <div :class="$style.settingRowInfo">
          <label :class="[$style.label]">{{ title }}</label>
          <div v-if="$slots.default" :class="$style.description">
            <slot />
          </div>
        </div>
        <button
          v-if="props.showSaveButton"
          type="button"
          class="btn btn-primary"
          :disabled="saving"
          @click="onSave"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
      <textarea
        :value="(modelValue as string)"
        :class="[$style.textarea, 'form-input']"
        rows="4"
        :aria-invalid="validationError != null"
        @input="onTextInput"
      />
      <p v-if="validationError" :class="$style.validationError">{{ validationError }}</p>
    </template>

    <!-- checkbox -->
    <template v-else-if="inputKind === 'checkbox'">
      <div :class="$style.settingRowInfo">
        <label :class="[$style.label, $style.cursorPointer]">{{ title }}</label>
        <div v-if="$slots.default" :class="$style.description">
          <slot />
        </div>
      </div>
      <div :class="$style.settingRowControl">
        <div class="flex gap-2 items-center">
          <label :class="[$style.switch, { [$style.switchDisabled]: saving }]">
            <input
              type="checkbox"
              :checked="modelValue === 'true'"
              :disabled="saving"
              :class="$style.switchInput"
              @change="onCheckboxChange"
            >
            <span :class="$style.switchTrack">
              <span :class="$style.switchThumb" />
            </span>
          </label>
          <button
            v-if="props.showSaveButton"
            type="button"
            class="btn btn-primary"
            :disabled="saving || validationError != null"
            @click="onSave"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </template>

    <!-- select -->
    <template v-else-if="inputKind === 'select'">
      <div :class="$style.settingRowInfo">
        <label :class="[$style.label]">{{ title }}</label>
        <div v-if="$slots.default" :class="$style.description">
          <slot />
        </div>
      </div>
      <div :class="$style.settingRowControl">
        <div class="flex gap-2">
          <select
            :value="(modelValue as string)"
            :disabled="saving"
            class="form-input"
            :class="$style.select"
            @change="onSelectChange"
          >
            <option v-for="opt in picklistOptions" :key="opt" :value="opt">{{ optionLabels?.[opt] ?? opt }}</option>
          </select>
          <button
            v-if="props.showSaveButton"
            type="button"
            class="btn btn-primary"
            :disabled="saving || validationError != null"
            @click="onSave"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </template>

    <!-- number -->
    <template v-else-if="inputKind === 'number'">
      <div :class="$style.settingRowInfo">
        <label :class="[$style.label]">{{ title }}</label>
        <div v-if="$slots.default" :class="$style.description">
          <slot />
        </div>
      </div>
      <div :class="$style.settingRowControl">
        <div class="flex gap-2">
          <input
            :value="modelValue == null ? '' : String(modelValue)"
            type="number"
            min="0"
            placeholder="無制限"
            :disabled="saving"
            :aria-invalid="validationError != null"
            :class="[$style.numberInput, 'form-input']"
            @input="onNumberInput"
          >
          <button
            v-if="props.showSaveButton"
            type="button"
            class="btn btn-primary"
            :disabled="saving || validationError != null"
            @click="onSave"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
        <p v-if="validationError" :class="$style.validationError">{{ validationError }}</p>
      </div>
    </template>

    <!-- date/text -->
    <template v-else>
      <div :class="$style.settingRowInfo">
        <label :class="[$style.label]">{{ title }}</label>
        <div v-if="$slots.default" :class="$style.description">
          <slot />
        </div>
      </div>
      <div :class="$style.settingRowControl">
        <div class="flex gap-2">
          <input
            :value="(modelValue as string)"
            :type="inputKind === 'date' ? 'date' : 'text'"
            :disabled="saving"
            :aria-invalid="validationError != null"
            :class="[$style.textInput, 'form-input']"
            @input="onTextInput"
          >
          <button
            v-if="props.showSaveButton"
            type="button"
            class="btn btn-primary"
            :disabled="saving || validationError != null"
            @click="onSave"
          >
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
        <p v-if="validationError" :class="$style.validationError">{{ validationError }}</p>
      </div>
    </template>
  </div>
</template>

<style module lang="scss">
.settingRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}

.settingRowMultiline {
  gap: 8px;
  align-items: flex-start;
  flex-direction: column;
}

.settingRowInfo {
  flex: 1;
  min-width: 0;
}

.settingRowControl {
  flex-shrink: 0;
}

.textareaHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.cursorPointer {
  cursor: pointer;
}

.textarea {
  width: 100%;
  resize: vertical;
  font-family: monospace;
}

.textInput {
  width: 160px;
}

.numberInput {
  width: 160px;
}

.select {
  min-width: 120px;
}

.label {
  font-weight: 500;
  font-size: 0.875rem;
}

.description {
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.validationError {
  margin: 4px 0 0;
  color: var(--color-danger);
  font-size: 0.8125rem;
}

.switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 42px;
  height: 24px;
  flex: 0 0 auto;
  cursor: pointer;
}

.switchDisabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.switchInput {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: inherit;
}

.switchTrack {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: var(--color-border);
  border: 1px solid var(--color-border);
  transition: background 0.15s, border-color 0.15s;
}

.switchThumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s;
}

.switchInput:checked + .switchTrack {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.switchInput:checked + .switchTrack .switchThumb {
  transform: translateX(18px);
}

.switchInput:focus-visible + .switchTrack {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>

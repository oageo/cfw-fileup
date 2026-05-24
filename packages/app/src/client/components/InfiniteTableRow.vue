<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
	colspan: number;
	hasMore: boolean;
	loading: boolean;
	label?: string;
	loadingLabel?: string;
	doneLabel?: string;
	auto?: boolean;
}>(), {
	label: 'もっと読み込む',
	loadingLabel: '読み込み中...',
	doneLabel: 'すべて読み込みました',
	auto: true,
});

const emit = defineEmits<{
	(e: 'loadMore'): void;
}>();

const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

function requestLoad(): void {
	if (!props.hasMore || props.loading) return;
	emit('loadMore');
}

function resetObserver(): void {
	observer?.disconnect();
	observer = null;
	if (!props.auto || !sentinel.value) return;
	observer = new IntersectionObserver((entries) => {
		if (entries.some(entry => entry.isIntersecting)) requestLoad();
	}, { rootMargin: '320px 0px' });
	observer.observe(sentinel.value);
}

onMounted(resetObserver);
onBeforeUnmount(() => observer?.disconnect());
watch(() => [props.auto, props.hasMore, props.loading] as const, resetObserver);
</script>

<template>
  <tr>
    <td :colspan="colspan" class="infinite-table-cell">
      <div ref="sentinel" class="infinite-table-content">
        <template v-if="hasMore">
          <button class="btn btn-secondary infinite-table-button" type="button" :disabled="loading" @click="requestLoad">
            <span v-if="loading" class="spinner infinite-table-spinner" />
            {{ loading ? loadingLabel : label }}
          </button>
        </template>
        <span v-else class="infinite-table-done">{{ doneLabel }}</span>
      </div>
    </td>
  </tr>
</template>

<style scoped lang="scss">
.infinite-table-cell {
  padding: 0 !important;
  background: color-mix(in srgb, var(--color-surface) 82%, var(--color-bg));
}

.infinite-table-content {
  display: flex;
  justify-content: center;
  padding: 14px 12px;
}

.infinite-table-button {
  min-width: 144px;
  justify-content: center;
}

.infinite-table-spinner {
  width: 14px;
  height: 14px;
}

.infinite-table-done {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}
</style>

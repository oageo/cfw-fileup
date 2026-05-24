<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
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
  <div ref="sentinel" class="infinite-load-trigger">
    <template v-if="hasMore">
      <button class="btn btn-secondary infinite-load-button" type="button" :disabled="loading" @click="requestLoad">
        <span v-if="loading" class="spinner infinite-load-spinner" />
        {{ loading ? loadingLabel : label }}
      </button>
    </template>
    <div v-else class="infinite-load-done">{{ doneLabel }}</div>
  </div>
</template>

<style scoped lang="scss">
.infinite-load-trigger {
  display: flex;
  justify-content: center;
  padding: 20px 0 4px;
}

.infinite-load-button {
  min-width: 144px;
  justify-content: center;
  background: var(--color-bg);
}

.infinite-load-spinner {
  width: 14px;
  height: 14px;
}

.infinite-load-done {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
}
</style>

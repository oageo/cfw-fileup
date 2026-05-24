<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { authStore } from '@/store/auth';
import { apiPost, type ApiSuccess } from '@/utils/api';
import EffectiveQuotaDetails from '@/components/EffectiveQuotaDetails.vue';

type EffectiveQuota = ApiSuccess<'/api/account/effective-quota'>['data'];

const quota = ref<EffectiveQuota | null>(null);
const loading = ref(true);
const error = ref('');

async function loadQuota(): Promise<void> {
	loading.value = true;
	error.value = '';
	try {
		const result = await apiPost('/api/account/effective-quota');
		if (!result.ok) {
			error.value = result.data.message || 'クォータの取得に失敗しました';
			return;
		}
		quota.value = result.data;
	} catch (e) {
		error.value = String(e);
	} finally {
		loading.value = false;
	}
}

onMounted(loadQuota);
</script>

<template>
  <div>
    <div class="section-header">
      <h2 class="section-title">マイクォータ</h2>
    </div>

    <div v-if="!authStore.user" class="alert alert-info">ログインが必要です。</div>
    <template v-else>
      <div v-if="error" class="alert alert-error mb-4">{{ error }}</div>
      <div v-if="loading" class="page-loading">
        <span class="spinner" />読み込み中...
      </div>
      <div v-else :class="['card', $style.card]">
        <EffectiveQuotaDetails :quota="quota" />
      </div>
    </template>
  </div>
</template>

<style module lang="scss">
.card {
  max-width: 700px;
}
</style>

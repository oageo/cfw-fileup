<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

type MetaResponse = {
	termsUrl?: string;
	privacyPolicyUrl?: string;
	planPurchaseTermsUrl?: string;
};

const loading = ref(true);
const error = ref('');
const termsUrl = ref('');
const privacyPolicyUrl = ref('');
const planPurchaseTermsUrl = ref('');
const repositoryUrl = __REPOSITORY_URL__;

const repositoryDisplayUrl = computed(() => repositoryUrl.replace(/^git\+/, '').replace(/\.git$/, ''));

const links = computed(() => [
	{ label: '利用規約URL', url: termsUrl.value },
	{ label: 'プライバシーポリシーURL', url: privacyPolicyUrl.value },
	{ label: 'プラン購入契約条項URL', url: planPurchaseTermsUrl.value },
	{ label: 'ソースコードURL', url: repositoryDisplayUrl.value },
]);

async function load(): Promise<void> {
	loading.value = true;
	error.value = '';
	try {
		const res = await fetch('/api/meta');
		if (!res.ok) {
			error.value = 'アプリ情報の取得に失敗しました';
			return;
		}
		const data = await res.json() as MetaResponse;
		termsUrl.value = data.termsUrl ?? '';
		privacyPolicyUrl.value = data.privacyPolicyUrl ?? '';
		planPurchaseTermsUrl.value = data.planPurchaseTermsUrl ?? '';
	} catch (e) {
		error.value = String(e);
	} finally {
		loading.value = false;
	}
}

onMounted(load);
</script>

<template>
  <main :class="$style.page">
    <div class="section-header">
      <div>
        <h1 class="section-title">About</h1>
      </div>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="loading" class="page-loading">
      <span class="spinner" />読み込み中...
    </div>

    <section v-else class="card" :class="$style.card">
      <dl :class="$style.infoList">
        <div v-for="link in links" :key="link.label" :class="$style.infoRow">
          <dt>{{ link.label }}</dt>
          <dd>
            <a v-if="link.url" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.url }}</a>
            <span v-else class="text-muted">未設定</span>
          </dd>
        </div>
        <div :class="$style.infoRow">
          <dt>ライセンス</dt>
          <dd>GNU AGPLv3, Copyright (C) 2026 aqz/tamaina</dd>
        </div>
      </dl>
    </section>
  </main>
</template>

<style module lang="scss">
.page {
  max-width: 900px;
}

.card {
  max-width: none;
}

.infoList {
  display: grid;
  gap: 0;
  margin: 0;
}

.infoRow {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--color-border);
}

.infoRow:first-child {
  padding-top: 0;
}

.infoRow:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.infoRow dt {
  color: var(--color-text-muted);
  font-weight: 600;
}

.infoRow dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 640px) {
  .infoRow {
    grid-template-columns: 1fr;
    gap: 4px;
  }
}
</style>

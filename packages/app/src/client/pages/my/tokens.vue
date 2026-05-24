<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button } from '@vuetify/v0';
import { apiPost } from '@/utils/api';
import { clearAuth } from '@/store/auth';
import InfiniteTableRow from '@/components/InfiniteTableRow.vue';
import { mainRouter } from '@/router';

type TokenItem = {
	id: string;
	createdAt: number;
	lastIpAddress: string | null;
	isCurrent: boolean;
	isRevoked: boolean;
};

const tokens = ref<TokenItem[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');
const revoking = ref(false);
const nextCursor = ref<string | null>(null);
const hasMore = ref(false);

async function loadTokens(cursor: string | null = null): Promise<void> {
	const isMore = cursor !== null;
	if (isMore) {
		loadingMore.value = true;
	} else {
		loading.value = true;
	}
	error.value = '';
	try {
		const result = await apiPost('/api/account/tokens', { limit: 50, cursor });
		if (!result.ok) {
			error.value = result.data.message || 'アクセストークン履歴の取得に失敗しました';
			return;
		}
		tokens.value = cursor ? [...tokens.value, ...result.data.items] : result.data.items;
		nextCursor.value = result.data.nextCursor;
		hasMore.value = result.data.hasMore;
	} catch (e) {
		error.value = String(e);
	} finally {
		if (isMore) {
			loadingMore.value = false;
		} else {
			loading.value = false;
		}
	}
}

async function revokeAllTokens(): Promise<void> {
	if (!window.confirm('すべてのアクセストークンを失効します。現在のセッションもログアウトされます。')) return;
	revoking.value = true;
	error.value = '';
	try {
		const result = await apiPost('/api/account/tokens/revoke-all');
		if (!result.ok) {
			error.value = result.data.message || 'アクセストークンの失効に失敗しました';
			return;
		}
		clearAuth();
		mainRouter.pushByPath('/signin');
	} catch (e) {
		error.value = String(e);
	} finally {
		revoking.value = false;
	}
}

function formatDate(ms: number): string {
	return new Date(ms).toLocaleString();
}

onMounted(loadTokens);
</script>

<template>
  <div :class="$style.root">
    <div :class="$style.header">
      <div>
        <h2 :class="$style.title">アクセストークン</h2>
        <p :class="$style.description">ログイン履歴と、各トークンが最後に使われたIPを確認できます。</p>
      </div>
      <Button.Root class="btn btn-danger" :loading="revoking" @click="revokeAllTokens">
        <Button.Loading>失効中...</Button.Loading>
        <Button.Content>すべて失効</Button.Content>
      </Button.Root>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div v-if="loading" class="page-loading">
      <span class="spinner" />
      読み込み中...
    </div>

    <div v-else class="card">
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>トークンID</th>
              <th>発行日時</th>
              <th>最後のIP</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in tokens" :key="token.id">
              <td>{{ token.id }}</td>
              <td>{{ formatDate(token.createdAt) }}</td>
              <td>{{ token.lastIpAddress ?? '未記録' }}</td>
              <td>
                <span v-if="token.isRevoked" class="badge badge-danger">失効済み</span>
                <span v-else-if="token.isCurrent" class="badge badge-info">現在</span>
                <span v-else class="badge badge-success">有効</span>
              </td>
            </tr>
            <tr v-if="tokens.length === 0">
              <td colspan="4">アクセストークンはありません。</td>
            </tr>
            <InfiniteTableRow
              v-if="hasMore || loadingMore"
              :colspan="4"
              :has-more="hasMore"
              :loading="loadingMore"
              @load-more="loadTokens(nextCursor)"
            />
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
.root {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.title {
  margin: 0 0 6px;
  font-size: 1.5rem;
}

.description {
  margin: 0;
  color: var(--color-text-muted);
}

@media (max-width: 640px) {
  .root {
    padding: 16px;
  }

  .header {
    flex-direction: column;
  }
}
</style>

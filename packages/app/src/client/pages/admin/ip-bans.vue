<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Button } from '@vuetify/v0';
import { authStore } from '@/store/auth';
import { apiPost } from '@/utils/api';
import InfiniteTableRow from '@/components/InfiniteTableRow.vue';
import NirA from '@/components/NirA.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

type IpBan = {
	id: string;
	cidr: string;
	reason: string | null;
	sourceEventId: string | null;
	createdBy: string | null;
	createdByUsername: string | null;
	expiresAt: number | null;
	createdAt: number;
};

const bans = ref<IpBan[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const saving = ref(false);
const error = ref('');
const actionError = ref('');
const cidr = ref('');
const reason = ref('');
const indefinite = ref(true);
const expiresAtLocal = ref('');
const deleteDialog = ref(false);
const deleteTarget = ref<IpBan | null>(null);
const nextCursor = ref<string | null>(null);
const hasMore = ref(false);

onMounted(() => loadBans());

async function loadBans(cursor: string | null = null): Promise<void> {
	const isMore = cursor !== null;
	if (isMore) {
		loadingMore.value = true;
	} else {
		loading.value = true;
	}
	error.value = '';
	try {
		const result = await apiPost('/api/admin/list-ip-bans', { limit: 50, cursor });
		if (!result.ok) throw new Error(result.data.message || 'IP BAN一覧の取得に失敗しました');
		bans.value = cursor ? [...bans.value, ...result.data.items] : result.data.items;
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

async function createBan(): Promise<void> {
	saving.value = true;
	actionError.value = '';
	try {
		const expiresAt = indefinite.value || !expiresAtLocal.value ? null : new Date(expiresAtLocal.value).getTime();
		const result = await apiPost('/api/admin/create-ip-ban', {
			cidr: cidr.value,
			reason: reason.value.trim() || null,
			expiresAt,
		});
		if (!result.ok) throw new Error(result.data.message || 'IP BANの作成に失敗しました');
		cidr.value = '';
		reason.value = '';
		indefinite.value = true;
		expiresAtLocal.value = '';
		await loadBans();
	} catch (e) {
		actionError.value = String(e);
	} finally {
		saving.value = false;
	}
}

function requestDelete(ban: IpBan): void {
	deleteTarget.value = ban;
	deleteDialog.value = true;
}

async function executeDelete(): Promise<void> {
	if (!deleteTarget.value) return;
	const banId = deleteTarget.value.id;
	deleteDialog.value = false;
	deleteTarget.value = null;
	actionError.value = '';
	try {
		const result = await apiPost('/api/admin/delete-ip-ban', { banId });
		if (!result.ok) throw new Error(result.data.message || 'IP BANの解除に失敗しました');
		await loadBans();
	} catch (e) {
		actionError.value = String(e);
	}
}

function formatDate(ms: number): string {
	return new Date(ms).toLocaleString();
}
</script>

<template>
  <div>
    <NirA to="/admin" class="back-link">← 管理パネルに戻る</NirA>

    <div class="section-header">
      <h2 class="section-title">IP BAN管理</h2>
    </div>

    <div v-if="!(authStore.user?.isAdmin || authStore.user?.isModerator)" class="alert alert-error">
      管理者権限が必要です。
    </div>

    <template v-else>
      <div v-if="error" class="alert alert-error mb-4">{{ error }}</div>
      <div v-if="actionError" class="alert alert-error mb-4">{{ actionError }}</div>

      <form :class="['card', $style.form]" @submit.prevent="createBan">
        <div class="form-group">
          <label class="form-label" for="cidr">CIDR / IP</label>
          <input id="cidr" v-model="cidr" class="form-input form-input-mono" required placeholder="203.0.113.0/24">
        </div>
        <div class="form-group">
          <label class="form-label" for="reason">理由</label>
          <input id="reason" v-model="reason" class="form-input" maxlength="500">
        </div>
        <div class="form-group">
          <label class="form-label" for="expires">期限</label>
          <input id="expires" v-model="expiresAtLocal" class="form-input" type="datetime-local" :disabled="indefinite">
        </div>
        <label :class="$style.indefiniteLabel">
          <input v-model="indefinite" type="checkbox">
          無期限
        </label>
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? '追加中...' : '追加' }}
        </button>
      </form>

      <div v-if="loading" class="page-loading">
        <span class="spinner" />読み込み中...
      </div>

      <div v-else :class="['card', $style.tableCard]">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>CIDR</th>
                <th>理由</th>
                <th>作成者</th>
                <th>作成</th>
                <th>期限</th>
                <th class="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="ban in bans" :key="ban.id">
                <td class="form-input-mono">{{ ban.cidr }}</td>
                <td>{{ ban.reason ?? '' }}</td>
                <td>{{ ban.createdByUsername ?? ban.createdBy ?? '' }}</td>
                <td>{{ formatDate(ban.createdAt) }}</td>
                <td>{{ ban.expiresAt === null ? 'なし' : formatDate(ban.expiresAt) }}</td>
                <td class="col-actions">
                  <Button.Root class="btn btn-ghost-danger" @click="requestDelete(ban)">
                    <Button.Content>解除</Button.Content>
                  </Button.Root>
                </td>
              </tr>
              <tr v-if="bans.length === 0">
                <td colspan="6" :class="$style.empty">IP BANはありません。</td>
              </tr>
              <InfiniteTableRow
                v-if="hasMore || loadingMore"
                :colspan="6"
                :has-more="hasMore"
                :loading="loadingMore"
                @load-more="loadBans(nextCursor)"
              />
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <ConfirmDialog
      v-model:open="deleteDialog"
      title="IP BANを解除"
      :message="deleteTarget ? `${deleteTarget.cidr} のBANを解除しますか？` : ''"
      confirm-label="解除する"
      @confirm="executeDelete"
      @cancel="deleteDialog = false"
    />
  </div>
</template>

<style module lang="scss">
.form {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) minmax(180px, 240px) auto auto;
  gap: 12px;
  align-items: end;
  margin-bottom: 16px;
}

.indefiniteLabel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  color: var(--color-text);
  white-space: nowrap;
}

.tableCard {
  padding: 0;
  overflow: hidden;
}

.empty {
  color: var(--color-text-muted);
  text-align: center;
}

@media (max-width: 820px) {
  .form {
    grid-template-columns: 1fr;
  }
}
</style>

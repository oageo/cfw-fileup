<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { authStore } from '@/store/auth';
import { apiPost, type ApiSuccess } from '@/utils/api';
import { formatBytes } from '@/utils/byte-size';
import InfiniteTableRow from '@/components/InfiniteTableRow.vue';
import NirA from '@/components/NirA.vue';

type AdminFile = ApiSuccess<'/api/admin/list-files'>['data']['items'][number];

const files = ref<AdminFile[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref('');
const nextCursor = ref<string | null>(null);
const hasMore = ref(false);

onMounted(() => loadFiles());

async function loadFiles(cursor: string | null = null): Promise<void> {
	const isMore = cursor !== null;
	if (isMore) {
		loadingMore.value = true;
	} else {
		loading.value = true;
	}
	error.value = '';
	try {
		const result = await apiPost('/api/admin/list-files', { limit: 50, cursor });
		if (!result.ok) throw new Error(result.data.message || 'ファイル一覧の取得に失敗しました');
		files.value = cursor ? [...files.value, ...result.data.items] : result.data.items;
		nextCursor.value = result.data.nextCursor;
		hasMore.value = result.data.hasMore;
	} catch (e) {
		error.value = e instanceof Error ? e.message : String(e);
	} finally {
		if (isMore) {
			loadingMore.value = false;
		} else {
			loading.value = false;
		}
	}
}

function formatDate(ms: number): string {
	return new Date(ms).toLocaleString();
}

function browseUrl(file: AdminFile): string {
	return `/v/${file.bucketName ?? file.bucketId}/${file.path}`;
}

function bucketUrl(file: AdminFile): string {
	return `/v/${file.bucketName ?? file.bucketId}/`;
}

function parentFolderPath(file: AdminFile): string {
	const segments = file.path.split('/');
	segments.pop();
	return segments.length === 0 ? '' : `${segments.join('/')}/`;
}

function folderUrl(file: AdminFile): string {
	return `/v/${file.bucketName ?? file.bucketId}/${parentFolderPath(file)}`;
}

function folderLabel(file: AdminFile): string {
	return parentFolderPath(file) || '/';
}

function fileName(file: AdminFile): string {
	return file.path.split('/').filter(Boolean).at(-1) ?? file.path;
}

function fileKindLabel(file: AdminFile): string {
	if (file.isTargz) return 'tar.gz';
	if (file.isTar) return 'tar';
	return file.mimeType ?? '-';
}
</script>

<template>
  <div>
    <NirA to="/admin" class="back-link">← 管理パネルに戻る</NirA>

    <div class="section-header">
      <h2 class="section-title">ファイル管理</h2>
    </div>

    <div v-if="!authStore.user?.isAdmin" class="alert alert-error">
      管理者権限が必要です。
    </div>

    <template v-else>
      <div v-if="error" class="alert alert-error mb-4">{{ error }}</div>

      <div class="flex items-center gap-2 mb-4">
        <button class="btn btn-secondary" type="button" :disabled="loading" @click="loadFiles()">
          再読み込み
        </button>
      </div>

      <div v-if="loading" class="page-loading">
        <span class="spinner" />読み込み中...
      </div>

      <div v-else :class="['card', $style.tableCard]">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>バケット</th>
                <th>フォルダ</th>
                <th>ファイル</th>
                <th>所有者</th>
                <th>状態</th>
                <th>種類</th>
                <th>サイズ</th>
                <th>作成</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="file in files" :key="file.id">
                <td :class="$style.pathCell">
                  <NirA :to="bucketUrl(file)" :class="$style.path">{{ file.bucketName ?? file.bucketId }}</NirA>
                </td>
                <td :class="$style.pathCell">
                  <NirA :to="folderUrl(file)" :class="$style.path">{{ folderLabel(file) }}</NirA>
                </td>
                <td :class="$style.fileCell">
                  <NirA :to="browseUrl(file)" :class="$style.path">{{ fileName(file) }}</NirA>
                </td>
                <td>{{ file.ownerUsername ?? file.userId }}</td>
                <td :class="$style.statusCell">
                  <span :class="file.visibility === 'public' ? 'badge badge-success' : file.visibility === 'passphrase' ? 'badge badge-warning' : 'badge badge-muted'">
                    {{ file.visibility === 'public' ? '公開' : file.visibility === 'passphrase' ? '合言葉' : '非公開' }}
                  </span>
                  <span v-if="!file.isListed" class="badge badge-muted">非表示</span>
                  <span v-if="file.isModerationForcedPrivate" class="badge badge-danger">強制非公開</span>
                  <span v-if="!file.isClosed" class="badge badge-warning">未完了</span>
                </td>
                <td>
                  <span class="badge badge-muted">{{ fileKindLabel(file) }}</span>
                </td>
                <td>{{ file.size === null ? '-' : formatBytes(file.size) }}</td>
                <td class="col-muted">{{ formatDate(file.createdAt) }}</td>
              </tr>
              <tr v-if="files.length === 0">
                <td colspan="8">
                  <div class="empty-state">
                    <p>ファイルはありません。</p>
                  </div>
                </td>
              </tr>
              <InfiniteTableRow
                v-if="hasMore || loadingMore"
                :colspan="8"
                :has-more="hasMore"
                :loading="loadingMore"
                @load-more="loadFiles(nextCursor)"
              />
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style module lang="scss">
.tableCard {
  padding: 0;
  overflow: hidden;
}

.pathCell {
  min-width: 10em;
  max-width: 0;
}

.fileCell {
  min-width: 12em;
  max-width: 0;
}

.path {
  display: block;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.statusCell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 12em;
}

</style>

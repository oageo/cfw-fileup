<script setup lang="ts">
import { formatBytes } from '@/utils/byte-size';

type EffectiveQuotaSource = 'plan' | 'custom' | 'global' | 'default';

interface EffectiveQuota {
	maxBuckets: number | null;
	maxBucketSizeBytes: number | null;
	maxFilesPerBucket: number | null;
	maxDailyUploads: number | null;
	canUseDownloadCount: boolean;
	showAds: boolean;
	canDisableFileAds: boolean;
	effectiveQuotaExpiresAt: number | null;
	effectiveQuotaUpdatedAt: number | null;
	effectiveQuotaSource: EffectiveQuotaSource | null;
}

defineProps<{
	quota: EffectiveQuota | null;
}>();

function formatDateTime(timestamp: number): string {
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(new Date(timestamp));
}

function formatNullableDateTime(timestamp: number | null): string {
	return timestamp === null ? '-' : formatDateTime(timestamp);
}

function formatQuotaValue(value: number | null): string {
	return value === null ? '無制限' : new Intl.NumberFormat().format(value);
}

function formatByteQuotaValue(value: number | null): string {
	return value === null ? '無制限' : `${value.toLocaleString()} bytes (${formatBytes(value)})`;
}

function formatDownloadCountPermission(value: boolean): string {
	return value ? '許可' : '不可';
}

function formatBoolean(value: boolean): string {
	return value ? '有効' : '無効';
}

function formatEffectiveQuotaSource(source: EffectiveQuotaSource | null): string {
	switch (source) {
		case 'plan': return '課金プラン';
		case 'custom': return 'カスタム';
		case 'global': return 'グローバル';
		case 'default': return 'デフォルト';
		default: return '未計算';
	}
}
</script>

<template>
  <div>
    <div :class="$style.header">
      <h3 :class="$style.title">実効クォータ</h3>
      <slot name="actions" />
    </div>
    <dl v-if="quota" class="detail-list">
      <dt>由来</dt>
      <dd>{{ formatEffectiveQuotaSource(quota.effectiveQuotaSource) }}</dd>
      <dt>バケット数上限</dt>
      <dd>{{ formatQuotaValue(quota.maxBuckets) }}</dd>
      <dt>バケットサイズ上限</dt>
      <dd>{{ formatByteQuotaValue(quota.maxBucketSizeBytes) }}</dd>
      <dt>バケットあたりファイル数上限</dt>
      <dd>{{ formatQuotaValue(quota.maxFilesPerBucket) }}</dd>
      <dt>1日あたりアップロード数上限</dt>
      <dd>{{ formatQuotaValue(quota.maxDailyUploads) }}</dd>
      <dt>DL数カウント</dt>
      <dd>{{ formatDownloadCountPermission(quota.canUseDownloadCount) }}</dd>
      <dt>閲覧時の広告表示</dt>
      <dd>{{ formatBoolean(quota.showAds) }}</dd>
      <dt>配信ファイルの広告オフ</dt>
      <dd>{{ formatDownloadCountPermission(quota.canDisableFileAds) }}</dd>
      <dt>有効期限</dt>
      <dd>{{ formatNullableDateTime(quota.effectiveQuotaExpiresAt) }}</dd>
      <dt>更新日時</dt>
      <dd>{{ formatNullableDateTime(quota.effectiveQuotaUpdatedAt) }}</dd>
    </dl>
    <p v-else class="text-muted">実効クォータはまだ保存されていません。</p>
  </div>
</template>

<style module lang="scss">
.header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.title {
  margin: 0;
  font-size: 1rem;
}
</style>

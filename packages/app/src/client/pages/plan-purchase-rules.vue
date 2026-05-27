<script setup lang="ts">
import { onMounted, ref } from 'vue';

const loading = ref(true);
const error = ref('');
const termsUrl = ref('');
const termsUpdatedAt = ref('');

async function load(): Promise<void> {
	loading.value = true;
	error.value = '';
	try {
		const res = await fetch('/api/meta');
		if (!res.ok) {
			error.value = '契約条項リンクの取得に失敗しました';
			return;
		}
		const data = await res.json() as { termsUrl?: string; termsUpdatedAt?: string };
		termsUrl.value = data.termsUrl ?? '';
		termsUpdatedAt.value = data.termsUpdatedAt ?? '';
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
        <h1 class="section-title">プラン購入について</h1>
      </div>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="loading" class="page-loading">
      <span class="spinner" />読み込み中...
    </div>

    <div v-else :class="$style.stack">
      <section class="card" :class="$style.card">
        <h2>契約条項</h2>
        <p>
          プランの購入には、管理者が設定した契約条項が適用されます。
        </p>
        <p v-if="termsUrl">
          <a :href="termsUrl" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">契約条項を開く</a>
        </p>
        <p v-else class="text-muted">
          契約条項リンクは現在設定されていません。
        </p>
        <p v-if="termsUpdatedAt" class="text-muted">
          契約条項更新日: {{ termsUpdatedAt }}
        </p>
        <p :class="$style.notice">
          購入後の取り消しや返金は自動では行われません。決済方法の性質上、すぐに対応できない場合があります。
          購入内容、開始日、期限、支払額を確認してから購入してください。
        </p>
      </section>

      <section class="card" :class="$style.card">
        <h2>プラン適用期間と割引ルール</h2>
        <h3>購入開始日と期限</h3>
        <p>
          現在プランがない場合、購入したプランは支払い確認時点から開始します。
          すでに同じプランを持っている場合は、原則として現在の期限の後ろに購入期間を追加します。
        </p>
        <h3>ダウングレード後の適用期間</h3>
        <p>
          より低いプランを購入する場合は、現在または将来の上位プラン期限後に開始する予約として扱います。
          上位プランの残り期間がある間は、購入した下位プランへすぐには切り替わりません。
        </p>
        <h3>アップグレード精算</h3>
        <p>
          より高いプランを購入する場合、現在または将来に残っている下位プランの価値を、取得時の価格にもとづいて按分し、支払額から差し引きます。
          複数の下位プランが積まれている場合は、アップグレード後の有効期間と重なる範囲をまとめて精算対象にします。
          精算額が購入額以上になる場合、支払額は0になります。超過分の返金や繰越クレジットは作成しません。
        </p>
        <h3>期間限定価格と割引表示</h3>
        <p>
          期間限定価格は、購入可能な現在価格として表示されます。期間が設定されている場合、購入ダイアログではその終了日時も表示します。
        </p>
        <p>
          通常価格との比較を表示する場合は、直近8週間の販売履歴をもとに確認します。
          比較に使う価格が現在価格より高く、十分な期間にわたって実際に販売されており、直近の販売実績も確認できる場合に限って表示します。
        </p>
        <p class="text-muted">
          通常価格との比較が表示されない場合でも、表示されている現在価格で購入できます。
        </p>
      </section>
    </div>
  </main>
</template>

<style module lang="scss">
.page {
  max-width: 900px;
}

.lead {
  margin-bottom: 0;
}

.stack {
  display: grid;
  gap: 16px;
}

.card {
  max-width: none;
}

.card h2 {
  margin-bottom: 12px;
}

.card h3 {
  margin-top: 18px;
  margin-bottom: 8px;
  font-size: 1rem;
}

.notice {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
  color: var(--color-text-muted);
}

.card p:last-child {
  margin-bottom: 0;
}
</style>

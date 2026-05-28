<script setup lang="ts">
import type { ApiSuccess } from '@/utils/api';

type Payment = ApiSuccess<'/api/billing/list-my-payments'>['data']['items'][number];

const props = withDefaults(defineProps<{
	payments: Payment[];
	loading?: boolean;
	cancelingPaymentId?: string | null;
	checkingPaymentId?: string | null;
	loadingReceiptId?: string | null;
	showUserId?: boolean;
	showCancel?: boolean;
	showReceipt?: boolean;
	checkLabel?: string;
	emptyText?: string;
}>(), {
	loading: false,
	cancelingPaymentId: null,
	checkingPaymentId: null,
	loadingReceiptId: null,
	showUserId: false,
	showCancel: false,
	showReceipt: false,
	checkLabel: 'チェーン確認',
	emptyText: '決済履歴はありません。',
});

const emit = defineEmits<{
	cancel: [payment: Payment];
	check: [payment: Payment];
	receipt: [payment: Payment];
}>();

function formatDate(value: number | null): string {
	return value == null ? '-' : new Date(value).toLocaleString();
}

function formatAmount(amountBaseUnits: string | null, decimals: number, symbol: string): string {
	if (amountBaseUnits == null) return '-';
	const padded = amountBaseUnits.padStart(decimals + 1, '0');
	const integer = padded.slice(0, -decimals);
	const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '');
	return `${integer}${fraction ? `.${fraction}` : ''} ${symbol}`;
}

function formatDuration(value: number, unit: 'days' | 'months' | 'years'): string {
	const label = unit === 'days' ? '日' : unit === 'months' ? 'ヶ月' : '年';
	return `${value}${label}`;
}

function canCancelPayment(payment: Payment): boolean {
	return props.showCancel && payment.status === 'pending' && payment.txHash == null;
}

function canCheckPayment(payment: Payment): boolean {
	return payment.status === 'pending' && payment.txHash != null;
}

function checkPaymentButtonLabel(payment: Payment): string {
	return props.checkingPaymentId === payment.id ? '確認中...' : props.checkLabel;
}

function paymentPlanName(payment: Payment): string {
	return payment.planName ?? 'プラン';
}

function paymentEffectiveExpiresAt(payment: Payment): number | null {
	return payment.quoteEffectiveExpiresAt ?? null;
}

function paymentDiscountBaseUnits(payment: Payment): string {
	return payment.quoteDiscountBaseUnits ?? '0';
}

function hasPaymentDiscount(payment: Payment): boolean {
	return paymentDiscountBaseUnits(payment) !== '0';
}

function paymentStatusLabel(status: Payment['status']): string {
	switch (status) {
		case 'pending': return '保留中';
		case 'paid': return '支払い済み';
		case 'expired': return '期限切れ';
		case 'failed': return '失敗';
	}
}

function paymentStatusClass(payment: Payment): string {
	if (payment.status === 'paid') return 'badge badge-success';
	if (payment.status === 'expired' || payment.status === 'failed') return 'badge badge-danger';
	if (payment.txHash != null) return 'badge badge-info';
	return 'badge badge-muted';
}

function paymentStatusText(payment: Payment): string {
	if (payment.status === 'pending' && payment.txHash != null) return '確認待ち';
	return paymentStatusLabel(payment.status);
}
</script>

<template>
  <div v-if="loading" class="page-loading">
    <span class="spinner" />読み込み中...
  </div>
  <div v-else :class="['card', $style.tableCard]">
    <div class="table-responsive">
      <table :class="['data-table', $style.historyTable]">
        <colgroup>
          <col v-if="showUserId" :class="$style.colUser">
          <col :class="$style.colPlan">
          <col :class="$style.colAmount">
          <col :class="$style.colExpiry">
          <col :class="$style.colQuote">
          <col :class="$style.colStatus">
          <col :class="$style.colTx">
          <col :class="$style.colPaidAt">
          <col :class="$style.colActions">
        </colgroup>
        <thead>
          <tr>
            <th v-if="showUserId">User</th>
            <th>プラン</th>
            <th>支払額</th>
            <th>購入後期限</th>
            <th>計算内容</th>
            <th>Status</th>
            <th>tx</th>
            <th>paidAt</th>
            <th :class="['col-actions', $style.actionsCell]">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="payment in payments" :key="payment.id">
            <td v-if="showUserId">
              <code :class="$style.hashText">{{ payment.userId }}</code>
            </td>
            <td>
              <div :class="$style.cellPrimary">{{ paymentPlanName(payment) }}</div>
              <div :class="['text-muted', $style.cellSecondary]">{{ payment.tokenSymbol }} / {{ payment.chainName }}</div>
              <div :class="['text-muted', $style.cellSecondary]"><code>{{ payment.id }}</code></div>
            </td>
            <td>
              <div :class="$style.cellPrimary">{{ formatAmount(payment.amountBaseUnits, payment.decimals, payment.tokenSymbol) }}</div>
              <div v-if="hasPaymentDiscount(payment)" :class="['text-muted', $style.cellSecondary]">
                通常 {{ formatAmount(payment.quoteBaseAmountBaseUnits, payment.decimals, payment.tokenSymbol) }}
              </div>
            </td>
            <td>{{ formatDate(paymentEffectiveExpiresAt(payment)) }}</td>
            <td :class="$style.quoteCell">
              <div>{{ formatDuration(payment.durationDays, payment.durationUnit) }}</div>
              <div v-if="hasPaymentDiscount(payment)" :class="['text-muted', $style.cellSecondary]">
                割引 {{ formatAmount(paymentDiscountBaseUnits(payment), payment.decimals, payment.tokenSymbol) }}
              </div>
              <div v-if="payment.quoteCurrentPlanName && hasPaymentDiscount(payment)" :class="['text-muted', $style.cellSecondary]">
                {{ payment.quoteCurrentPlanName }} の残り期間を {{ formatAmount(payment.quoteCurrentPlanPriceAmountBaseUnits ?? '0', payment.decimals, payment.tokenSymbol) }} / {{ formatDuration(payment.quoteCurrentPlanPriceDurationDays ?? 1, payment.quoteCurrentPlanPriceDurationUnit ?? 'days') }} で按分
              </div>
              <div v-else-if="payment.quoteCurrentPlanName" :class="['text-muted', $style.cellSecondary]">
                {{ payment.quoteCurrentPlanName }} の期限後に開始
              </div>
            </td>
            <td><span :class="paymentStatusClass(payment)">{{ paymentStatusText(payment) }}</span></td>
            <td>
              <code :class="$style.hashText" :title="payment.txHash ?? undefined">{{ payment.txHash ?? '-' }}</code>
            </td>
            <td>{{ formatDate(payment.paidAt) }}</td>
            <td :class="['col-actions', $style.actionsCell]">
              <button v-show="canCancelPayment(payment)" class="btn btn-secondary btn-sm" :class="$style.actionButton" type="button" :disabled="cancelingPaymentId !== null" @click="emit('cancel', payment)">
                {{ cancelingPaymentId === payment.id ? 'キャンセル中...' : 'キャンセル' }}
              </button>
              <button v-show="canCheckPayment(payment)" class="btn btn-secondary btn-sm" :class="$style.actionButton" type="button" :disabled="checkingPaymentId !== null" @click="emit('check', payment)">
                <span v-if="checkingPaymentId === payment.id" class="btn-spinner" aria-hidden="true" />
                {{ checkPaymentButtonLabel(payment) }}
              </button>
              <button v-show="showReceipt && payment.status === 'paid'" class="btn btn-secondary btn-sm" :class="$style.actionButton" type="button" :disabled="loadingReceiptId !== null" @click="emit('receipt', payment)">
                {{ loadingReceiptId === payment.id ? '作成中...' : '領収書' }}
              </button>
            </td>
          </tr>
          <tr v-if="payments.length === 0">
            <td :colspan="showUserId ? 9 : 8" class="text-muted">{{ emptyText }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style module lang="scss">
.tableCard {
  max-width: none;
  padding: 0;
  overflow: hidden;
}

.historyTable {
  min-width: 1240px;
  table-layout: fixed;
}

.colUser { width: 13%; }
.colPlan { width: 15%; }
.colAmount { width: 12%; }
.colExpiry { width: 14%; }
.colQuote { width: 22%; }
.colStatus { width: 8%; }
.colTx { width: 10%; }
.colPaidAt { width: 12%; }
.colActions { width: 120px; }

.actionsCell {
  min-width: 120px;
  text-align: right;
}

.actionButton {
  width: 100%;
}

.historyTable td {
  min-width: 0;
  overflow: hidden;
}

.cellPrimary,
.cellSecondary,
.hashText {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hashText {
  max-width: 100%;
}

.quoteCell .cellSecondary {
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  .historyTable {
    min-width: 1240px;
  }

  .hashText {
    max-width: 7rem;
  }
}
</style>

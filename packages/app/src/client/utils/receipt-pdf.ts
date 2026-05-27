import type { Template } from '@pdfme/common';
import { generate } from '@pdfme/generator';
import type { ApiSuccess } from './api';

type Receipt = ApiSuccess<'/api/billing/get-payment-receipt'>['data'];
type ReceiptOrder = Receipt['order'];

const receiptFontName = 'IBMPlexSansJP';
const receiptFontPath = '/assets/fonts/ibm_plex_sans_jp/IBMPlexSansJP-Regular.ttf';
const fallbackTaxCurrency = 'USD';

const template: Template = {
	basePdf: { width: 210, height: 297, padding: [16, 16, 16, 16] },
	schemas: [[
		{ name: 'title', type: 'text', fontName: receiptFontName, position: { x: 18, y: 18 }, width: 174, height: 12, fontSize: 22, fontColor: '#111111' },
		{ name: 'orderIdLabel', type: 'text', fontName: receiptFontName, position: { x: 18, y: 39 }, width: 36, height: 7, fontSize: 9, fontColor: '#555555' },
		{ name: 'orderId', type: 'text', fontName: receiptFontName, position: { x: 55, y: 39 }, width: 137, height: 7, fontSize: 9, fontColor: '#333333' },
		{ name: 'paidAtLabel', type: 'text', fontName: receiptFontName, position: { x: 18, y: 49 }, width: 36, height: 7, fontSize: 9, fontColor: '#555555' },
		{ name: 'paidAt', type: 'text', fontName: receiptFontName, position: { x: 55, y: 49 }, width: 137, height: 7, fontSize: 9, fontColor: '#333333' },
		{ name: 'separator1', type: 'text', fontName: receiptFontName, position: { x: 18, y: 62 }, width: 174, height: 4, fontSize: 8, fontColor: '#999999' },
		{ name: 'planLabel', type: 'text', fontName: receiptFontName, position: { x: 18, y: 72 }, width: 28, height: 7, fontSize: 10, fontColor: '#333333' },
		{ name: 'plan', type: 'text', fontName: receiptFontName, position: { x: 48, y: 72 }, width: 86, height: 7, fontSize: 10, fontColor: '#333333' },
		{ name: 'planAmount', type: 'text', fontName: receiptFontName, position: { x: 136, y: 72 }, width: 56, height: 7, fontSize: 10, alignment: 'right', fontColor: '#333333' },
		{ name: 'discountLabel', type: 'text', fontName: receiptFontName, position: { x: 18, y: 83 }, width: 28, height: 7, fontSize: 10, fontColor: '#333333' },
		{ name: 'discount', type: 'text', fontName: receiptFontName, position: { x: 48, y: 83 }, width: 86, height: 7, fontSize: 10, fontColor: '#333333' },
		{ name: 'discountAmount', type: 'text', fontName: receiptFontName, position: { x: 136, y: 83 }, width: 56, height: 7, fontSize: 10, alignment: 'right', fontColor: '#333333' },
		{ name: 'separator2', type: 'text', fontName: receiptFontName, position: { x: 18, y: 95 }, width: 174, height: 4, fontSize: 8, fontColor: '#999999' },
		{ name: 'totalLabel', type: 'text', fontName: receiptFontName, position: { x: 18, y: 106 }, width: 40, height: 8, fontSize: 12, fontColor: '#111111' },
		{ name: 'total', type: 'text', fontName: receiptFontName, position: { x: 86, y: 106 }, width: 106, height: 8, fontSize: 13, alignment: 'right', fontColor: '#111111' },
		{ name: 'taxLabel', type: 'text', fontName: receiptFontName, position: { x: 18, y: 119 }, width: 40, height: 7, fontSize: 10, fontColor: '#333333' },
		{ name: 'taxRate', type: 'text', fontName: receiptFontName, position: { x: 62, y: 119 }, width: 22, height: 7, fontSize: 10, fontColor: '#333333' },
		{ name: 'tax', type: 'text', fontName: receiptFontName, position: { x: 136, y: 119 }, width: 56, height: 7, fontSize: 10, alignment: 'right', fontColor: '#333333' },
		{ name: 'paymentMethodTitle', type: 'text', fontName: receiptFontName, position: { x: 18, y: 143 }, width: 174, height: 8, fontSize: 12, fontColor: '#111111' },
		{ name: 'txLabel', type: 'text', fontName: receiptFontName, position: { x: 18, y: 158 }, width: 174, height: 7, fontSize: 9, fontColor: '#555555' },
		{ name: 'txHash', type: 'text', fontName: receiptFontName, position: { x: 18, y: 168 }, width: 174, height: 14, fontSize: 8, fontColor: '#333333' },
		{ name: 'paymentRailLabel', type: 'text', fontName: receiptFontName, position: { x: 18, y: 188 }, width: 40, height: 7, fontSize: 9, fontColor: '#555555' },
		{ name: 'paymentRail', type: 'text', fontName: receiptFontName, position: { x: 62, y: 188 }, width: 130, height: 7, fontSize: 9, fontColor: '#333333' },
		{ name: 'paymentAmountLabel', type: 'text', fontName: receiptFontName, position: { x: 18, y: 199 }, width: 40, height: 7, fontSize: 9, fontColor: '#555555' },
		{ name: 'paymentAmount', type: 'text', fontName: receiptFontName, position: { x: 62, y: 199 }, width: 130, height: 7, fontSize: 9, fontColor: '#333333' },
		{ name: 'sellerName', type: 'text', fontName: receiptFontName, position: { x: 18, y: 208 }, width: 174, height: 7, fontSize: 10, fontColor: '#111111' },
		{ name: 'registrationNumber', type: 'text', fontName: receiptFontName, position: { x: 18, y: 219 }, width: 174, height: 7, fontSize: 9, fontColor: '#333333' },
		{ name: 'sellerAddress', type: 'text', fontName: receiptFontName, position: { x: 18, y: 230 }, width: 174, height: 18, fontSize: 9, fontColor: '#333333' },
	]],
};

function baseUnitsToNumber(amountBaseUnits: string, decimals: number): number {
	const padded = amountBaseUnits.padStart(decimals + 1, '0');
	const integer = padded.slice(0, -decimals);
	const fraction = decimals === 0 ? '' : padded.slice(-decimals);
	return Number(`${integer}${fraction ? `.${fraction}` : ''}`);
}

function formatTaxCurrencyBaseUnits(amountBaseUnits: string, decimals: number, currency: string): string {
	const normalized = currency.trim().toUpperCase();
	const safeCurrency = /^[A-Z]{3}$/.test(normalized) ? normalized : fallbackTaxCurrency;
	const value = baseUnitsToNumber(amountBaseUnits, decimals);
	if (!Number.isFinite(value)) return '-';
	return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: safeCurrency }).format(value);
}

function formatDate(value: number | null): string {
	return value == null ? '-' : new Date(value).toLocaleString();
}

function formatAmount(order: ReceiptOrder): string {
	const decimals = order.decimals;
	const padded = order.amountBaseUnits.padStart(decimals + 1, '0');
	const integer = padded.slice(0, -decimals);
	const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '');
	return `${integer}${fraction ? `.${fraction}` : ''} ${order.tokenSymbol}`;
}

function formatDuration(order: ReceiptOrder): string {
	if (order.durationUnit === 'months') return `${order.durationDays}ヶ月`;
	if (order.durationUnit === 'years') return `${order.durationDays}年`;
	return `${order.durationDays}日`;
}

function buildInputs(receipt: Receipt): Record<string, string>[] {
	const { order, seller } = receipt;
	const taxRate = `${Number(order.taxRate) * 100}%`;
	const taxNote = `税込 (税率${taxRate})`;
	const taxCurrency = order.taxCurrency;
	const discountAmount = BigInt(order.quoteDiscountBaseUnits);
	return [{
		title: '領収書',
		orderIdLabel: '注文ID',
		orderId: order.id,
		paidAtLabel: '支払日時',
		paidAt: formatDate(order.paidAt),
		separator1: '---',
		planLabel: 'プラン',
		plan: `${order.planName} ${formatDuration(order)}`,
		planAmount: `${formatTaxCurrencyBaseUnits(order.quoteBaseAmountBaseUnits, order.decimals, taxCurrency)} ${taxNote}`,
		discountLabel: '割引',
		discount: '',
		discountAmount: discountAmount > 0n ? `-${formatTaxCurrencyBaseUnits(order.quoteDiscountBaseUnits, order.decimals, taxCurrency)} ${taxNote}` : '-',
		separator2: '---',
		totalLabel: '支払額',
		total: `${formatTaxCurrencyBaseUnits(order.taxIncludedAmountBaseUnits, order.decimals, taxCurrency)} ${taxNote}`,
		taxLabel: `${order.taxName}額`,
		taxRate,
		tax: formatTaxCurrencyBaseUnits(order.taxAmountBaseUnits, order.decimals, taxCurrency),
		paymentMethodTitle: '支払い方法',
		txLabel: 'トランザクションハッシュ',
		txHash: order.txHash ?? '-',
		paymentRailLabel: '決済手段',
		paymentRail: `${order.tokenSymbol} / ${order.chainName}`,
		paymentAmountLabel: '決済額',
		paymentAmount: formatAmount(order),
		sellerName: seller.name,
		sellerAddress: seller.address,
		registrationNumber: seller.invoiceRegistrationNumber,
	}];
}

export async function downloadReceiptPdf(receipt: Receipt): Promise<void> {
	const receiptFontUrl = new URL(receiptFontPath, window.location.origin).toString();
	const pdf = await generate({
		template,
		inputs: buildInputs(receipt),
		options: {
			font: {
				[receiptFontName]: {
					data: receiptFontUrl,
					fallback: true,
					subset: true,
				},
			},
		},
	});
	const blob = new Blob([pdf], { type: 'application/pdf' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `receipt-${receipt.order.id}.pdf`;
	a.click();
	URL.revokeObjectURL(url);
}

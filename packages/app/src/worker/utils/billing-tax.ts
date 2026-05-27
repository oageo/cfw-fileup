import { and, desc, eq, isNull } from 'drizzle-orm';
import { DEFAULT_APP_NAME } from '../../shared/app-settings';
import { appSettings, billingResidencyStatements } from '../scheme/index';
import { genEaidx } from '../../shared/eaid-x';
import { getDb } from './db';

const DEFAULT_JP_RESIDENCY_STATEMENT = '私は日本国内に住所または居所を有しており、日本在住者としてこの有料プランを購入します。';
const DEFAULT_TAX_CURRENCY = 'USD';

export type BillingTaxSnapshot = {
	taxName: string;
	taxRate: string;
	taxCurrency: string;
	taxIncludedAmountBaseUnits: string;
	taxExcludedAmountBaseUnits: string;
	taxAmountBaseUnits: string;
	taxStatementId: string;
};

export type BillingReceiptSeller = {
	name: string;
	address: string;
	invoiceRegistrationNumber: string;
};

async function getSettingMap(env: Env): Promise<Map<string, string>> {
	const rows = await getDb(env).select().from(appSettings);
	return new Map(rows.map(row => [row.key, row.value]));
}

function parseDecimalRatio(value: string): { numerator: bigint; denominator: bigint } | null {
	if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) return null;
	const [integer, fraction = ''] = value.split('.');
	const denominator = 10n ** BigInt(fraction.length);
	return {
		numerator: BigInt(integer) * denominator + BigInt(fraction || '0'),
		denominator,
	};
}

export function calculateIncludedTaxBaseUnits(totalBaseUnits: string, rateText: string): { excludedBaseUnits: string; taxBaseUnits: string } {
	const total = BigInt(totalBaseUnits);
	const rate = parseDecimalRatio(rateText);
	if (rate == null || rate.numerator < 0n) return { excludedBaseUnits: total.toString(), taxBaseUnits: '0' };
	const excluded = total * rate.denominator / (rate.denominator + rate.numerator);
	return {
		excludedBaseUnits: excluded.toString(),
		taxBaseUnits: (total - excluded).toString(),
	};
}

function normalizeTaxCurrency(currencyCode: string): string {
	const normalized = currencyCode.trim().toUpperCase();
	return /^[A-Z]{3}$/.test(normalized) ? normalized : DEFAULT_TAX_CURRENCY;
}

export async function getOrCreateActiveResidencyStatement(env: Env, country: string): Promise<typeof billingResidencyStatements.$inferSelect> {
	const db = getDb(env);
	const existing = await db
		.select()
		.from(billingResidencyStatements)
		.where(and(
			eq(billingResidencyStatements.country, country),
			eq(billingResidencyStatements.isEnabled, true),
			isNull(billingResidencyStatements.retiredAt),
		))
		.orderBy(desc(billingResidencyStatements.id))
		.get();
	if (existing) return existing;
	const now = Date.now();
	const statement = {
		id: genEaidx(now),
		country,
		statement: country === 'JP' ? DEFAULT_JP_RESIDENCY_STATEMENT : `I confirm that I am purchasing this paid plan as a resident of ${country}.`,
		isEnabled: true,
		createdAt: now,
		updatedAt: now,
		retiredAt: null,
	};
	await db.insert(billingResidencyStatements).values(statement);
	return statement;
}

export async function createBillingTaxSnapshot(env: Env, input: {
	country: string;
	amountBaseUnits: string;
	decimals: number;
	currencyCode: string;
}): Promise<BillingTaxSnapshot> {
	const settings = await getSettingMap(env);
	const taxName = settings.get('billing_tax_name') || '消費税';
	const taxRate = settings.get('billing_tax_rate') || '0.1';
	const statement = await getOrCreateActiveResidencyStatement(env, input.country);
	const tax = calculateIncludedTaxBaseUnits(input.amountBaseUnits, taxRate);
	return {
		taxName,
		taxRate,
		taxCurrency: normalizeTaxCurrency(input.currencyCode),
		taxIncludedAmountBaseUnits: input.amountBaseUnits,
		taxExcludedAmountBaseUnits: tax.excludedBaseUnits,
		taxAmountBaseUnits: tax.taxBaseUnits,
		taxStatementId: statement.id,
	};
}

export async function getBillingReceiptSeller(env: Env): Promise<BillingReceiptSeller> {
	const settings = await getSettingMap(env);
	return {
		name: settings.get('billing_seller_name') || settings.get('app_name') || DEFAULT_APP_NAME,
		address: settings.get('billing_seller_address') || '',
		invoiceRegistrationNumber: settings.get('billing_invoice_registration_number') || '',
	};
}

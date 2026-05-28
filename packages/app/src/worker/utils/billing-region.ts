import * as v from 'valibot';
import { DEFAULT_BILLING_REGION_RULES, billingRegionRulesSchema, type BillingRegionRules } from '../../shared/app-settings';
import { apiError } from './api-error';
import { getAppSettingCached } from './app-settings-cache';

export type CfRegionSnapshot = {
	country: string | null;
	isEUCountry: boolean | null;
	city: string | null;
	continent: string | null;
	latitude: string | null;
	longitude: string | null;
	postalCode: string | null;
	metroCode: string | null;
	region: string | null;
	regionCode: string | null;
	timezone: string | null;
};

type CfProperties = Record<string, unknown>;

const REGION_SNAPSHOT_KEYS = [
	'country',
	'isEUCountry',
	'city',
	'continent',
	'latitude',
	'longitude',
	'postalCode',
	'metroCode',
	'region',
	'regionCode',
	'timezone',
] as const;

function nullableString(value: unknown): string | null {
	if (value == null) return null;
	return String(value);
}

function upperNullableString(value: unknown): string | null {
	return nullableString(value)?.toUpperCase() ?? null;
}

function nullableBoolean(value: unknown): boolean | null {
	if (value === true || value === '1' || value === 'true') return true;
	if (value === false || value === '0' || value === 'false') return false;
	return null;
}

export function getCfRegionSnapshot(request: Request): CfRegionSnapshot | null {
	const cf = (request as Request & { cf?: CfProperties }).cf;
	if (cf == null) return null;
	return {
		country: upperNullableString(cf.country),
		isEUCountry: nullableBoolean(cf.isEUCountry),
		city: nullableString(cf.city),
		continent: upperNullableString(cf.continent),
		latitude: nullableString(cf.latitude),
		longitude: nullableString(cf.longitude),
		postalCode: nullableString(cf.postalCode),
		metroCode: nullableString(cf.metroCode),
		region: nullableString(cf.region),
		regionCode: nullableString(cf.regionCode),
		timezone: nullableString(cf.timezone),
	};
}

function parseBillingRegionRules(value: string): BillingRegionRules {
	return v.parse(billingRegionRulesSchema, JSON.parse(value));
}

export async function getBillingRegionRules(env: Env): Promise<BillingRegionRules> {
	return parseBillingRegionRules(await getAppSettingCached(env, 'billing_region_rules') ?? DEFAULT_BILLING_REGION_RULES);
}

function ruleMatches(rule: BillingRegionRules['rules'][number], snapshot: CfRegionSnapshot): boolean {
	if (rule.country != null && snapshot.country !== rule.country) return false;
	if (rule.regionCode != null && snapshot.regionCode !== rule.regionCode) return false;
	if (rule.continent != null && snapshot.continent !== rule.continent) return false;
	if (rule.isEUCountry != null && snapshot.isEUCountry !== rule.isEUCountry) return false;
	return true;
}

export function isBillingRegionAllowed(rules: BillingRegionRules, snapshot: CfRegionSnapshot): boolean {
	const matched = rules.rules.some(rule => ruleMatches(rule, snapshot));
	return rules.mode === 'allow' ? matched : !matched;
}

export async function assertBillingRegionAllowed(env: Env, request: Request): Promise<CfRegionSnapshot & { country: string }> {
	const snapshot = getCfRegionSnapshot(request);
	if (snapshot?.country == null) throw apiError(403, 'PAYMENT_REGION_NOT_ALLOWED');
	let rules: BillingRegionRules;
	try {
		rules = await getBillingRegionRules(env);
	} catch {
		throw apiError(403, 'PAYMENT_REGION_NOT_ALLOWED');
	}
	if (!isBillingRegionAllowed(rules, snapshot)) throw apiError(403, 'PAYMENT_REGION_NOT_ALLOWED');
	return snapshot as CfRegionSnapshot & { country: string };
}

export function stringifyCfRegionSnapshot(snapshot: CfRegionSnapshot): string {
	return JSON.stringify(Object.fromEntries(REGION_SNAPSHOT_KEYS.map(key => [key, snapshot[key]])));
}

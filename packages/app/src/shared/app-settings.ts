import * as v from 'valibot';
import { MAX_APP_SETTING_TEXT_LENGTH } from './const.js';

export const DEFAULT_APP_NAME = 'CFW FileUp';

/** 禁止ユーザー名のデフォルト値（カンマ区切り） */
export const DEFAULT_FORBIDDEN_USERNAMES =
	'admin,administrator,root,system,maintainer,host,mod,moderator,owner,superuser,staff,auth,i,me,everyone,all,example,user,users,account,accounts,official,help,helps,support,supports,info,information,informations,announce,announces,announcement,announcements,notice,notification,notifications,dev,developer,developers,tech,cloudflare,cf';

/** 禁止バケット名のデフォルト値（カンマ区切り） */
export const DEFAULT_FORBIDDEN_BUCKET_NAMES =
	'admin,administrator,root,system,maintainer,host,mod,moderator,owner,superuser,staff,auth,i,me,everyone,all,example,user,users,account,accounts,official,help,helps,support,supports,info,information,informations,announce,announces,announcement,announcements,notice,notification,notifications,dev,developer,developers,tech,cloudflare,cf';

export const DEFAULT_BILLING_REGION_RULES = '{"mode":"allow","rules":[{"country":"JP"}]}';
export const DEFAULT_BILLING_RESIDENCY_STATEMENT = '私は日本国内に住所または居所を有しており、日本在住者としてこの有料プランを購入します。';

export const registrationModeSchema = v.picklist(['closed', 'passphrase', 'open']);
export type RegistrationMode = v.InferOutput<typeof registrationModeSchema>;
export const optionalUrlSettingSchema = v.union([
	v.literal(''),
	v.pipe(v.string(), v.url(), v.maxLength(MAX_APP_SETTING_TEXT_LENGTH)),
]);
export const optionalDateSettingSchema = v.union([
	v.literal(''),
	v.pipe(v.string(), v.isoDate()),
]);
export const decimalStringSchema = v.pipe(v.string(), v.regex(/^(0|[1-9]\d*)(\.\d+)?$/));
export const regionRuleSchema = v.pipe(
	v.object({
		country: v.optional(v.pipe(v.string(), v.regex(/^[A-Z]{2}$/))),
		regionCode: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(20))),
		continent: v.optional(v.pipe(v.string(), v.regex(/^[A-Z]{2}$/))),
		isEUCountry: v.optional(v.boolean()),
	}),
	v.check(rule => (
		rule.country != null
		|| rule.regionCode != null
		|| rule.continent != null
		|| rule.isEUCountry != null
	), 'At least one region condition is required'),
);
export const billingRegionRulesSchema = v.object({
	mode: v.picklist(['allow', 'deny']),
	rules: v.pipe(v.array(regionRuleSchema), v.minLength(1)),
});
export type BillingRegionRules = v.InferOutput<typeof billingRegionRulesSchema>;
export const billingRegionRulesSettingSchema = v.pipe(
	v.string(),
	v.check((value) => {
		try {
			v.parse(billingRegionRulesSchema, JSON.parse(value));
			return true;
		} catch {
			return false;
		}
	}, 'Invalid billing region rules JSON'),
);

/**
 * app_settings テーブルで管理する設定項目。
 * キーが設定キー、値が valibot スキーマ（v.optional でデフォルト値も内包）。
 */
export const KNOWN_SETTINGS = {
	app_name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)), DEFAULT_APP_NAME),
	registration_mode: v.optional(registrationModeSchema, 'passphrase' satisfies RegistrationMode),
	google_required: v.optional(v.picklist(['true', 'false']), 'false'),
	terms_url: v.optional(optionalUrlSettingSchema, ''),
	terms_updated_at: v.optional(optionalDateSettingSchema, ''),
	privacy_policy_url: v.optional(optionalUrlSettingSchema, ''),
	plan_purchase_terms_url: v.optional(optionalUrlSettingSchema, ''),
	indieauth_blocked_servers: v.optional(v.pipe(v.string(), v.maxLength(MAX_APP_SETTING_TEXT_LENGTH)), ''),
	reject_mismatched_file_type: v.optional(v.picklist(['true', 'false']), 'false'),
	crypto_payments_enabled: v.optional(v.picklist(['true', 'false']), 'false'),
	billing_region_rules: v.optional(billingRegionRulesSettingSchema, DEFAULT_BILLING_REGION_RULES),
	billing_residency_statement: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_APP_SETTING_TEXT_LENGTH)), DEFAULT_BILLING_RESIDENCY_STATEMENT),
	billing_tax_name: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)), '消費税'),
	billing_tax_rate: v.optional(decimalStringSchema, '0.1'),
	billing_seller_name: v.optional(v.pipe(v.string(), v.maxLength(MAX_APP_SETTING_TEXT_LENGTH)), ''),
	billing_seller_address: v.optional(v.pipe(v.string(), v.maxLength(MAX_APP_SETTING_TEXT_LENGTH)), ''),
	billing_invoice_registration_number: v.optional(v.pipe(v.string(), v.maxLength(40)), ''),
	forbidden_usernames: v.optional(v.pipe(v.string(), v.maxLength(MAX_APP_SETTING_TEXT_LENGTH)), DEFAULT_FORBIDDEN_USERNAMES),
	forbidden_bucket_names: v.optional(v.pipe(v.string(), v.maxLength(MAX_APP_SETTING_TEXT_LENGTH)), DEFAULT_FORBIDDEN_BUCKET_NAMES),
} as const;

export type KnownSettingKey = keyof typeof KNOWN_SETTINGS;
export const KNOWN_SETTING_KEYS = Object.keys(KNOWN_SETTINGS) as KnownSettingKey[];
export const KnownSettingKeySchema = v.picklist(KNOWN_SETTING_KEYS);
export type KnownSettingRecord = {
	[K in KnownSettingKey]: {
		key: K;
		value: v.InferOutput<(typeof KNOWN_SETTINGS)[K]>;
	};
}[KnownSettingKey];

function isOptionalSettingSchema(
	schema: v.GenericSchema,
): schema is v.OptionalSchema<v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>, unknown> {
	return (schema as { type?: string }).type === 'optional';
}

function unwrapSettingSchema<TSchema extends v.GenericSchema>(schema: TSchema) {
	return isOptionalSettingSchema(schema) ? v.unwrap(schema) : schema;
}

const knownSettingVariantOptions = Object.entries(KNOWN_SETTINGS).map(([key, schema]) => v.object({
	key: v.literal(key),
	value: unwrapSettingSchema(schema),
})) as unknown as v.VariantOptions<'key'>;

export const KnownSettingRecordSchema = v.variant('key', knownSettingVariantOptions) as v.GenericSchema<unknown, KnownSettingRecord>;
export const KnownSettingListSchema = v.array(KnownSettingRecordSchema);

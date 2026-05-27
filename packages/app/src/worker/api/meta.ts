import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { appSettings, paymentChains } from '../scheme/index';
import { getDb } from '../utils/db';
import { shortGetCache } from '../middleware/short-get-cache';
import { canAcceptCryptoPayments } from '../utils/crypto-payments';
import { getPaymentChainRpcUrl } from '../utils/payment-rpc';
import { getAppName } from '../utils/app-name';
import { DEFAULT_APP_NAME } from '../../shared/app-settings';

const app = new Hono<{ Bindings: Env }>();

type MetaResponse = {
	appName: string;
	registrationEnabled: boolean;
	passphraseRequired: boolean;
	termsUrl: string;
	termsUpdatedAt: string;
	privacyPolicyUrl: string;
	planPurchaseTermsUrl: string;
	turnstileEnabled: boolean;
	turnstileSiteKey: string;
	googleAuthEnabled: boolean;
	googleRequired: boolean;
	indieAuthEnabled: boolean;
	cryptoPaymentsEnabled: boolean;
	reownProjectId: string;
	walletConnectChainIds: number[];
};

function createMetaResponse(data: MetaResponse): Response {
	return new Response(JSON.stringify(data), {
		headers: {
			'Content-Type': 'application/json; charset=UTF-8',
		},
	});
}

app.use('/meta', shortGetCache({ maxAgeSeconds: 10 }));

app.get('/meta', async (c) => {
	const db = getDb(c.env);

	try {
		const appName = await getAppName(c.env);
		const registrationModeSetting = await db
			.select()
			.from(appSettings)
			.where(eq(appSettings.key, 'registration_mode'))
			.get();

		const mode = registrationModeSetting?.value ?? 'passphrase';

		const googleRequiredSetting = await db
			.select()
			.from(appSettings)
			.where(eq(appSettings.key, 'google_required'))
			.get();

		const googleRequired = googleRequiredSetting?.value === 'true';
		const googleAuthEnabled = (c.env.GOOGLE_CLIENT_ID as string) !== '' && (c.env.GOOGLE_CLIENT_SECRET as string) !== '';
		const termsUrlSetting = await db
			.select()
			.from(appSettings)
			.where(eq(appSettings.key, 'terms_url'))
			.get();
		const termsUpdatedAtSetting = await db
			.select()
			.from(appSettings)
			.where(eq(appSettings.key, 'terms_updated_at'))
			.get();
		const privacyPolicyUrlSetting = await db
			.select()
			.from(appSettings)
			.where(eq(appSettings.key, 'privacy_policy_url'))
			.get();
		const planPurchaseTermsUrlSetting = await db
			.select()
			.from(appSettings)
			.where(eq(appSettings.key, 'plan_purchase_terms_url'))
			.get();
		const cryptoPaymentsEnabled = await canAcceptCryptoPayments(c.env);
		const walletConnectChains = cryptoPaymentsEnabled
			? await db
				.select({ chainId: paymentChains.chainId })
				.from(paymentChains)
				.where(eq(paymentChains.isEnabled, true))
			: [];

		return createMetaResponse({
			appName,
			registrationEnabled: mode !== 'closed',
			passphraseRequired: mode === 'passphrase',
			termsUrl: termsUrlSetting?.value ?? '',
			termsUpdatedAt: termsUpdatedAtSetting?.value ?? '',
			privacyPolicyUrl: privacyPolicyUrlSetting?.value ?? '',
			planPurchaseTermsUrl: planPurchaseTermsUrlSetting?.value ?? '',
			turnstileEnabled: (c.env.TURNSTILE_SECRET as string) !== '',
			turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
			googleAuthEnabled,
			googleRequired,
			indieAuthEnabled: true,
			cryptoPaymentsEnabled,
			reownProjectId: c.env.REOWN_PROJECT_ID ?? '',
			walletConnectChainIds: walletConnectChains
				.map(chain => chain.chainId)
				.filter(chainId => getPaymentChainRpcUrl(c.env, chainId) !== null),
		});
	} catch {
		return createMetaResponse({
			appName: DEFAULT_APP_NAME,
			registrationEnabled: true,
			passphraseRequired: true,
			termsUrl: '',
			termsUpdatedAt: '',
			privacyPolicyUrl: '',
			planPurchaseTermsUrl: '',
			turnstileEnabled: false,
			turnstileSiteKey: '',
			googleAuthEnabled: false,
			googleRequired: false,
			indieAuthEnabled: true,
			cryptoPaymentsEnabled: false,
			reownProjectId: '',
			walletConnectChainIds: [],
		});
	}
});

export const metaRoutes = app;

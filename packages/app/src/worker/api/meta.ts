import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { appSettings, paymentChains } from '../scheme/index';
import { getDb } from '../utils/db';
import { shortGetCache } from '../middleware/short-get-cache';
import { canAcceptCryptoPayments } from '../utils/crypto-payments';
import { getPaymentChainRpcUrl } from '../utils/payment-rpc';

const app = new Hono<{ Bindings: Env }>();

type MetaResponse = {
	registrationEnabled: boolean;
	passphraseRequired: boolean;
	termsUrl: string;
	termsUpdatedAt: string;
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
		const cryptoPaymentsEnabled = await canAcceptCryptoPayments(c.env);
		const walletConnectChains = cryptoPaymentsEnabled
			? await db
				.select({ chainId: paymentChains.chainId })
				.from(paymentChains)
				.where(eq(paymentChains.isEnabled, true))
			: [];

		return createMetaResponse({
			registrationEnabled: mode !== 'closed',
			passphraseRequired: mode === 'passphrase',
			termsUrl: termsUrlSetting?.value ?? '',
			termsUpdatedAt: termsUpdatedAtSetting?.value ?? '',
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
			registrationEnabled: true,
			passphraseRequired: true,
			termsUrl: '',
			termsUpdatedAt: '',
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

import { Hono } from 'hono';
import { describeResponse, describeRoute, validator } from 'hono-openapi';
import { and, asc, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { apiDef, getResponseDefWithAuth, type JsonCtx } from '../../shared/api';
import { addPaymentDuration, calculatePaymentQuote, evaluateDealDisplayEligibility, type PaymentDurationUnit, type PaymentQuote, type PaymentQuoteCurrentPlan, type PriceHistoryPeriod } from '../../shared/billing-quote';
import { authMiddleware } from '../middleware/auth';
import { cryptoPaymentOrders, paymentAssetDeployments, paymentAssetPlanPricePeriods, paymentAssetPlanPrices, paymentAssets, paymentChains, plans, userPlanAssignments, userWallets } from '../scheme/index';
import { checkCryptoPaymentOrder, confirmCryptoPaymentOrder, getCryptoPaymentOrderExpiresAt, markZeroAmountCryptoPaymentOrderPaid } from '../utils/billing';
import { apiError } from '../utils/api-error';
import { canAcceptCryptoPayments } from '../utils/crypto-payments';
import { getDb } from '../utils/db';
import { recordModerationEvent } from '../utils/moderation';
import { omitResAndReq } from '../utils/omit';
import { idPage, pageParams } from '../utils/pagination';
import { isPaymentChainRpcConfigured } from '../utils/payment-rpc';
import { genEaidx } from '../../shared/eaid-x';

const app = new Hono<{ Bindings: Env }>();
const QUOTE_TTL_MS = 15 * 60 * 1000;

app.use(authMiddleware);

async function createPaymentOfferQuote(env: Env, userId: string, offer: {
	assetId: string;
	planId: string;
	planName: string;
	planSortOrder: number;
	amountBaseUnits: string;
	durationDays: number;
	durationUnit: PaymentDurationUnit;
}, quoteCreatedAt: number): Promise<PaymentQuote> {
	const db = getDb(env);
	const assignmentRows = await db
		.select({
			planId: userPlanAssignments.planId,
			startsAt: userPlanAssignments.startsAt,
			expiresAt: userPlanAssignments.expiresAt,
			priceAssetId: userPlanAssignments.priceAssetId,
			priceAmountBaseUnits: userPlanAssignments.priceAmountBaseUnits,
			priceDurationDays: userPlanAssignments.priceDurationDays,
			priceDurationUnit: userPlanAssignments.priceDurationUnit,
			planName: plans.name,
			planSortOrder: plans.sortOrder,
		})
		.from(userPlanAssignments)
		.innerJoin(plans, eq(userPlanAssignments.planId, plans.id))
		.where(and(
			eq(userPlanAssignments.userId, userId),
			gt(userPlanAssignments.expiresAt, quoteCreatedAt),
		))
		.orderBy(asc(userPlanAssignments.startsAt), desc(plans.sortOrder), desc(userPlanAssignments.expiresAt));
	const activeAssignment = assignmentRows
		.filter(assignment => assignment.startsAt <= quoteCreatedAt && assignment.expiresAt > quoteCreatedAt)
		.sort((a, b) => b.planSortOrder - a.planSortOrder || b.expiresAt - a.expiresAt)[0] ?? null;
	const activeUpgradeBase = activeAssignment && offer.planSortOrder > activeAssignment.planSortOrder
		? activeAssignment
		: null;
	const futureUpgradeBase = assignmentRows
		.filter(assignment => assignment.startsAt > quoteCreatedAt && assignment.planSortOrder < offer.planSortOrder)
		.sort((a, b) => a.startsAt - b.startsAt || a.planSortOrder - b.planSortOrder || b.expiresAt - a.expiresAt)[0] ?? null;
	const futureSamePlanTail = assignmentRows
		.filter(assignment => assignment.planId === offer.planId && assignment.startsAt > quoteCreatedAt)
		.sort((a, b) => b.expiresAt - a.expiresAt || b.startsAt - a.startsAt)[0] ?? null;
	const higherPlanTail = assignmentRows
		.filter(assignment => assignment.planSortOrder > offer.planSortOrder)
		.sort((a, b) => b.expiresAt - a.expiresAt || b.startsAt - a.startsAt)[0] ?? null;
	const scheduleTail = [futureSamePlanTail, higherPlanTail]
		.filter(assignment => assignment != null)
		.sort((a, b) => b.expiresAt - a.expiresAt || b.startsAt - a.startsAt)[0] ?? null;
	const referenceAssignment = activeUpgradeBase ?? futureUpgradeBase ?? scheduleTail ?? activeAssignment;
	const referencePlan = referenceAssignment
		? await toPaymentQuoteCurrentPlan(env, offer, referenceAssignment, quoteCreatedAt)
		: null;
	const upgradeBaseAt = referencePlan && referencePlan.id !== offer.planId && referencePlan.sortOrder < offer.planSortOrder
		? Math.max(quoteCreatedAt, referencePlan.startsAt ?? quoteCreatedAt)
		: null;
	const upgradeExpiresAt = upgradeBaseAt == null
		? null
		: addPaymentDuration(upgradeBaseAt, offer.durationDays, offer.durationUnit);
	const currentPlans = upgradeBaseAt == null || upgradeExpiresAt == null
		? undefined
		: (await Promise.all(
			assignmentRows
				.filter(assignment => (
					assignment.planSortOrder < offer.planSortOrder
					&& assignment.expiresAt > upgradeBaseAt
					&& assignment.startsAt < upgradeExpiresAt
				))
				.sort((a, b) => a.startsAt - b.startsAt || a.expiresAt - b.expiresAt)
				.map(assignment => toPaymentQuoteCurrentPlan(env, offer, assignment, quoteCreatedAt)),
		)).filter(plan => plan != null);
	return calculatePaymentQuote({
		quoteCreatedAt,
		quoteTtlMs: QUOTE_TTL_MS,
		targetPlanId: offer.planId,
		targetPlanSortOrder: offer.planSortOrder,
		targetPlanPrice: {
			amountBaseUnits: offer.amountBaseUnits,
			durationDays: offer.durationDays,
			durationUnit: offer.durationUnit,
		},
		currentPlan: referencePlan,
		currentPlans,
	});
}

async function toPaymentQuoteCurrentPlan(env: Env, offer: {
	assetId: string;
	planId: string;
	amountBaseUnits: string;
	durationDays: number;
	durationUnit: PaymentDurationUnit;
}, assignment: {
	planId: string;
	startsAt: number;
	expiresAt: number;
	priceAssetId: string;
	priceAmountBaseUnits: string;
	priceDurationDays: number;
	priceDurationUnit: PaymentDurationUnit;
	planName: string;
	planSortOrder: number;
}, quoteCreatedAt: number): Promise<PaymentQuoteCurrentPlan | null> {
	const assignmentPrice = assignment.priceAssetId === offer.assetId
		? {
			amountBaseUnits: assignment.priceAmountBaseUnits,
			durationDays: assignment.priceDurationDays,
			durationUnit: assignment.priceDurationUnit,
		}
		: null;
	const currentPlanPrice = assignment.planId !== offer.planId && assignmentPrice == null
		? await getReferencePlanPrice(env, offer.assetId, assignment.planId, quoteCreatedAt)
		: null;
	const price = assignment.planId === offer.planId
		? assignmentPrice ?? {
			amountBaseUnits: offer.amountBaseUnits,
			durationDays: offer.durationDays,
			durationUnit: offer.durationUnit,
		}
		: assignmentPrice ?? currentPlanPrice;
	if (price == null) return null;
	return {
		id: assignment.planId,
		name: assignment.planName,
		sortOrder: assignment.planSortOrder,
		startsAt: assignment.startsAt,
		expiresAt: assignment.expiresAt,
		price,
	};
}

async function getReferencePlanPrice(env: Env, assetId: string, planId: string, quoteCreatedAt: number) {
	const currentPlanPrices = await getDb(env)
		.select({
			amountBaseUnits: paymentAssetPlanPrices.amountBaseUnits,
			durationDays: paymentAssetPlanPrices.durationDays,
			durationUnit: paymentAssetPlanPrices.durationUnit,
			expiresAt: paymentAssetPlanPrices.expiresAt,
			createdAt: paymentAssetPlanPrices.createdAt,
		})
		.from(paymentAssetPlanPrices)
		.where(and(
			eq(paymentAssetPlanPrices.assetId, assetId),
			eq(paymentAssetPlanPrices.planId, planId),
		));
	const activePrices = currentPlanPrices.filter(price => price.expiresAt == null || price.expiresAt > quoteCreatedAt);
	const price = (activePrices.length > 0 ? activePrices : currentPlanPrices)
		.sort((a, b) => (b.expiresAt ?? Number.MAX_SAFE_INTEGER) - (a.expiresAt ?? Number.MAX_SAFE_INTEGER) || b.createdAt - a.createdAt)[0];
	return price ? {
		amountBaseUnits: price.amountBaseUnits,
		durationDays: price.durationDays,
		durationUnit: price.durationUnit,
	} : null;
}

async function listEnabledOffers(env: Env, userId: string, quoteCreatedAt = Date.now()) {
	const db = getDb(env);
	const historyPeriods = await listPriceHistoryPeriods(env);
	const rows = await db
		.select({
			id: paymentAssetPlanPrices.id,
			deploymentId: paymentAssetDeployments.id,
			assetId: paymentAssets.id,
			assetSymbol: paymentAssets.symbol,
			assetName: paymentAssets.name,
			tokenSymbol: paymentAssetDeployments.tokenSymbol,
			tokenName: paymentAssetDeployments.tokenName,
			chainId: paymentChains.chainId,
			chainName: paymentChains.name,
			confirmationsRequired: paymentChains.confirmationsRequired,
			contractAddress: paymentAssetDeployments.contractAddress,
			recipientAddress: paymentAssetDeployments.recipientAddress,
			decimals: paymentAssetDeployments.decimals,
			planId: plans.id,
			planName: plans.name,
			planMaxBuckets: plans.maxBuckets,
			planMaxBucketSizeBytes: plans.maxBucketSizeBytes,
			planMaxFilesPerBucket: plans.maxFilesPerBucket,
			planMaxDailyUploads: plans.maxDailyUploads,
			planCanUseDownloadCount: plans.canUseDownloadCount,
			planSortOrder: plans.sortOrder,
			amountBaseUnits: paymentAssetPlanPrices.amountBaseUnits,
			durationDays: paymentAssetPlanPrices.durationDays,
			durationUnit: paymentAssetPlanPrices.durationUnit,
			isEnabled: paymentAssetPlanPrices.isEnabled,
			expiresAt: paymentAssetPlanPrices.expiresAt,
			createdAt: paymentAssetPlanPrices.createdAt,
			updatedAt: paymentAssetPlanPrices.updatedAt,
		})
		.from(paymentAssetPlanPrices)
		.innerJoin(paymentAssets, eq(paymentAssetPlanPrices.assetId, paymentAssets.id))
		.innerJoin(paymentAssetDeployments, eq(paymentAssetDeployments.assetId, paymentAssets.id))
		.innerJoin(paymentChains, eq(paymentAssetDeployments.chainId, paymentChains.chainId))
		.innerJoin(plans, eq(paymentAssetPlanPrices.planId, plans.id))
		.where(and(
			eq(paymentAssetPlanPrices.isEnabled, true),
			eq(paymentAssetDeployments.isEnabled, true),
			eq(paymentAssets.isEnabled, true),
			eq(paymentChains.isEnabled, true),
			eq(plans.isEnabled, true),
			or(isNull(paymentAssetPlanPrices.expiresAt), gt(paymentAssetPlanPrices.expiresAt, Date.now())),
		))
		.orderBy(
			asc(plans.sortOrder),
			asc(plans.createdAt),
			asc(plans.id),
			asc(paymentAssetPlanPrices.durationUnit),
			asc(paymentAssetPlanPrices.durationDays),
			asc(paymentAssetPlanPrices.amountBaseUnits),
			desc(paymentAssetPlanPrices.id),
		);

	const displayRows = filterDisplayPriceRows(rows);

	return await Promise.all(displayRows.map(async row => {
		const relatedHistory = historyPeriods.filter(period => (
			period.assetId === row.assetId
			&& period.planId === row.planId
			&& period.durationDays === row.durationDays
			&& period.durationUnit === row.durationUnit
		));
		const fallbackHistory: PriceHistoryPeriod = {
			id: row.id,
			priceId: row.id,
			assetId: row.assetId,
			planId: row.planId,
			amountBaseUnits: row.amountBaseUnits,
			durationDays: row.durationDays,
			durationUnit: row.durationUnit,
			isEnabled: row.isEnabled,
			startsAt: row.createdAt,
			expiresAt: row.expiresAt,
			createdAt: row.createdAt,
		};
		return {
			id: row.id,
			deploymentId: row.deploymentId,
			assetId: row.assetId,
			assetSymbol: row.assetSymbol,
			assetName: row.assetName,
			tokenSymbol: row.tokenSymbol,
			tokenName: row.tokenName,
			chainId: row.chainId,
			chainName: row.chainName,
			confirmationsRequired: row.confirmationsRequired,
			contractAddress: row.contractAddress,
			recipientAddress: row.recipientAddress,
			decimals: row.decimals,
			plan: {
				id: row.planId,
				name: row.planName,
				maxBuckets: row.planMaxBuckets,
				maxBucketSizeBytes: row.planMaxBucketSizeBytes,
				maxFilesPerBucket: row.planMaxFilesPerBucket,
				maxDailyUploads: row.planMaxDailyUploads,
				canUseDownloadCount: row.planCanUseDownloadCount,
				sortOrder: row.planSortOrder,
			},
			amountBaseUnits: row.amountBaseUnits,
			durationDays: row.durationDays,
			durationUnit: row.durationUnit,
			isEnabled: row.isEnabled,
			expiresAt: row.expiresAt,
			isRpcConfigured: isPaymentChainRpcConfigured(env, row.chainId),
			quote: await createPaymentOfferQuote(env, userId, {
				assetId: row.assetId,
				planId: row.planId,
				planName: row.planName,
				planSortOrder: row.planSortOrder,
				amountBaseUnits: row.amountBaseUnits,
				durationDays: row.durationDays,
				durationUnit: row.durationUnit,
			}, quoteCreatedAt),
			dealDisplay: evaluateDealDisplayEligibility(relatedHistory.length > 0 ? relatedHistory : [fallbackHistory], {
				assetId: row.assetId,
				planId: row.planId,
				amountBaseUnits: row.amountBaseUnits,
				durationDays: row.durationDays,
				durationUnit: row.durationUnit,
			}, quoteCreatedAt),
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}));
}

function filterDisplayPriceRows<PriceRow extends {
	assetId: string;
	planId: string;
	deploymentId: string;
	durationDays: number;
	durationUnit: PaymentDurationUnit;
	expiresAt: number | null;
}>(rows: PriceRow[]): PriceRow[] {
	const limitedPriceKeys = new Set(rows
		.filter(row => row.expiresAt != null)
		.map(row => displayPriceKey(row)));
	return rows.filter(row => row.expiresAt != null || !limitedPriceKeys.has(displayPriceKey(row)));
}

function displayPriceKey(row: {
	assetId: string;
	planId: string;
	deploymentId: string;
	durationDays: number;
	durationUnit: PaymentDurationUnit;
}): string {
	return `${row.assetId}:${row.planId}:${row.deploymentId}:${row.durationDays}:${row.durationUnit}`;
}

async function listPriceHistoryPeriods(env: Env): Promise<PriceHistoryPeriod[]> {
	return (await getDb(env)
		.select()
		.from(paymentAssetPlanPricePeriods)
		.orderBy(
			asc(paymentAssetPlanPricePeriods.assetId),
			asc(paymentAssetPlanPricePeriods.planId),
			asc(paymentAssetPlanPricePeriods.durationDays),
			asc(paymentAssetPlanPricePeriods.durationUnit),
			asc(paymentAssetPlanPricePeriods.startsAt),
			asc(paymentAssetPlanPricePeriods.id),
		)).map(period => ({
		id: period.id,
		priceId: period.priceId,
		assetId: period.assetId,
		planId: period.planId,
		amountBaseUnits: period.amountBaseUnits,
		durationDays: period.durationDays,
		durationUnit: period.durationUnit,
		isEnabled: period.isEnabled,
		startsAt: period.startsAt,
		expiresAt: period.expiresAt,
		createdAt: period.createdAt,
	}));
}

app.post(
	'/list-crypto-offers',
	describeRoute(omitResAndReq(apiDef['/api/billing/list-crypto-offers'])),
	validator('json', apiDef['/api/billing/list-crypto-offers'].req),
	describeResponse(async (c: JsonCtx<'/api/billing/list-crypto-offers', Env>) => {
		if (!await canAcceptCryptoPayments(c.env)) return c.json([], 200);
		return c.json(await listEnabledOffers(c.env, c.get('user').id), 200);
	}, getResponseDefWithAuth('/api/billing/list-crypto-offers')),
);

app.post(
	'/create-crypto-order',
	describeRoute(omitResAndReq(apiDef['/api/billing/create-crypto-order'])),
	validator('json', apiDef['/api/billing/create-crypto-order'].req),
	describeResponse(async (c: JsonCtx<'/api/billing/create-crypto-order', Env>) => {
		if (!await canAcceptCryptoPayments(c.env)) throw apiError(403, 'FORBIDDEN');
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');
		const wallet = await db
			.select({ id: userWallets.id, chainId: userWallets.chainId, address: userWallets.address })
			.from(userWallets)
			.where(and(eq(userWallets.id, body.payerWalletId), eq(userWallets.userId, user.id)))
			.get();
		if (!wallet) throw apiError(400, 'WALLET_NOT_FOUND');

		const price = await db
			.select({
				priceId: paymentAssetPlanPrices.id,
				deploymentId: paymentAssetDeployments.id,
				planId: plans.id,
				assetId: paymentAssets.id,
				chainId: paymentChains.chainId,
				chainName: paymentChains.name,
				assetSymbol: paymentAssets.symbol,
				assetName: paymentAssets.name,
				tokenSymbol: paymentAssetDeployments.tokenSymbol,
				tokenName: paymentAssetDeployments.tokenName,
				contractAddress: paymentAssetDeployments.contractAddress,
				recipientAddress: paymentAssetDeployments.recipientAddress,
				amountBaseUnits: paymentAssetPlanPrices.amountBaseUnits,
				decimals: paymentAssetDeployments.decimals,
				durationDays: paymentAssetPlanPrices.durationDays,
				durationUnit: paymentAssetPlanPrices.durationUnit,
				expiresAt: paymentAssetPlanPrices.expiresAt,
				planName: plans.name,
				planSortOrder: plans.sortOrder,
			})
			.from(paymentAssetPlanPrices)
			.innerJoin(paymentAssets, eq(paymentAssetPlanPrices.assetId, paymentAssets.id))
			.innerJoin(paymentAssetDeployments, eq(paymentAssetDeployments.assetId, paymentAssets.id))
			.innerJoin(paymentChains, eq(paymentAssetDeployments.chainId, paymentChains.chainId))
			.innerJoin(plans, eq(paymentAssetPlanPrices.planId, plans.id))
			.where(and(
				eq(paymentAssetPlanPrices.id, body.priceId),
				eq(paymentAssetDeployments.id, body.deploymentId),
				eq(paymentAssetDeployments.chainId, wallet.chainId),
				eq(paymentAssetPlanPrices.isEnabled, true),
				eq(paymentAssetDeployments.isEnabled, true),
				eq(paymentAssets.isEnabled, true),
				eq(paymentChains.isEnabled, true),
				eq(plans.isEnabled, true),
				or(isNull(paymentAssetPlanPrices.expiresAt), gt(paymentAssetPlanPrices.expiresAt, Date.now())),
			))
			.get();
		if (!price) throw apiError(404, 'PAYMENT_PRICE_NOT_FOUND');
		if (wallet.chainId !== price.chainId) throw apiError(400, 'WALLET_NOT_FOUND');
		if (!isPaymentChainRpcConfigured(c.env, price.chainId)) throw apiError(400, 'PAYMENT_CHAIN_RPC_NOT_CONFIGURED');

		const now = Date.now();
		if (body.quoteCreatedAt > now + 60_000 || now - body.quoteCreatedAt > QUOTE_TTL_MS) {
			throw apiError(400, 'PAYMENT_QUOTE_EXPIRED');
		}
		const quote = await createPaymentOfferQuote(c.env, user.id, {
			assetId: price.assetId,
			planId: price.planId,
			planName: price.planName,
			planSortOrder: price.planSortOrder,
			amountBaseUnits: price.amountBaseUnits,
			durationDays: price.durationDays,
			durationUnit: price.durationUnit,
		}, body.quoteCreatedAt);
		if (quote.payableAmountBaseUnits !== body.quotedAmountBaseUnits) {
			throw apiError(400, 'PAYMENT_QUOTE_INVALID');
		}
		if (BigInt(quote.payableAmountBaseUnits) < 0n) {
			throw apiError(400, 'PAYMENT_QUOTE_INVALID');
		}
		const order = {
			id: genEaidx(now),
			userId: user.id,
			payerWalletId: wallet.id,
			payerAddress: wallet.address,
			priceId: price.priceId,
			deploymentId: price.deploymentId,
			planId: price.planId,
			assetId: price.assetId,
			chainId: price.chainId,
			chainName: price.chainName,
			assetSymbol: price.tokenSymbol,
			assetName: price.tokenName,
			planName: price.planName,
			contractAddress: price.contractAddress,
			recipientAddress: price.recipientAddress,
			amountBaseUnits: quote.payableAmountBaseUnits,
			decimals: price.decimals,
			durationDays: price.durationDays,
			durationUnit: price.durationUnit,
			quoteCreatedAt: quote.quoteCreatedAt,
			quoteExpiresAt: quote.quoteExpiresAt,
			quoteBaseAmountBaseUnits: quote.baseAmountBaseUnits,
			quoteDiscountBaseUnits: quote.discountBaseUnits,
			quoteEffectiveStartsAt: quote.effectiveStartsAt,
			quoteEffectiveExpiresAt: quote.effectiveExpiresAt,
			quoteCurrentPlanId: quote.currentPlan?.id ?? null,
			quoteCurrentPlanName: quote.currentPlan?.name ?? null,
			quoteCurrentPlanExpiresAt: quote.currentPlan?.expiresAt ?? null,
			quoteCurrentPlanPriceAmountBaseUnits: quote.currentPlan?.priceAmountBaseUnits ?? null,
			quoteCurrentPlanPriceDurationDays: quote.currentPlan?.priceDurationDays ?? null,
			quoteCurrentPlanPriceDurationUnit: quote.currentPlan?.priceDurationUnit ?? null,
			status: 'pending' as const,
			txHash: null,
			createdAt: now,
			updatedAt: now,
			expiresAt: getCryptoPaymentOrderExpiresAt(now),
			paidAt: null,
		};
		await db.insert(cryptoPaymentOrders).values(order);
		if (BigInt(order.amountBaseUnits) === 0n) {
			const paidOrder = await markZeroAmountCryptoPaymentOrderPaid(c.env, user.id, order.id, now);
			await recordModerationEvent(c, 'crypto_payment_order_confirmed', { orderId: paidOrder.id, chainId: paidOrder.chainId, txHash: paidOrder.txHash }, user.id, user.tokenId);
			return c.json(paidOrder, 200);
		}
		return c.json(order, 200);
	}, getResponseDefWithAuth('/api/billing/create-crypto-order')),
);

app.post(
	'/confirm-crypto-order',
	describeRoute(omitResAndReq(apiDef['/api/billing/confirm-crypto-order'])),
	validator('json', apiDef['/api/billing/confirm-crypto-order'].req),
	describeResponse(async (c: JsonCtx<'/api/billing/confirm-crypto-order', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');
		const before = await db
			.select({ status: cryptoPaymentOrders.status })
			.from(cryptoPaymentOrders)
			.where(and(eq(cryptoPaymentOrders.id, body.orderId), eq(cryptoPaymentOrders.userId, user.id)))
			.get();
		const order = await confirmCryptoPaymentOrder(c.env, user.id, body.orderId, body.txHash);
		if (before?.status !== 'paid' && order.status === 'paid') await recordModerationEvent(c, 'crypto_payment_order_confirmed', { orderId: order.id, chainId: order.chainId, txHash: order.txHash }, user.id, user.tokenId);
		return c.json(order, 200);
	}, getResponseDefWithAuth('/api/billing/confirm-crypto-order')),
);

app.post(
	'/check-crypto-order',
	describeRoute(omitResAndReq(apiDef['/api/billing/check-crypto-order'])),
	validator('json', apiDef['/api/billing/check-crypto-order'].req),
	describeResponse(async (c: JsonCtx<'/api/billing/check-crypto-order', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');
		const before = await db
			.select({ status: cryptoPaymentOrders.status })
			.from(cryptoPaymentOrders)
			.where(and(eq(cryptoPaymentOrders.id, body.orderId), eq(cryptoPaymentOrders.userId, user.id)))
			.get();
		const order = await checkCryptoPaymentOrder(c.env, user.id, body.orderId);
		if (before?.status !== 'paid' && order.status === 'paid') await recordModerationEvent(c, 'crypto_payment_order_confirmed', { orderId: order.id, chainId: order.chainId, txHash: order.txHash }, user.id, user.tokenId);
		return c.json(order, 200);
	}, getResponseDefWithAuth('/api/billing/check-crypto-order')),
);

app.post(
	'/cancel-crypto-order',
	describeRoute(omitResAndReq(apiDef['/api/billing/cancel-crypto-order'])),
	validator('json', apiDef['/api/billing/cancel-crypto-order'].req),
	describeResponse(async (c: JsonCtx<'/api/billing/cancel-crypto-order', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const body = c.req.valid('json');
		const deleted = await db
			.delete(cryptoPaymentOrders)
			.where(and(
				eq(cryptoPaymentOrders.id, body.orderId),
				eq(cryptoPaymentOrders.userId, user.id),
				eq(cryptoPaymentOrders.status, 'pending'),
				isNull(cryptoPaymentOrders.txHash),
			))
			.returning({ id: cryptoPaymentOrders.id });
		if (deleted.length === 0) throw apiError(404, 'PAYMENT_ORDER_NOT_FOUND');
		return c.json({ ok: true }, 200);
	}, getResponseDefWithAuth('/api/billing/cancel-crypto-order')),
);

app.post(
	'/list-my-payments',
	describeRoute(omitResAndReq(apiDef['/api/billing/list-my-payments'])),
	validator('json', apiDef['/api/billing/list-my-payments'].req),
	describeResponse(async (c: JsonCtx<'/api/billing/list-my-payments', Env>) => {
		const db = getDb(c.env);
		const user = c.get('user');
		const { limit, cursor } = pageParams(c.req.valid('json'));
		const rows = await db
			.select()
			.from(cryptoPaymentOrders)
			.where(cursor
				? and(eq(cryptoPaymentOrders.userId, user.id), lt(cryptoPaymentOrders.id, cursor))
				: eq(cryptoPaymentOrders.userId, user.id))
			.orderBy(desc(cryptoPaymentOrders.id))
			.limit(limit + 1);
		return c.json(idPage(rows, limit, row => row), 200);
	}, getResponseDefWithAuth('/api/billing/list-my-payments')),
);

export const billingRoutes = app;

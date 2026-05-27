import { and, desc, eq, ne } from 'drizzle-orm';
import { createPublicClient, decodeEventLog, http, isAddress, parseAbiItem, TransactionReceiptNotFoundError, type Hex, type TransactionReceipt } from 'viem';
import { addPaymentDuration } from '../../shared/billing-quote';
import { genEaidx } from '../../shared/eaid-x';
import { cryptoPaymentOrders, paymentChains, userPlanAssignments } from '../scheme/index';
import { ApiError, apiError } from './api-error';
import { getDb } from './db';
import { getPaymentChainRpcUrl, normalizeEthAddress } from './payment-rpc';
import { refreshEffectiveQuotaForUser } from './rate-limit';

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const ORDER_TTL_MS = 30 * 60 * 1000;
const TX_TIMESTAMP_TOLERANCE_MS = 2_000;

type OrderForConfirmation = typeof cryptoPaymentOrders.$inferSelect;
type PaymentVerificationResult = 'confirmed' | 'pending';

export function getCryptoPaymentOrderExpiresAt(now = Date.now()): number {
	return now + ORDER_TTL_MS;
}

export async function confirmCryptoPaymentOrder(env: Env, userId: string, orderId: string, txHash: string): Promise<typeof cryptoPaymentOrders.$inferSelect> {
	const db = getDb(env);
	const now = Date.now();
	const order = await db
		.select()
		.from(cryptoPaymentOrders)
		.where(and(eq(cryptoPaymentOrders.id, orderId), eq(cryptoPaymentOrders.userId, userId)))
		.get();

	if (!order) throw apiError(404, 'PAYMENT_ORDER_NOT_FOUND');
	if (order.status === 'paid') return order;
	if (order.status !== 'pending') {
		throw apiError(400, 'PAYMENT_ORDER_EXPIRED');
	}
	if (order.expiresAt <= now) {
		await db
			.update(cryptoPaymentOrders)
			.set({ status: 'expired', updatedAt: now })
			.where(and(eq(cryptoPaymentOrders.id, order.id), eq(cryptoPaymentOrders.status, 'pending')));
		throw apiError(400, 'PAYMENT_ORDER_EXPIRED');
	}
	assertValidBigIntString(order.amountBaseUnits);

	const normalizedTxHash = normalizeTransactionHash(txHash);
	if (order.txHash !== null && order.txHash !== normalizedTxHash) throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');
	const usedOrder = await db
		.select({ id: cryptoPaymentOrders.id })
		.from(cryptoPaymentOrders)
		.where(and(
			eq(cryptoPaymentOrders.chainId, order.chainId),
			eq(cryptoPaymentOrders.txHash, normalizedTxHash),
			ne(cryptoPaymentOrders.id, order.id),
		))
		.get();
	if (usedOrder) throw apiError(400, 'PAYMENT_TRANSACTION_ALREADY_USED');

	let submittedOrder: OrderForConfirmation;
	if (order.txHash === normalizedTxHash) {
		submittedOrder = order;
	} else {
		const submittedOrders = await db
			.update(cryptoPaymentOrders)
			.set({ txHash: normalizedTxHash, updatedAt: now })
			.where(and(eq(cryptoPaymentOrders.id, order.id), eq(cryptoPaymentOrders.status, 'pending')))
			.returning();
		if (submittedOrders.length === 0) throw apiError(400, 'PAYMENT_TRANSACTION_ALREADY_USED');
		submittedOrder = submittedOrders[0] as OrderForConfirmation;
	}

	const verificationResult = await verifyCryptoPaymentTransaction(env, submittedOrder, normalizedTxHash);
	if (verificationResult === 'pending') return submittedOrder;

	return await markCryptoPaymentOrderPaid(env, submittedOrder, normalizedTxHash, now);
}

export async function checkCryptoPaymentOrder(env: Env, userId: string, orderId: string): Promise<typeof cryptoPaymentOrders.$inferSelect> {
	const db = getDb(env);
	const now = Date.now();
	const order = await db
		.select()
		.from(cryptoPaymentOrders)
		.where(and(eq(cryptoPaymentOrders.id, orderId), eq(cryptoPaymentOrders.userId, userId)))
		.get();

	if (!order) throw apiError(404, 'PAYMENT_ORDER_NOT_FOUND');
	if (order.status === 'paid') return order;
	if (order.status !== 'pending') return order;
	if (order.txHash === null) {
		if (order.expiresAt <= now) {
			const expiredOrders = await db
				.update(cryptoPaymentOrders)
				.set({ status: 'expired', updatedAt: now })
				.where(and(eq(cryptoPaymentOrders.id, order.id), eq(cryptoPaymentOrders.status, 'pending')))
				.returning();
			return (expiredOrders[0] ?? order) as OrderForConfirmation;
		}
		return order;
	}

	const normalizedTxHash = normalizeTransactionHash(order.txHash);
	const verificationResult = await verifyCryptoPaymentTransaction(env, order, normalizedTxHash);
	if (verificationResult === 'pending') return order;

	return await markCryptoPaymentOrderPaid(env, order, normalizedTxHash, now);
}

async function markCryptoPaymentOrderPaid(env: Env, order: OrderForConfirmation, normalizedTxHash: Hex, now: number): Promise<OrderForConfirmation> {
	const db = getDb(env);
	const effectivePeriod = getPaidOrderEffectivePeriod(order, now);
	let claimedOrders: OrderForConfirmation[];
	try {
		claimedOrders = await db
			.update(cryptoPaymentOrders)
			.set({
				status: 'paid',
				txHash: normalizedTxHash,
				paidAt: now,
				quoteEffectiveStartsAt: effectivePeriod.startsAt,
				quoteEffectiveExpiresAt: effectivePeriod.expiresAt,
				updatedAt: now,
			})
			.where(and(eq(cryptoPaymentOrders.id, order.id), eq(cryptoPaymentOrders.status, 'pending')))
			.returning();
	} catch {
		throw apiError(400, 'PAYMENT_TRANSACTION_ALREADY_USED');
	}
	if (claimedOrders.length === 0) throw apiError(400, 'PAYMENT_TRANSACTION_ALREADY_USED');
	const claimedOrder = claimedOrders[0] as OrderForConfirmation;

	await applyPaidOrderPlan(env, claimedOrder, now);
	await refreshEffectiveQuotaForUser(env, order.userId, now);

	return claimedOrder;
}

function getPaidOrderEffectivePeriod(order: OrderForConfirmation, paidAt: number): { startsAt: number; expiresAt: number } {
	if (order.quoteCurrentPlanId !== null) {
		return {
			startsAt: order.quoteEffectiveStartsAt,
			expiresAt: order.quoteEffectiveExpiresAt,
		};
	}
	return {
		startsAt: paidAt,
		expiresAt: addPaymentDuration(paidAt, order.durationDays, order.durationUnit),
	};
}

async function verifyCryptoPaymentTransaction(env: Env, order: OrderForConfirmation, txHash: Hex): Promise<PaymentVerificationResult> {
	const rpcUrl = getPaymentChainRpcUrl(env, order.chainId);
	if (!rpcUrl) throw apiError(400, 'PAYMENT_CHAIN_RPC_NOT_CONFIGURED');

	const client = createPublicClient({ transport: http(rpcUrl) });
	try {
		const chainId = await client.getChainId();
		if (chainId !== order.chainId) throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');

		let receipt: TransactionReceipt;
		try {
			receipt = await client.getTransactionReceipt({ hash: txHash });
		} catch (e) {
			if (e instanceof TransactionReceiptNotFoundError) return 'pending';
			throw e;
		}
		if (receipt.status !== 'success') throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');

		const confirmationsRequired = Math.max(1, await getConfirmationsRequired(env, order.chainId));
		if (confirmationsRequired > 1) {
			const blockNumber = await client.getBlockNumber();
			const confirmations = blockNumber >= receipt.blockNumber ? blockNumber - receipt.blockNumber + 1n : 0n;
			if (confirmations < BigInt(confirmationsRequired)) return 'pending';
		}

		const block = await client.getBlock({ blockNumber: receipt.blockNumber });
		const txTimestampMs = Number(block.timestamp) * 1000;
		if (!Number.isSafeInteger(txTimestampMs)) throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');
		if (
			txTimestampMs + TX_TIMESTAMP_TOLERANCE_MS < order.createdAt
		) {
			throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');
		}
		if (txTimestampMs - TX_TIMESTAMP_TOLERANCE_MS > order.expiresAt) throw apiError(400, 'PAYMENT_ORDER_EXPIRED');

		const expectedContract = normalizeEthAddress(order.contractAddress);
		const expectedPayer = normalizeEthAddress(order.payerAddress);
		const expectedRecipient = normalizeEthAddress(order.recipientAddress);
		const expectedAmount = BigInt(order.amountBaseUnits);
		const hasExpectedTransfer = receipt.logs.some((log) => {
			if (log.address.toLowerCase() !== expectedContract) return false;
			try {
				const decoded = decodeEventLog({
					abi: [TRANSFER_EVENT],
					data: log.data,
					topics: log.topics,
				});
				const from = String(decoded.args.from).toLowerCase();
				const to = String(decoded.args.to).toLowerCase();
				const value = decoded.args.value;
				return from === expectedPayer && to === expectedRecipient && value >= expectedAmount;
			} catch {
				return false;
			}
		});

		if (!hasExpectedTransfer) throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');
		return 'confirmed';
	} catch (e) {
		if (e instanceof ApiError) throw e;
		throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');
	}
}

async function getConfirmationsRequired(env: Env, chainId: number): Promise<number> {
	const db = getDb(env);
	const row = await db.select({ confirmationsRequired: paymentChains.confirmationsRequired }).from(paymentChains).where(eq(paymentChains.chainId, chainId)).get();
	return row?.confirmationsRequired ?? 1;
}

async function applyPaidOrderPlan(env: Env, order: OrderForConfirmation, now: number): Promise<void> {
	const db = getDb(env);
	if (order.assetId == null) throw apiError(400, 'PAYMENT_ORDER_NOT_FOUND');

	await expireDiscountedFuturePlanAssignment(env, {
		userId: order.userId,
		quoteCurrentPlanId: order.quoteCurrentPlanId,
		quoteCurrentPlanExpiresAt: order.quoteCurrentPlanExpiresAt,
		quoteCreatedAt: order.quoteCreatedAt,
		quoteDiscountBaseUnits: order.quoteDiscountBaseUnits,
		quoteEffectiveStartsAt: order.quoteEffectiveStartsAt,
	});

	await db
		.insert(userPlanAssignments)
		.values({
			id: newPaymentId(now),
			userId: order.userId,
			planId: order.planId,
			startsAt: order.quoteEffectiveStartsAt,
			expiresAt: order.quoteEffectiveExpiresAt,
			priceAssetId: order.assetId,
			priceAmountBaseUnits: order.quoteBaseAmountBaseUnits,
			priceDurationDays: order.durationDays,
			priceDurationUnit: order.durationUnit,
			createdAt: now,
			updatedAt: now,
		});
}

export async function expireDiscountedFuturePlanAssignment(env: Env, order: {
	userId: string;
	quoteCurrentPlanId: string | null;
	quoteCurrentPlanExpiresAt: number | null;
	quoteCreatedAt: number;
	quoteDiscountBaseUnits: string;
	quoteEffectiveStartsAt: number;
}): Promise<void> {
	if (
		order.quoteCurrentPlanId === null
		|| order.quoteCurrentPlanExpiresAt === null
		|| order.quoteEffectiveStartsAt <= order.quoteCreatedAt
		|| BigInt(order.quoteDiscountBaseUnits) <= 0n
	) return;

	await getDb(env)
		.delete(userPlanAssignments)
		.where(and(
			eq(userPlanAssignments.userId, order.userId),
			eq(userPlanAssignments.planId, order.quoteCurrentPlanId),
			eq(userPlanAssignments.startsAt, order.quoteEffectiveStartsAt),
			eq(userPlanAssignments.expiresAt, order.quoteCurrentPlanExpiresAt),
		));
}

export function normalizeTransactionHash(txHash: string): Hex {
	if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');
	return txHash.toLowerCase() as Hex;
}

export function assertValidBigIntString(value: string): void {
	try {
		if (BigInt(value) <= 0n) throw new Error('non-positive');
	} catch {
		throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');
	}
}

export function assertValidPaymentAddress(address: string): void {
	if (!isAddress(address)) throw apiError(400, 'PAYMENT_TRANSACTION_INVALID');
}

export function newPaymentId(now = Date.now()): string {
	return genEaidx(now);
}

export function cryptoPaymentOrderByNewest() {
	return desc(cryptoPaymentOrders.id);
}

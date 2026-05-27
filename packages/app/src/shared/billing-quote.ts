export type PaymentDurationUnit = 'days' | 'months' | 'years';

export type PaymentQuotePlanPrice = {
	amountBaseUnits: string;
	durationDays: number;
	durationUnit: PaymentDurationUnit;
};

export type PaymentQuoteCurrentPlan = {
	id: string;
	name: string;
	sortOrder: number;
	startsAt?: number;
	expiresAt: number;
	price: PaymentQuotePlanPrice;
};

export type PaymentQuoteInput = {
	quoteCreatedAt: number;
	quoteTtlMs: number;
	targetPlanId: string;
	targetPlanSortOrder: number;
	targetPlanPrice: PaymentQuotePlanPrice;
	currentPlan: PaymentQuoteCurrentPlan | null;
};

export type PaymentQuote = {
	quoteCreatedAt: number;
	quoteExpiresAt: number;
	baseAmountBaseUnits: string;
	discountBaseUnits: string;
	payableAmountBaseUnits: string;
	effectiveStartsAt: number;
	effectiveExpiresAt: number;
	currentPlan: {
		id: string;
		name: string;
		sortOrder: number;
		expiresAt: number;
		priceAmountBaseUnits: string;
		priceDurationDays: number;
		priceDurationUnit: PaymentDurationUnit;
	} | null;
};

export const DAY_MS = 86_400_000;
export const DEAL_LOOKBACK_MS = 56 * DAY_MS;
export const DEAL_MIN_REFERENCE_SOLD_MS = 14 * DAY_MS;
export const DEAL_REFERENCE_RECENCY_MS = 14 * DAY_MS;

export type PriceHistoryPeriod = {
	id: string;
	priceId: string;
	assetId: string;
	planId: string;
	amountBaseUnits: string;
	durationDays: number;
	durationUnit: PaymentDurationUnit;
	isEnabled: boolean;
	startsAt: number;
	expiresAt: number | null;
	createdAt: number;
};

export type DealDisplayReason =
	| 'eligible'
	| 'no_reference_price'
	| 'reference_not_higher'
	| 'sold_less_than_half_recent_period'
	| 'sold_less_than_two_weeks'
	| 'reference_too_old';

export type DealDisplayEvaluation = {
	canShowDeal: boolean;
	referenceAmountBaseUnits: string | null;
	reason: DealDisplayReason;
	checkedFrom: number;
	checkedTo: number;
	referenceSoldMs: number;
	totalSoldMs: number;
	referenceLastSoldAt: number | null;
};

export type PriceDisplayWindow = {
	previousPeriod: PriceHistoryPeriod | null;
	currentPeriod: PriceHistoryPeriod | null;
	nextPeriod: PriceHistoryPeriod | null;
};

export function addPaymentDuration(baseMs: number, value: number, unit: PaymentDurationUnit): number {
	if (unit === 'days') return baseMs + value * DAY_MS;

	const base = new Date(baseMs);
	const year = base.getUTCFullYear();
	const month = base.getUTCMonth();
	const day = base.getUTCDate();
	const targetMonthIndex = unit === 'months' ? month + value : month + value * 12;
	const targetYear = year + Math.floor(targetMonthIndex / 12);
	const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
	const targetDay = Math.min(day, getUtcDaysInMonth(targetYear, targetMonth));
	return Date.UTC(
		targetYear,
		targetMonth,
		targetDay,
		base.getUTCHours(),
		base.getUTCMinutes(),
		base.getUTCSeconds(),
		base.getUTCMilliseconds(),
	);
}

export function calculatePaymentQuote(input: PaymentQuoteInput): PaymentQuote {
	const baseAmount = BigInt(input.targetPlanPrice.amountBaseUnits);
	const samePlan = input.currentPlan?.id === input.targetPlanId;
	const downgrade = input.currentPlan != null && !samePlan && input.targetPlanSortOrder < input.currentPlan.sortOrder;
	const currentPlanStartsAt = input.currentPlan?.startsAt ?? input.quoteCreatedAt;
	const effectiveBaseAt = (samePlan || downgrade) && input.currentPlan
		? input.currentPlan.expiresAt
		: Math.max(input.quoteCreatedAt, currentPlanStartsAt);
	const effectiveExpiresAt = addPaymentDuration(effectiveBaseAt, input.targetPlanPrice.durationDays, input.targetPlanPrice.durationUnit);

	if (!input.currentPlan || samePlan || downgrade) {
		return {
			quoteCreatedAt: input.quoteCreatedAt,
			quoteExpiresAt: input.quoteCreatedAt + input.quoteTtlMs,
			baseAmountBaseUnits: input.targetPlanPrice.amountBaseUnits,
			discountBaseUnits: '0',
			payableAmountBaseUnits: input.targetPlanPrice.amountBaseUnits,
			effectiveStartsAt: effectiveBaseAt,
			effectiveExpiresAt,
			currentPlan: input.currentPlan && !samePlan ? toPaymentQuoteCurrentPlan(input.currentPlan) : null,
		};
	}

	const discountBaseAt = Math.max(input.quoteCreatedAt, currentPlanStartsAt);
	const remainingMs = Math.max(0, input.currentPlan.expiresAt - discountBaseAt);
	const currentDurationMs = Math.max(1, addPaymentDuration(discountBaseAt, input.currentPlan.price.durationDays, input.currentPlan.price.durationUnit) - discountBaseAt);
	const rawDiscount = BigInt(input.currentPlan.price.amountBaseUnits) * BigInt(remainingMs) / BigInt(currentDurationMs);
	const discount = rawDiscount > baseAmount ? baseAmount : rawDiscount;

	return {
		quoteCreatedAt: input.quoteCreatedAt,
		quoteExpiresAt: input.quoteCreatedAt + input.quoteTtlMs,
		baseAmountBaseUnits: input.targetPlanPrice.amountBaseUnits,
		discountBaseUnits: discount.toString(),
		payableAmountBaseUnits: (baseAmount - discount).toString(),
		effectiveStartsAt: effectiveBaseAt,
		effectiveExpiresAt,
		currentPlan: toPaymentQuoteCurrentPlan(input.currentPlan),
	};
}

export function getPriceDisplayWindow(
	periods: PriceHistoryPeriod[],
	currentPriceId: string,
	now: number,
): PriceDisplayWindow {
	const sorted = [...periods].sort(comparePricePeriods);
	const currentIndex = sorted.findIndex(period => (
		period.priceId === currentPriceId
		&& period.startsAt <= now
		&& (period.expiresAt == null || period.expiresAt > now)
	));
	const fallbackIndex = currentIndex >= 0 ? currentIndex : findLastPeriodIndex(sorted, currentPriceId);
	const currentPeriod = fallbackIndex >= 0 ? sorted[fallbackIndex] : null;
	return {
		previousPeriod: fallbackIndex > 0 ? sorted[fallbackIndex - 1] : null,
		currentPeriod,
		nextPeriod: fallbackIndex >= 0 && fallbackIndex < sorted.length - 1 ? sorted[fallbackIndex + 1] : null,
	};
}

export function evaluateDealDisplayEligibility(
	periods: PriceHistoryPeriod[],
	currentPrice: Pick<PriceHistoryPeriod, 'amountBaseUnits' | 'assetId' | 'planId' | 'durationDays' | 'durationUnit'>,
	now: number,
): DealDisplayEvaluation {
	const relatedPeriods = periods.filter(period => (
		period.assetId === currentPrice.assetId
		&& period.planId === currentPrice.planId
		&& period.durationDays === currentPrice.durationDays
		&& period.durationUnit === currentPrice.durationUnit
	));
	const firstSoldAt = Math.min(...relatedPeriods.map(period => period.startsAt));
	const checkedFrom = Number.isFinite(firstSoldAt) ? Math.max(now - DEAL_LOOKBACK_MS, firstSoldAt) : now - DEAL_LOOKBACK_MS;
	const checkedTo = now;
	const enabledPeriods = relatedPeriods.filter(period => period.isEnabled);
	const totalSoldMs = unionDuration(enabledPeriods.map(periodToInterval(checkedFrom, checkedTo)));
	const currentAmount = BigInt(currentPrice.amountBaseUnits);
	const referenceAmounts = new Map<string, { soldMs: number; lastSoldAt: number | null }>();

	for (const period of enabledPeriods) {
		const amount = BigInt(period.amountBaseUnits);
		if (amount <= currentAmount) continue;
		const interval = periodToInterval(checkedFrom, checkedTo)(period);
		if (!interval) continue;
		const existing = referenceAmounts.get(period.amountBaseUnits) ?? { soldMs: 0, lastSoldAt: null };
		existing.soldMs += interval.end - interval.start;
		existing.lastSoldAt = Math.max(existing.lastSoldAt ?? 0, interval.end);
		referenceAmounts.set(period.amountBaseUnits, existing);
	}

	const references = [...referenceAmounts.entries()].sort((a, b) => {
		const soldDiff = b[1].soldMs - a[1].soldMs;
		if (soldDiff !== 0) return soldDiff;
		const amountA = BigInt(a[0]);
		const amountB = BigInt(b[0]);
		return amountA < amountB ? 1 : amountA > amountB ? -1 : 0;
	});
	const [referenceAmountBaseUnits, reference] = references[0] ?? [null, null];
	if (!referenceAmountBaseUnits || !reference) {
		const hasHigherPrice = enabledPeriods.some(period => BigInt(period.amountBaseUnits) > currentAmount);
		return toDealDisplayEvaluation(false, hasHigherPrice ? 'sold_less_than_two_weeks' : 'reference_not_higher', null, checkedFrom, checkedTo, 0, totalSoldMs, null);
	}
	if (totalSoldMs <= 0) {
		return toDealDisplayEvaluation(false, 'no_reference_price', referenceAmountBaseUnits, checkedFrom, checkedTo, reference.soldMs, totalSoldMs, reference.lastSoldAt);
	}
	if (reference.soldMs * 2 <= totalSoldMs) {
		return toDealDisplayEvaluation(false, 'sold_less_than_half_recent_period', referenceAmountBaseUnits, checkedFrom, checkedTo, reference.soldMs, totalSoldMs, reference.lastSoldAt);
	}
	if (reference.soldMs < DEAL_MIN_REFERENCE_SOLD_MS) {
		return toDealDisplayEvaluation(false, 'sold_less_than_two_weeks', referenceAmountBaseUnits, checkedFrom, checkedTo, reference.soldMs, totalSoldMs, reference.lastSoldAt);
	}
	if (reference.lastSoldAt == null || now - reference.lastSoldAt > DEAL_REFERENCE_RECENCY_MS) {
		return toDealDisplayEvaluation(false, 'reference_too_old', referenceAmountBaseUnits, checkedFrom, checkedTo, reference.soldMs, totalSoldMs, reference.lastSoldAt);
	}

	return toDealDisplayEvaluation(true, 'eligible', referenceAmountBaseUnits, checkedFrom, checkedTo, reference.soldMs, totalSoldMs, reference.lastSoldAt);
}

function toPaymentQuoteCurrentPlan(currentPlan: PaymentQuoteCurrentPlan): PaymentQuote['currentPlan'] {
	return {
		id: currentPlan.id,
		name: currentPlan.name,
		sortOrder: currentPlan.sortOrder,
		expiresAt: currentPlan.expiresAt,
		priceAmountBaseUnits: currentPlan.price.amountBaseUnits,
		priceDurationDays: currentPlan.price.durationDays,
		priceDurationUnit: currentPlan.price.durationUnit,
	};
}

function toDealDisplayEvaluation(
	canShowDeal: boolean,
	reason: DealDisplayReason,
	referenceAmountBaseUnits: string | null,
	checkedFrom: number,
	checkedTo: number,
	referenceSoldMs: number,
	totalSoldMs: number,
	referenceLastSoldAt: number | null,
): DealDisplayEvaluation {
	return {
		canShowDeal,
		referenceAmountBaseUnits,
		reason,
		checkedFrom,
		checkedTo,
		referenceSoldMs,
		totalSoldMs,
		referenceLastSoldAt,
	};
}

function comparePricePeriods(a: PriceHistoryPeriod, b: PriceHistoryPeriod): number {
	return a.startsAt - b.startsAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function findLastPeriodIndex(periods: PriceHistoryPeriod[], priceId: string): number {
	for (let i = periods.length - 1; i >= 0; i--) {
		if (periods[i]?.priceId === priceId) return i;
	}
	return -1;
}

function periodToInterval(checkedFrom: number, checkedTo: number) {
	return (period: PriceHistoryPeriod): { start: number; end: number } | null => {
		const start = Math.max(period.startsAt, checkedFrom);
		const end = Math.min(period.expiresAt ?? checkedTo, checkedTo);
		return end > start ? { start, end } : null;
	};
}

function unionDuration(intervals: Array<{ start: number; end: number } | null>): number {
	const sorted = intervals
		.filter((interval): interval is { start: number; end: number } => interval != null)
		.sort((a, b) => a.start - b.start || a.end - b.end);
	let total = 0;
	let active: { start: number; end: number } | null = null;
	for (const interval of sorted) {
		if (!active) {
			active = { ...interval };
			continue;
		}
		if (interval.start <= active.end) {
			active.end = Math.max(active.end, interval.end);
			continue;
		}
		total += active.end - active.start;
		active = { ...interval };
	}
	if (active) total += active.end - active.start;
	return total;
}

function getUtcDaysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

import { describe, expect, test } from 'vitest';
import { addPaymentDuration, calculatePaymentQuote, evaluateDealDisplayEligibility, type PriceHistoryPeriod } from '../src/shared/billing-quote';

describe('billing quote calculation', () => {
	const baseAt = Date.UTC(2026, 0, 15, 12, 0, 0);

	test('extends the current expiry when buying the same plan again', () => {
		const currentExpiresAt = baseAt + 30 * 86_400_000;
		const quote = calculatePaymentQuote({
			quoteCreatedAt: baseAt,
			quoteTtlMs: 15 * 60 * 1000,
			targetPlanId: 'plan-basic',
			targetPlanSortOrder: 10,
			targetPlanPrice: {
				amountBaseUnits: '30000000',
				durationDays: 90,
				durationUnit: 'days',
			},
			currentPlan: {
				id: 'plan-basic',
				name: 'Basic',
				sortOrder: 10,
				expiresAt: currentExpiresAt,
				price: {
					amountBaseUnits: '30000000',
					durationDays: 90,
					durationUnit: 'days',
				},
			},
		});

		expect(quote.discountBaseUnits).toBe('0');
		expect(quote.payableAmountBaseUnits).toBe('30000000');
		expect(quote.effectiveExpiresAt).toBe(currentExpiresAt + 90 * 86_400_000);
	});

	test('does not discount when there is no current active plan', () => {
		const quote = calculatePaymentQuote({
			quoteCreatedAt: baseAt,
			quoteTtlMs: 15 * 60 * 1000,
			targetPlanId: 'plan-basic',
			targetPlanSortOrder: 10,
			targetPlanPrice: {
				amountBaseUnits: '30000000',
				durationDays: 90,
				durationUnit: 'days',
			},
			currentPlan: null,
		});

		expect(quote.discountBaseUnits).toBe('0');
		expect(quote.payableAmountBaseUnits).toBe('30000000');
		expect(quote.currentPlan).toBeNull();
	});

	test('discounts an upgrade by the remaining value of the current plan', () => {
		const quote = calculatePaymentQuote({
			quoteCreatedAt: baseAt,
			quoteTtlMs: 15 * 60 * 1000,
			targetPlanId: 'plan-pro',
			targetPlanSortOrder: 20,
			targetPlanPrice: {
				amountBaseUnits: '90000000',
				durationDays: 90,
				durationUnit: 'days',
			},
			currentPlan: {
				id: 'plan-basic',
				name: 'Basic',
				sortOrder: 10,
				expiresAt: baseAt + 30 * 86_400_000,
				price: {
					amountBaseUnits: '30000000',
					durationDays: 90,
					durationUnit: 'days',
				},
			},
		});

		expect(quote.baseAmountBaseUnits).toBe('90000000');
		expect(quote.discountBaseUnits).toBe('10000000');
		expect(quote.payableAmountBaseUnits).toBe('80000000');
		expect(quote.effectiveExpiresAt).toBe(baseAt + 90 * 86_400_000);
		expect(quote.currentPlan).toEqual(expect.objectContaining({ id: 'plan-basic' }));
	});

	test('schedules a downgrade after the current higher plan expires', () => {
		const currentExpiresAt = baseAt + 30 * 86_400_000;
		const quote = calculatePaymentQuote({
			quoteCreatedAt: baseAt,
			quoteTtlMs: 15 * 60 * 1000,
			targetPlanId: 'plan-basic',
			targetPlanSortOrder: 10,
			targetPlanPrice: {
				amountBaseUnits: '30000000',
				durationDays: 90,
				durationUnit: 'days',
			},
			currentPlan: {
				id: 'plan-pro',
				name: 'Pro',
				sortOrder: 20,
				expiresAt: currentExpiresAt,
				price: {
					amountBaseUnits: '90000000',
					durationDays: 90,
					durationUnit: 'days',
				},
			},
		});

		expect(quote.discountBaseUnits).toBe('0');
		expect(quote.payableAmountBaseUnits).toBe('30000000');
		expect(quote.effectiveStartsAt).toBe(currentExpiresAt);
		expect(quote.effectiveExpiresAt).toBe(currentExpiresAt + 90 * 86_400_000);
		expect(quote.currentPlan).toEqual(expect.objectContaining({ id: 'plan-pro', sortOrder: 20 }));
	});

	test('discounts an upgrade from a future scheduled lower plan', () => {
		const futureStartsAt = baseAt + 30 * 86_400_000;
		const quote = calculatePaymentQuote({
			quoteCreatedAt: baseAt,
			quoteTtlMs: 15 * 60 * 1000,
			targetPlanId: 'plan-pro',
			targetPlanSortOrder: 20,
			targetPlanPrice: {
				amountBaseUnits: '90000000',
				durationDays: 90,
				durationUnit: 'days',
			},
			currentPlan: {
				id: 'plan-basic',
				name: 'Basic',
				sortOrder: 10,
				startsAt: futureStartsAt,
				expiresAt: futureStartsAt + 90 * 86_400_000,
				price: {
					amountBaseUnits: '30000000',
					durationDays: 90,
					durationUnit: 'days',
				},
			},
		});

		expect(quote.discountBaseUnits).toBe('30000000');
		expect(quote.payableAmountBaseUnits).toBe('60000000');
		expect(quote.effectiveStartsAt).toBe(futureStartsAt);
		expect(quote.effectiveExpiresAt).toBe(futureStartsAt + 90 * 86_400_000);
		expect(quote.currentPlan).toEqual(expect.objectContaining({ id: 'plan-basic', sortOrder: 10 }));
	});

	test('discounts all lower scheduled plans overlapping the upgraded period', () => {
		const futureStartsAt = Date.UTC(2026, 10, 26, 16, 0, 0);
		const secondStartsAt = futureStartsAt + 90 * 86_400_000;
		const quote = calculatePaymentQuote({
			quoteCreatedAt: baseAt,
			quoteTtlMs: 15 * 60 * 1000,
			targetPlanId: 'plan-pro',
			targetPlanSortOrder: 20,
			targetPlanPrice: {
				amountBaseUnits: '750000',
				durationDays: 3,
				durationUnit: 'months',
			},
			currentPlan: {
				id: 'plan-basic',
				name: 'Basic',
				sortOrder: 10,
				startsAt: futureStartsAt,
				expiresAt: secondStartsAt,
				price: {
					amountBaseUnits: '50000',
					durationDays: 90,
					durationUnit: 'days',
				},
			},
			currentPlans: [
				{
					id: 'plan-basic',
					name: 'Basic',
					sortOrder: 10,
					startsAt: futureStartsAt,
					expiresAt: secondStartsAt,
					price: {
						amountBaseUnits: '50000',
						durationDays: 90,
						durationUnit: 'days',
					},
				},
				{
					id: 'plan-basic',
					name: 'Basic',
					sortOrder: 10,
					startsAt: secondStartsAt,
					expiresAt: secondStartsAt + 90 * 86_400_000,
					price: {
						amountBaseUnits: '50000',
						durationDays: 90,
						durationUnit: 'days',
					},
				},
			],
		});

		expect(quote.discountBaseUnits).toBe('51111');
		expect(quote.payableAmountBaseUnits).toBe('698889');
		expect(quote.effectiveStartsAt).toBe(futureStartsAt);
		expect(quote.effectiveExpiresAt).toBe(Date.UTC(2027, 1, 26, 16, 0, 0));
	});

	test('adds calendar months without overflowing into the next month', () => {
		const jan31 = Date.UTC(2026, 0, 31, 10, 0, 0);

		expect(addPaymentDuration(jan31, 1, 'months')).toBe(Date.UTC(2026, 1, 28, 10, 0, 0));
	});
});

describe('deal display eligibility', () => {
	const now = Date.UTC(2026, 2, 1);
	const day = 86_400_000;
	const currentPrice = {
		assetId: 'asset-usd',
		planId: 'plan-basic',
		amountBaseUnits: '25000000',
		durationDays: 90,
		durationUnit: 'days' as const,
	};

	function period(input: Partial<PriceHistoryPeriod>): PriceHistoryPeriod {
		return {
			id: input.id ?? `period-${Math.random()}`,
			priceId: input.priceId ?? 'price',
			assetId: input.assetId ?? currentPrice.assetId,
			planId: input.planId ?? currentPrice.planId,
			amountBaseUnits: input.amountBaseUnits ?? '30000000',
			durationDays: input.durationDays ?? currentPrice.durationDays,
			durationUnit: input.durationUnit ?? currentPrice.durationUnit,
			isEnabled: input.isEnabled ?? true,
			startsAt: input.startsAt ?? now - 56 * day,
			expiresAt: input.expiresAt ?? now - 7 * day,
		};
	}

	test('allows a deal when the reference price satisfies the recent-period rule', () => {
		const evaluation = evaluateDealDisplayEligibility([
			period({ amountBaseUnits: '30000000', startsAt: now - 56 * day, expiresAt: now - 7 * day }),
			period({ priceId: 'current', amountBaseUnits: '25000000', startsAt: now - 7 * day, expiresAt: null }),
		], currentPrice, now);

		expect(evaluation).toMatchObject({
			canShowDeal: true,
			referenceAmountBaseUnits: '30000000',
			reason: 'eligible',
		});
	});

	test('rejects when no higher reference price exists', () => {
		const evaluation = evaluateDealDisplayEligibility([
			period({ amountBaseUnits: '25000000', startsAt: now - 56 * day, expiresAt: null }),
		], currentPrice, now);

		expect(evaluation.canShowDeal).toBe(false);
		expect(evaluation.reason).toBe('reference_not_higher');
	});

	test('rejects when the reference price was not sold for a majority of the recent period', () => {
		const evaluation = evaluateDealDisplayEligibility([
			period({ amountBaseUnits: '30000000', startsAt: now - 56 * day, expiresAt: now - 34 * day }),
			period({ priceId: 'current', amountBaseUnits: '25000000', startsAt: now - 34 * day, expiresAt: null }),
		], currentPrice, now);

		expect(evaluation.canShowDeal).toBe(false);
		expect(evaluation.reason).toBe('sold_less_than_half_recent_period');
	});

	test('rejects when the reference price was sold for less than two weeks', () => {
		const evaluation = evaluateDealDisplayEligibility([
			period({ amountBaseUnits: '30000000', startsAt: now - 20 * day, expiresAt: now - 7 * day }),
			period({ priceId: 'current', amountBaseUnits: '25000000', startsAt: now - 7 * day, expiresAt: null }),
		], currentPrice, now);

		expect(evaluation.canShowDeal).toBe(false);
		expect(evaluation.reason).toBe('sold_less_than_two_weeks');
	});

	test('rejects when the reference price is too old', () => {
		const evaluation = evaluateDealDisplayEligibility([
			period({ amountBaseUnits: '30000000', startsAt: now - 56 * day, expiresAt: now - 15 * day }),
			period({ priceId: 'current', amountBaseUnits: '25000000', startsAt: now - 15 * day, expiresAt: null }),
		], currentPrice, now);

		expect(evaluation.canShowDeal).toBe(false);
		expect(evaluation.reason).toBe('reference_too_old');
	});

	test('uses the shorter selling period when the price history is younger than eight weeks', () => {
		const evaluation = evaluateDealDisplayEligibility([
			period({ amountBaseUnits: '30000000', startsAt: now - 20 * day, expiresAt: now - 5 * day }),
			period({ priceId: 'current', amountBaseUnits: '25000000', startsAt: now - 5 * day, expiresAt: null }),
		], currentPrice, now);

		expect(evaluation.canShowDeal).toBe(true);
		expect(evaluation.checkedFrom).toBe(now - 20 * day);
	});
});

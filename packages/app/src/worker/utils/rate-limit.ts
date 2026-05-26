import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { userQuotas, globalQuotas, userPlanAssignments, plans, users } from '../scheme/index';
import { getDb } from './db';

export interface RateLimitConfig {
	maxBuckets: number | null;
	maxBucketSizeBytes: number | null;
	maxFilesPerBucket: number | null;
	maxDailyUploads: number | null;
	canUseDownloadCount: boolean;
}

export type EffectiveQuotaSource = 'plan' | 'custom' | 'global' | 'default';

export interface EffectiveQuotaConfig extends RateLimitConfig {
	effectiveQuotaExpiresAt: number | null;
	effectiveQuotaUpdatedAt: number;
	effectiveQuotaSource: EffectiveQuotaSource;
}

export interface StoredEffectiveQuotaConfig extends RateLimitConfig {
	effectiveQuotaExpiresAt: number | null;
	effectiveQuotaUpdatedAt: number | null;
	effectiveQuotaSource: EffectiveQuotaSource | null;
}

const defaultQuota: RateLimitConfig = {
	maxBuckets: null,
	maxBucketSizeBytes: null,
	maxFilesPerBucket: null,
	maxDailyUploads: null,
	canUseDownloadCount: false,
};

function withMetadata(
	quota: RateLimitConfig,
	now: number,
	effectiveQuotaExpiresAt: number | null,
	effectiveQuotaSource: EffectiveQuotaSource,
): EffectiveQuotaConfig {
	return {
		...quota,
		effectiveQuotaExpiresAt,
		effectiveQuotaUpdatedAt: now,
		effectiveQuotaSource,
	};
}

function toRateLimitConfig(quota: EffectiveQuotaConfig): RateLimitConfig {
	return {
		maxBuckets: quota.maxBuckets,
		maxBucketSizeBytes: quota.maxBucketSizeBytes,
		maxFilesPerBucket: quota.maxFilesPerBucket,
		maxDailyUploads: quota.maxDailyUploads,
		canUseDownloadCount: quota.canUseDownloadCount,
	};
}

function toStoredEffectiveQuotaConfig(user: {
	effectiveMaxBuckets: number | null;
	effectiveMaxBucketSizeBytes: number | null;
	effectiveMaxFilesPerBucket: number | null;
	effectiveMaxDailyUploads: number | null;
	effectiveCanUseDownloadCount: boolean;
	effectiveQuotaExpiresAt: number | null;
	effectiveQuotaUpdatedAt: number | null;
	effectiveQuotaSource: string | null;
}): StoredEffectiveQuotaConfig {
	const source = user.effectiveQuotaSource;
	return {
		maxBuckets: user.effectiveMaxBuckets,
		maxBucketSizeBytes: user.effectiveMaxBucketSizeBytes,
		maxFilesPerBucket: user.effectiveMaxFilesPerBucket,
		maxDailyUploads: user.effectiveMaxDailyUploads,
		canUseDownloadCount: user.effectiveCanUseDownloadCount,
		effectiveQuotaExpiresAt: user.effectiveQuotaExpiresAt,
		effectiveQuotaUpdatedAt: user.effectiveQuotaUpdatedAt,
		effectiveQuotaSource: source === 'plan' || source === 'custom' || source === 'global' || source === 'default' ? source : null,
	};
}

function toUserQuotaUpdate(quota: EffectiveQuotaConfig) {
	return {
		effectiveMaxBuckets: quota.maxBuckets,
		effectiveMaxBucketSizeBytes: quota.maxBucketSizeBytes,
		effectiveMaxFilesPerBucket: quota.maxFilesPerBucket,
		effectiveMaxDailyUploads: quota.maxDailyUploads,
		effectiveCanUseDownloadCount: quota.canUseDownloadCount,
		effectiveQuotaExpiresAt: quota.effectiveQuotaExpiresAt,
		effectiveQuotaUpdatedAt: quota.effectiveQuotaUpdatedAt,
		effectiveQuotaSource: quota.effectiveQuotaSource,
	};
}

async function computeEffectiveQuotaForUser(env: Env, userId: string, now: number): Promise<EffectiveQuotaConfig> {
	const db = getDb(env);

	const activePlan = await db
		.select({
			maxBuckets: plans.maxBuckets,
			maxBucketSizeBytes: plans.maxBucketSizeBytes,
			maxFilesPerBucket: plans.maxFilesPerBucket,
			maxDailyUploads: plans.maxDailyUploads,
			canUseDownloadCount: plans.canUseDownloadCount,
			expiresAt: userPlanAssignments.expiresAt,
		})
		.from(userPlanAssignments)
		.innerJoin(plans, eq(userPlanAssignments.planId, plans.id))
		.where(and(
			eq(userPlanAssignments.userId, userId),
			lt(userPlanAssignments.startsAt, now + 1),
			gt(userPlanAssignments.expiresAt, now),
		))
		.orderBy(desc(plans.sortOrder), desc(userPlanAssignments.expiresAt))
		.get();

	if (activePlan) {
		return withMetadata({
			maxBuckets: activePlan.maxBuckets,
			maxBucketSizeBytes: activePlan.maxBucketSizeBytes,
			maxFilesPerBucket: activePlan.maxFilesPerBucket,
			maxDailyUploads: activePlan.maxDailyUploads,
			canUseDownloadCount: activePlan.canUseDownloadCount,
		}, now, activePlan.expiresAt, 'plan');
	}

	const userQuota = await db.select().from(userQuotas).where(eq(userQuotas.userId, userId)).get();

	if (userQuota) {
		return withMetadata({
			maxBuckets: userQuota.maxBuckets,
			maxBucketSizeBytes: userQuota.maxBucketSizeBytes,
			maxFilesPerBucket: userQuota.maxFilesPerBucket,
			maxDailyUploads: userQuota.maxDailyUploads,
			canUseDownloadCount: userQuota.canUseDownloadCount,
		}, now, null, 'custom');
	}

	return getGlobalEffectiveQuota(env, now);
}

async function getGlobalEffectiveQuota(env: Env, now: number): Promise<EffectiveQuotaConfig> {
	const db = getDb(env);

	const globalQuota = await db
		.select()
		.from(globalQuotas)
		.where(eq(globalQuotas.key, 'default'))
		.get();

	if (globalQuota) {
		return withMetadata({
			maxBuckets: globalQuota.maxBuckets,
			maxBucketSizeBytes: globalQuota.maxBucketSizeBytes,
			maxFilesPerBucket: globalQuota.maxFilesPerBucket,
			maxDailyUploads: globalQuota.maxDailyUploads,
			canUseDownloadCount: globalQuota.canUseDownloadCount,
		}, now, null, 'global');
	}

	return withMetadata(defaultQuota, now, null, 'default');
}

export async function getInitialEffectiveQuotaForUser(env: Env, now = Date.now()): Promise<EffectiveQuotaConfig> {
	return getGlobalEffectiveQuota(env, now);
}

export async function refreshEffectiveQuotaForUser(env: Env, userId: string, now = Date.now()): Promise<EffectiveQuotaConfig> {
	const db = getDb(env);
	const quota = await computeEffectiveQuotaForUser(env, userId, now);

	await db
		.update(users)
		.set(toUserQuotaUpdate(quota))
		.where(eq(users.id, userId));

	return quota;
}

export async function refreshEffectiveQuotaForPlanUsers(env: Env, planId: string, now = Date.now()): Promise<void> {
	const db = getDb(env);
	const assignedUsers = await db
		.select({ userId: userPlanAssignments.userId })
		.from(userPlanAssignments)
		.where(eq(userPlanAssignments.planId, planId));

	for (const assignedUser of assignedUsers) {
		await refreshEffectiveQuotaForUser(env, assignedUser.userId, now);
	}
}

export async function refreshEffectiveQuotaForGlobalFallbackUsers(env: Env, quota: RateLimitConfig, now = Date.now()): Promise<void> {
	const db = getDb(env);

	await db
		.update(users)
		.set(toUserQuotaUpdate(withMetadata(quota, now, null, 'global')))
		.where(sql`
			not exists (
				select 1 from ${userQuotas}
				where ${userQuotas.userId} = ${users.id}
			)
			and not exists (
				select 1 from ${userPlanAssignments}
				where ${userPlanAssignments.userId} = ${users.id}
				and ${userPlanAssignments.startsAt} <= ${now}
				and ${userPlanAssignments.expiresAt} > ${now}
			)
		`);
}

export async function getQuotaForUser(env: Env, userId: string): Promise<RateLimitConfig> {
	return toRateLimitConfig(await getEffectiveQuotaForUser(env, userId));
}

export async function getEffectiveQuotaForUser(env: Env, userId: string): Promise<EffectiveQuotaConfig> {
	const db = getDb(env);
	const now = Date.now();

	const user = await db
		.select({
			effectiveMaxBuckets: users.effectiveMaxBuckets,
			effectiveMaxBucketSizeBytes: users.effectiveMaxBucketSizeBytes,
			effectiveMaxFilesPerBucket: users.effectiveMaxFilesPerBucket,
			effectiveMaxDailyUploads: users.effectiveMaxDailyUploads,
			effectiveCanUseDownloadCount: users.effectiveCanUseDownloadCount,
			effectiveQuotaExpiresAt: users.effectiveQuotaExpiresAt,
			effectiveQuotaUpdatedAt: users.effectiveQuotaUpdatedAt,
			effectiveQuotaSource: users.effectiveQuotaSource,
		})
		.from(users)
		.where(eq(users.id, userId))
		.get();
	const source = user?.effectiveQuotaSource;

	if (
		!user
		|| user.effectiveQuotaUpdatedAt === null
		|| !(source === 'plan' || source === 'custom' || source === 'global' || source === 'default')
		|| (user.effectiveQuotaExpiresAt !== null && user.effectiveQuotaExpiresAt <= now)
	) {
		return refreshEffectiveQuotaForUser(env, userId, now);
	}

	return {
		maxBuckets: user.effectiveMaxBuckets,
		maxBucketSizeBytes: user.effectiveMaxBucketSizeBytes,
		maxFilesPerBucket: user.effectiveMaxFilesPerBucket,
		maxDailyUploads: user.effectiveMaxDailyUploads,
		canUseDownloadCount: user.effectiveCanUseDownloadCount,
		effectiveQuotaExpiresAt: user.effectiveQuotaExpiresAt,
		effectiveQuotaUpdatedAt: user.effectiveQuotaUpdatedAt,
		effectiveQuotaSource: source,
	};
}

export async function getStoredEffectiveQuotaForUser(env: Env, userId: string): Promise<StoredEffectiveQuotaConfig | null> {
	const db = getDb(env);
	const user = await db
		.select({
			effectiveMaxBuckets: users.effectiveMaxBuckets,
			effectiveMaxBucketSizeBytes: users.effectiveMaxBucketSizeBytes,
			effectiveMaxFilesPerBucket: users.effectiveMaxFilesPerBucket,
			effectiveMaxDailyUploads: users.effectiveMaxDailyUploads,
			effectiveCanUseDownloadCount: users.effectiveCanUseDownloadCount,
			effectiveQuotaExpiresAt: users.effectiveQuotaExpiresAt,
			effectiveQuotaUpdatedAt: users.effectiveQuotaUpdatedAt,
			effectiveQuotaSource: users.effectiveQuotaSource,
		})
		.from(users)
		.where(eq(users.id, userId))
		.get();

	return user ? toStoredEffectiveQuotaConfig(user) : null;
}

export async function getGlobalQuota(env: Env): Promise<RateLimitConfig> {
	const db = getDb(env);

	const globalQuota = await db
		.select()
		.from(globalQuotas)
		.where(eq(globalQuotas.key, 'default'))
		.get();

	if (globalQuota) {
		return {
			maxBuckets: globalQuota.maxBuckets,
			maxBucketSizeBytes: globalQuota.maxBucketSizeBytes,
			maxFilesPerBucket: globalQuota.maxFilesPerBucket,
			maxDailyUploads: globalQuota.maxDailyUploads,
			canUseDownloadCount: globalQuota.canUseDownloadCount,
		};
	}

	return defaultQuota;
}

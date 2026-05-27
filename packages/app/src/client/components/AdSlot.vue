<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button } from '@vuetify/v0';
import { BadgeJapaneseYen, ExternalLink } from '@lucide/vue';
import { authStore } from '@/store/auth';
import { apiPost, type ApiSuccess } from '@/utils/api';
import NirA from '@/components/NirA.vue';

type PaymentOffer = ApiSuccess<'/api/billing/list-crypto-offers'>['data'][number];

const props = withDefaults(defineProps<{
	placement?: 'inline' | 'compact';
	ownerCanDisableFileAds?: boolean;
}>(), {
	placement: 'inline',
	ownerCanDisableFileAds: false,
});

const availableOffers = ref<PaymentOffer[]>([]);
const loading = ref(false);
const loaded = ref(false);
const viewerShowAds = ref(true);

const hasAvailablePlan = computed(() => !authStore.user || availableOffers.value.length > 0);
const shouldShow = computed(() => !loading.value && viewerShowAds.value && !props.ownerCanDisableFileAds && hasAvailablePlan.value);
const linkTo = computed(() => authStore.user ? '/my/payments' : '/signup');
const actionLabel = computed(() => authStore.user ? 'プランを見る' : 'アカウント作成');
const message = computed(() => authStore.user
	? 'プラン契約で広告なしのファイル共有と追加機能を利用できます。'
	: 'アカウント作成後、プラン契約で広告なしのファイル共有を利用できます。');

async function loadCurrentPlan(): Promise<void> {
	if (loaded.value) return;
	loading.value = true;
	try {
		if (!authStore.user) return;

		const [quotaResult, offersResult] = await Promise.all([
			apiPost('/api/account/effective-quota'),
			apiPost('/api/billing/list-crypto-offers'),
		]);
		if (quotaResult.ok) viewerShowAds.value = quotaResult.data.showAds;
		if (offersResult.ok) availableOffers.value = offersResult.data;
	} finally {
		loading.value = false;
		loaded.value = true;
	}
}

onMounted(() => {
	void loadCurrentPlan();
});
</script>

<template>
  <aside v-if="shouldShow" :class="[$style.slot, props.placement === 'compact' ? $style.compact : $style.inline]" aria-label="広告">
    <div :class="$style.icon" aria-hidden="true">
      <BadgeJapaneseYen :size="18" :stroke-width="2" />
    </div>
    <div :class="$style.body">
      <div :class="$style.label">CFW FileUp Plan</div>
      <p :class="$style.message">{{ message }}</p>
    </div>
    <Button.Root :as="NirA" :to="linkTo" class="btn btn-secondary" :class="$style.action">
      <Button.Content>
        {{ actionLabel }}
        <ExternalLink :size="15" :stroke-width="2" aria-hidden="true" />
      </Button.Content>
    </Button.Root>
  </aside>
</template>

<style module lang="scss">
.slot {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  border: 1px solid #f59e0b;
  border-radius: var(--radius);
  background: linear-gradient(135deg, #fff7ed 0%, var(--color-surface) 58%, #fffbeb 100%);
  box-shadow:
    0 1px 2px rgba(146, 64, 14, 0.08),
    0 0 0 3px rgba(245, 158, 11, 0.12);
}

.inline {
  margin: 12px 0 18px;
  padding: 24px 28px;
}

.compact {
  margin: 12px 0;
  padding: 16px 18px;
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  color: #9a3412;
  background: #fed7aa;
  border: 1px solid #fdba74;
  border-radius: var(--radius);
}

.body {
  min-width: 0;
  flex: 1 1 auto;
}

.label {
  font-size: 0.78rem;
  font-weight: 700;
  color: #c2410c;
}

.message {
  margin: 2px 0 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
  line-height: 1.5;
}

.action {
  flex: 0 0 auto;
  white-space: nowrap;
  border-color: #ea580c !important;
  background: #fff7ed !important;
  color: #9a3412 !important;

  &:hover {
    background: #ffedd5 !important;
    color: #7c2d12 !important;
  }
}

:global([data-theme="dark"]) .slot {
  border-color: #c2410c;
  background: linear-gradient(135deg, #2a170b 0%, var(--color-surface) 58%, #221807 100%);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.32),
    0 0 0 3px rgba(234, 88, 12, 0.18);
}

:global([data-theme="dark"]) .icon {
  color: #fed7aa;
  background: #7c2d12;
  border-color: #c2410c;
}

:global([data-theme="dark"]) .label {
  color: #fdba74;
}

:global([data-theme="dark"]) .action {
  border-color: #fb923c !important;
  background: #431407 !important;
  color: #fed7aa !important;

  &:hover {
    background: #7c2d12 !important;
    color: #ffedd5 !important;
  }
}

@media (max-width: 640px) {
  .slot {
    align-items: flex-start;
  }

  .action {
    align-self: center;
  }
}

@media (max-width: 520px) {
  .slot {
    flex-wrap: wrap;
  }

  .body {
    flex: 1 1 calc(100% - 48px);
  }

  .action {
    width: 100%;
  }
}
</style>

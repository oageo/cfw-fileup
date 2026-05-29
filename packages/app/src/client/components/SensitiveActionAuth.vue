<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '@vuetify/v0';
import { startAuthentication } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { apiPost } from '@/utils/api';
import { authStore, fetchCurrentUser, setToken } from '@/store/auth';
import TurnstileWidget from '@/components/TurnstileWidget.vue';
import type { ApiReq } from '../../shared/api';

const props = withDefaults(defineProps<{
	currentPassword?: string;
	title?: string;
	description?: string;
	passwordInputId?: string;
	passwordLabel?: string;
	passwordHint?: string;
	showPasswordFallback?: boolean;
	requireRecentWebAuthn?: boolean;
	turnstileEnabled?: boolean;
	turnstileSiteKey?: string;
	turnstileToken?: string | null;
}>(), {
	currentPassword: '',
	title: '本人確認',
	description: '重要な操作の前に、パスキーで本人確認します。',
	passwordInputId: 'sensitive-action-current-password',
	passwordLabel: '現在のパスワード',
	passwordHint: '',
	showPasswordFallback: true,
	requireRecentWebAuthn: false,
	turnstileEnabled: false,
	turnstileSiteKey: '',
	turnstileToken: null,
});

const emit = defineEmits<{
	'update:currentPassword': [value: string];
	'update:turnstileToken': [value: string | null];
	success: [message: string];
	error: [message: string];
}>();

const passkeyLoading = ref(false);
const recentlyAuthenticated = computed(() => authStore.user?.recentlyAuthenticated ?? false);
const canUsePasswordFallback = computed(() => props.showPasswordFallback && !props.requireRecentWebAuthn && (authStore.user?.hasPassword ?? true));
const passwordValue = computed({
	get: () => props.currentPassword,
	set: value => emit('update:currentPassword', value),
});
const turnstileValue = computed({
	get: () => props.turnstileToken,
	set: value => emit('update:turnstileToken', value),
});

async function reauthenticateWithPasskey(): Promise<void> {
	passkeyLoading.value = true;
	try {
		const beginResult = await apiPost('/api/passkey/authenticate/begin', { purpose: 'reauthenticate' });
		if (!beginResult.ok) {
			emit('error', beginResult.data.message || 'パスキー認証の開始に失敗しました');
			return;
		}

		let credential;
		try {
			credential = await startAuthentication({ optionsJSON: beginResult.data.options as unknown as PublicKeyCredentialRequestOptionsJSON });
		} catch (e) {
			emit('error', `パスキー認証がキャンセルされました: ${String(e)}`);
			return;
		}

		const finishResult = await apiPost('/api/passkey/authenticate/finish', {
			challengeId: beginResult.data.challengeId,
			credential: credential as unknown as ApiReq<'/api/passkey/authenticate/finish'>['credential'],
			purpose: 'reauthenticate',
		});
		if (!finishResult.ok) {
			emit('error', finishResult.data.message || 'パスキー認証に失敗しました');
			return;
		}

		setToken(finishResult.data.token);
		await fetchCurrentUser();
		emit('success', 'パスキーで再認証しました');
	} catch (e) {
		emit('error', String(e));
	} finally {
		passkeyLoading.value = false;
	}
}
</script>

<template>
  <div>
    <div :class="$style.header">
      <div>
        <h3 :class="$style.title">{{ title }}</h3>
        <p :class="$style.description">{{ description }}</p>
      </div>
    </div>

    <div v-if="recentlyAuthenticated" class="alert alert-success">再認証済みです。</div>
    <template v-else>
      <Button.Root class="btn btn-primary" :disabled="passkeyLoading" :loading="passkeyLoading" @click="reauthenticateWithPasskey">
        <Button.Loading>認証中...</Button.Loading>
        <Button.Content>パスキーで再認証</Button.Content>
      </Button.Root>

      <template v-if="canUsePasswordFallback">
        <div :class="$style.divider">または</div>
        <div :class="$style.formGroup">
          <label class="form-label" :for="passwordInputId">{{ passwordLabel }}</label>
          <input
            :id="passwordInputId"
            v-model="passwordValue"
            class="form-input"
            type="password"
            autocomplete="current-password"
          >
          <div v-if="passwordHint" class="form-hint">{{ passwordHint }}</div>
        </div>
        <TurnstileWidget
          v-if="turnstileEnabled && turnstileSiteKey && passwordValue.length > 0"
          :site-key="turnstileSiteKey"
          @update:token="turnstileValue = $event"
        />
      </template>
    </template>
  </div>
</template>

<style module lang="scss">
.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.title {
  margin: 0 0 6px;
  font-size: 1rem;
}

.description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.divider {
  margin: 14px 0 12px;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.formGroup {
  display: grid;
  gap: 6px;
}
</style>

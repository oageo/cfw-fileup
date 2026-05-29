<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Button, Form } from '@vuetify/v0';
import { apiPost, type ApiSuccess } from '@/utils/api';
import { authStore, fetchCurrentUser } from '@/store/auth';
import WalletRuntimeProvider from '@/components/WalletRuntimeProvider';
import WalletSettings from '@/components/WalletSettings.vue';
import TurnstileWidget from '@/components/TurnstileWidget.vue';
import SensitiveActionAuth from '@/components/SensitiveActionAuth.vue';

type LinkedMisskeyAccount = ApiSuccess<'/api/account/linked-misskey/list'>['data'][number];

const EMAIL_VERIFICATION_TOKEN_STORAGE_KEY = 'cfw_fileup_email_verification_token';

const indieauthProfileUrl = ref('');
const emailInput = ref('');
const currentPassword = ref('');
const googleLoading = ref(false);
const indieauthLoading = ref(false);
const emailLoading = ref(false);
const emailVerifyLoading = ref(false);
const turnstileEnabled = ref(false);
const turnstileSiteKey = ref('');
const emailVerifyTurnstileToken = ref<string | null>(null);
const linkTurnstileToken = ref<string | null>(null);
const pendingEmailVerificationToken = ref<string | null>(null);
const error = ref('');
const success = ref('');
const googleAuthEnabled = ref(false);
const misskeyAccounts = ref<LinkedMisskeyAccount[]>([]);

const hasGoogle = computed(() => authStore.user?.hasGoogle ?? false);
const recentlyAuthenticated = computed(() => authStore.user?.recentlyAuthenticated ?? false);
const passwordLinkReady = computed(() =>
	(authStore.user?.hasPassword ?? true)
	&& currentPassword.value.length > 0
	&& (!turnstileEnabled.value || linkTurnstileToken.value !== null),
);
const canStartLink = computed(() => recentlyAuthenticated.value || passwordLinkReady.value);
const googleLinkButtonLabel = computed(() => {
	if (hasGoogle.value) return '連携済み';
	if (!canStartLink.value) return '再認証してからGoogleを連携';
	return 'Googleを連携';
});
const emailStatus = computed(() => {
	if (!authStore.user?.email) return '未登録';
	return authStore.user.emailVerifiedAt === null ? '確認待ち' : '確認済み';
});

function getMisskeyProfileUrl(account: LinkedMisskeyAccount): string {
	return account.username ? `${account.issuer}/@${account.username}` : account.misskeyId;
}

async function loadMeta(): Promise<void> {
	try {
		const res = await fetch('/api/meta');
		if (!res.ok) return;
		const data = await res.json() as { googleAuthEnabled?: boolean; turnstileEnabled?: boolean; turnstileSiteKey?: string };
		googleAuthEnabled.value = data.googleAuthEnabled ?? false;
		turnstileEnabled.value = data.turnstileEnabled ?? false;
		turnstileSiteKey.value = data.turnstileSiteKey ?? '';
	} catch {
		googleAuthEnabled.value = false;
		turnstileEnabled.value = false;
		turnstileSiteKey.value = '';
	}
}

async function loadMisskeyAccounts(): Promise<void> {
	if (!authStore.user) return;
	const result = await apiPost('/api/account/linked-misskey/list');
	if (result.ok) misskeyAccounts.value = result.data;
}

function consumeCallbackParams(): void {
	const url = new URL(location.href);
	const linkSuccess = url.searchParams.get('link_success');
	const linkError = url.searchParams.get('link_error');
	const emailVerificationToken = url.searchParams.get('email_verification_token');
	if (!linkSuccess && !linkError && !emailVerificationToken) return;

	url.searchParams.delete('link_success');
	url.searchParams.delete('link_error');
	url.searchParams.delete('email_verification_token');
	history.replaceState({}, '', url.toString());

	if (emailVerificationToken) {
		pendingEmailVerificationToken.value = emailVerificationToken;
		sessionStorage.setItem(EMAIL_VERIFICATION_TOKEN_STORAGE_KEY, emailVerificationToken);
	}

	if (linkSuccess === 'google') success.value = 'Googleアカウントを連携しました';
	if (linkSuccess === 'misskey') success.value = 'Misskeyアカウントを連携しました';

	if (linkError) {
		const messages: Record<string, string> = {
			account_already_linked: 'この外部アカウントは別のユーザーに連携済みです',
			already_linked: 'このサービスはすでに連携済みです',
			link_failed: 'アカウント連携に失敗しました',
		};
		error.value = messages[linkError] ?? `アカウント連携エラー: ${linkError}`;
	}
}

async function saveEmail(): Promise<void> {
	error.value = '';
	success.value = '';
	emailLoading.value = true;
	try {
		const trimmed = emailInput.value.trim();
		const result = await apiPost('/api/account/email/update', { email: trimmed === '' ? null : trimmed });
		if (!result.ok) {
			error.value = result.data.message || 'メール設定の更新に失敗しました';
			return;
		}
		await fetchCurrentUser();
		emailInput.value = result.data.email ?? '';
		success.value = result.data.email ? '確認メールを送信しました' : 'メールアドレスを解除しました';
	} catch (e) {
		error.value = String(e);
	} finally {
		emailLoading.value = false;
	}
}

async function resendVerificationEmail(): Promise<void> {
	error.value = '';
	success.value = '';
	emailLoading.value = true;
	try {
		const result = await apiPost('/api/account/email/resend-verification');
		if (!result.ok) {
			error.value = result.data.message || '確認メールの送信に失敗しました';
			return;
		}
		success.value = '確認メールを再送しました';
	} catch (e) {
		error.value = String(e);
	} finally {
		emailLoading.value = false;
	}
}

async function verifyEmail(token: string): Promise<void> {
	error.value = '';
	success.value = '';
	if (turnstileEnabled.value && !emailVerifyTurnstileToken.value) {
		pendingEmailVerificationToken.value = token;
		return;
	}
	emailVerifyLoading.value = true;
	try {
		const result = await apiPost('/api/account/email/verify', {
			token,
			turnstileToken: turnstileEnabled.value && emailVerifyTurnstileToken.value ? emailVerifyTurnstileToken.value : undefined,
		});
		if (!result.ok) {
			error.value = result.data.message || 'メール確認に失敗しました';
			return;
		}
		await fetchCurrentUser();
		emailInput.value = result.data.email;
		pendingEmailVerificationToken.value = null;
		emailVerifyTurnstileToken.value = null;
		sessionStorage.removeItem(EMAIL_VERIFICATION_TOKEN_STORAGE_KEY);
		success.value = 'メールアドレスを確認しました';
	} catch (e) {
		error.value = String(e);
	} finally {
		emailVerifyLoading.value = false;
	}
}

async function linkGoogle(): Promise<void> {
	error.value = '';
	success.value = '';
	googleLoading.value = true;
	try {
		const result = await apiPost('/api/account/link/google/begin', {
			currentPassword: currentPassword.value || undefined,
			turnstileToken: currentPassword.value ? linkTurnstileToken.value ?? undefined : undefined,
		});
		if (!result.ok) {
			error.value = result.data.message || 'Google連携の開始に失敗しました';
			return;
		}
		location.href = result.data.url;
	} catch (e) {
		error.value = String(e);
	} finally {
		googleLoading.value = false;
	}
}

async function linkIndieAuth({ valid }: { valid: boolean }): Promise<void> {
	if (!valid) return;
	error.value = '';
	success.value = '';
	const profileUrl = indieauthProfileUrl.value.trim();
	if (!profileUrl) {
		error.value = 'プロフィールURLを入力してください';
		return;
	}

	indieauthLoading.value = true;
	try {
		const result = await apiPost('/api/account/link/indieauth/begin', {
			profileUrl,
			currentPassword: currentPassword.value || undefined,
			turnstileToken: currentPassword.value ? linkTurnstileToken.value ?? undefined : undefined,
		});
		if (!result.ok) {
			error.value = result.data.message || 'Misskey連携の開始に失敗しました';
			return;
		}
		location.href = result.data.url;
	} catch (e) {
		error.value = String(e);
	} finally {
		indieauthLoading.value = false;
	}
}

onMounted(async () => {
	consumeCallbackParams();
	await Promise.all([fetchCurrentUser(), loadMeta()]);
	pendingEmailVerificationToken.value ??= sessionStorage.getItem(EMAIL_VERIFICATION_TOKEN_STORAGE_KEY);
	emailInput.value = authStore.user?.email ?? '';
	if (authStore.user && pendingEmailVerificationToken.value && !turnstileEnabled.value) {
		await verifyEmail(pendingEmailVerificationToken.value);
	}
	await loadMisskeyAccounts();
});
</script>

<template>
  <div>
    <div class="section-header">
      <h2 class="section-title">アカウント連携</h2>
    </div>

      <div v-if="success" class="alert alert-success mb-4">{{ success }}</div>
      <div v-if="error" class="alert alert-error mb-4">{{ error }}</div>
      <div v-if="pendingEmailVerificationToken && turnstileEnabled && !authStore.user?.emailVerifiedAt" :class="['card', $style.card]">
        <div :class="$style.serviceHeader">
          <div>
            <h3 :class="$style.serviceTitle">メールアドレス確認</h3>
            <p :class="$style.serviceDescription">確認を完了するには認証が必要です。</p>
          </div>
        </div>
        <TurnstileWidget
          v-if="turnstileSiteKey"
          :site-key="turnstileSiteKey"
          @update:token="emailVerifyTurnstileToken = $event"
        />
        <Button.Root
          class="btn btn-primary"
          :class="$style.verifyButton"
          :disabled="emailVerifyLoading || !emailVerifyTurnstileToken"
          :loading="emailVerifyLoading"
          @click="verifyEmail(pendingEmailVerificationToken)"
        >
          <Button.Loading>確認中...</Button.Loading>
          <Button.Content>メールアドレスを確認</Button.Content>
        </Button.Root>
      </div>
      <div v-if="!authStore.user" class="alert alert-info">ログインが必要です。</div>

    <template v-else>
      <div :class="['card', $style.card]">
        <div :class="$style.serviceHeader">
          <div>
            <h3 :class="$style.serviceTitle">メール通知</h3>
            <p :class="$style.serviceDescription">ログイン、購入、容量超過のお知らせを受け取るメールアドレスを設定します。</p>
          </div>
          <span :class="['badge', authStore.user.emailVerifiedAt ? 'badge-success' : 'badge-info']">{{ emailStatus }}</span>
        </div>
        <Form :class="$style.form" @submit="saveEmail">
          <div :class="$style.formGroup">
            <label class="form-label" for="account-email">メールアドレス</label>
            <input id="account-email" v-model="emailInput" class="form-input" type="email" autocomplete="email" placeholder="name@example.com">
          </div>
          <div :class="$style.actions">
            <button class="btn btn-primary" type="submit" :disabled="emailLoading || emailVerifyLoading">
              {{ emailLoading ? '処理中...' : '保存' }}
            </button>
            <Button.Root
              v-if="authStore.user.email && !authStore.user.emailVerifiedAt"
              class="btn btn-ghost"
              :disabled="emailLoading"
              @click="resendVerificationEmail"
            >
              <Button.Content>確認メールを再送</Button.Content>
            </Button.Root>
          </div>
        </Form>
      </div>

      <SensitiveActionAuth
        v-model:currentPassword="currentPassword"
        :class="['card', $style.card]"
        description="外部アカウント連携の前に、パスキーで本人確認します。パスワード設定済みの場合だけ、現在のパスワードでも続行できます。"
        password-input-id="account-link-current-password"
        password-hint="パスキーで再認証した場合、この入力は不要です。"
        :turnstile-enabled="turnstileEnabled"
        :turnstile-site-key="turnstileSiteKey"
        v-model:turnstile-token="linkTurnstileToken"
        @success="(message: string) => { error = ''; success = message; }"
        @error="(message: string) => { success = ''; error = message; }"
      />

      <div v-if="googleAuthEnabled" :class="['card', $style.card]">
        <div :class="$style.serviceHeader">
          <div>
            <h3 :class="$style.serviceTitle">Google</h3>
            <p :class="$style.serviceDescription">Googleアカウントでログインできるようにします。</p>
          </div>
          <span :class="['badge', hasGoogle ? 'badge-success' : 'badge-info']">
            {{ hasGoogle ? '連携済み' : '未連携' }}
          </span>
        </div>
        <div v-if="!hasGoogle && !canStartLink" class="alert alert-info mb-3">
          Googleを連携するには、本人確認欄でパスキーかパスワードで再認証してください。
        </div>
        <Button.Root class="btn btn-primary" :disabled="googleLoading || hasGoogle || !canStartLink" :loading="googleLoading" @click="linkGoogle">
          <Button.Loading>処理中...</Button.Loading>
          <Button.Content>{{ googleLinkButtonLabel }}</Button.Content>
        </Button.Root>
      </div>

      <div :class="['card', $style.card]">
        <div :class="$style.serviceHeader">
          <div>
            <h3 :class="$style.serviceTitle">Misskey</h3>
            <p :class="$style.serviceDescription">MisskeyのプロフィールURLから外部アカウントを連携します。</p>
          </div>
          <span :class="['badge', misskeyAccounts.length > 0 ? 'badge-success' : 'badge-info']">
            {{ misskeyAccounts.length > 0 ? `${misskeyAccounts.length}件連携済み` : '未連携' }}
          </span>
        </div>
        <div v-if="!canStartLink" class="alert alert-info mb-3">
          Misskeyを連携するには、本人確認欄でパスキーかパスワードで再認証してください。
        </div>
        <Form :class="$style.form" @submit="linkIndieAuth">
          <div :class="$style.formGroup">
            <label class="form-label" for="indieauth-profile-url">プロフィールURL</label>
            <input id="indieauth-profile-url" v-model="indieauthProfileUrl" class="form-input" type="url" placeholder="https://misskey.io/@username">
          </div>
          <button class="btn btn-primary" type="submit" :disabled="indieauthLoading || !canStartLink">
            {{ indieauthLoading ? '処理中...' : 'Misskeyを連携' }}
          </button>
        </Form>
        <div v-if="misskeyAccounts.length > 0" :class="$style.linkedList">
          <div v-for="account in misskeyAccounts" :key="account.id" :class="$style.linkedItem">
            <div :class="$style.linkedName">{{ account.name || account.username || account.misskeyId }}</div>
            <a :href="getMisskeyProfileUrl(account)" target="_blank" rel="noopener noreferrer" :class="$style.linkedLink">
              {{ getMisskeyProfileUrl(account) }}
            </a>
          </div>
        </div>
      </div>

      <WalletRuntimeProvider>
        <WalletSettings />
      </WalletRuntimeProvider>
    </template>
  </div>
</template>

<style module lang="scss">
.card {
  max-width: 720px;
  margin-bottom: 16px;
}

.serviceHeader {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.serviceTitle {
  margin: 0 0 6px;
  font-size: 1rem;
}

.serviceDescription {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}

.form {
  display: grid;
  gap: 12px;
}

.formGroup {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.verifyButton {
  margin-top: 12px;
}

.linkedList {
  display: grid;
  gap: 8px;
  margin-top: 16px;
}

.linkedItem {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 12px;
}

.linkedName {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.linkedLink {
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 0.875rem;
  overflow-wrap: anywhere;
  text-decoration: none;
}

.linkedLink:hover {
  color: var(--color-primary);
  text-decoration: underline;
}

@media (max-width: 600px) {
  .linkedItem {
    flex-direction: column;
  }
}
</style>

<script setup lang="ts">
import { ref, computed, defineComponent, h, watch } from 'vue';
import { Button, Popover, useTheme } from '@vuetify/v0';
import { CircleFadingArrowUp, Moon, Sun, Upload, User } from '@lucide/vue';
import { mainRouter } from './router';
import { fetchCurrentUser, authStore, clearAuth } from './store/auth';
import { navigateFn } from './navigate';
import NirA from './components/nira.vue';
import { connectUploadWorker, latestActiveUploadJob, latestUploadJob } from './store/upload-worker';

navigateFn.value = (path) => mainRouter.pushByPath(path);

const theme = useTheme();
const isDark = theme.isDark;

const appNavOpen = ref(false);

function closeAppNav() {
  appNavOpen.value = false;
};

const isReady = ref(false);
const navUploadPercent = computed(() => {
	const job = latestUploadJob.value;
	if (job?.status === 'done') return 100;
	if (!job || job.totalBytes <= 0) return 0;
	return Math.min(100, Math.round(job.uploadedBytes / job.totalBytes * 100));
});
const navUploadLink = computed(() => {
	const job = latestUploadJob.value;
	if (!job) return '/my/uploadings?tab=browser';
	if (job.status === 'done' && job.completedPath) return `/v/${job.bucketName}/${job.completedPath}`;
	return '/my/uploadings?tab=browser';
});
const navUploadText = computed(() => {
	const job = latestUploadJob.value;
	if (!job) return '';
	if (job.status === 'done') return `完了: ${job.completedPath ?? job.filename}`;
	if (job.status === 'error') return `エラー: ${job.filename || job.prefix || 'アップロード'}`;
	return job.filename || 'アップロード準備中';
});

(async () => {
	await fetchCurrentUser();
	if (authStore.user) connectUploadWorker();
	isReady.value = true;
})();

watch(() => authStore.user, (user) => {
	if (user) connectUploadWorker();
});

const CurrentPage = computed(() => {
	const resolved = mainRouter.currentRef.value;
	if (!resolved) return null;
	const route = resolved.route;
	if (!('component' in route)) return null;
	const component = route.component;
	const propsMap = resolved.props;
	return defineComponent({
		render() {
			const props: Record<string, unknown> = {};
			propsMap.forEach((v, k) => { props[k] = v; });
			return h(component, props);
		},
	});
});

function logout(): void {
	clearAuth();
	mainRouter.pushByPath('/');
}

function toggleTheme(): void {
	theme.cycle(['light', 'dark']);
}
</script>

<template>
  <div class="app-layout">
    <header class="app-nav">
      <div class="app-nav-inner">
        <NirA to="/" class="app-nav-brand">CFW FileUp</NirA>

        <div class="app-nav-links">
          <NirA to="/my/buckets" class="app-nav-link">マイバケット</NirA>
          <template v-if="authStore.user?.isAdmin">
            <NirA to="/admin" class="app-nav-link">管理</NirA>
          </template>
        </div>

        <div class="app-nav-spacer" />

        <Button.Root class="btn btn-ghost btn-icon" :aria-label="isDark ? 'ライトモードに切替' : 'ダークモードに切替'" @click="toggleTheme">
          <Button.Content>
            <Sun v-if="isDark" :size="16" :stroke-width="2" />
            <Moon v-else :size="16" :stroke-width="2" />
          </Button.Content>
        </Button.Root>

        <div class="app-nav-user">
          <template v-if="authStore.user">
            <Popover.Root v-model="appNavOpen">
              <Popover.Activator class="btn btn-ghost app-nav-username" aria-haspopup="true">
                <User :size="16" :stroke-width="2" />{{ authStore.user.username }}
              </Popover.Activator>
              <Popover.Content class="app-nav-user-menu">
                <div class="app-nav-user-menu-inner">
                  <Button.Root :as="NirA" to="/my/uploadings" class="btn btn-ghost w-full" @click="closeAppNav">
                    <Button.Content>アップロード状況</Button.Content>
                  </Button.Root>
                  <Button.Root :as="NirA" to="/my/passkeys" class="btn btn-ghost w-full" @click="closeAppNav">
                    <Button.Content>パスキー</Button.Content>
                  </Button.Root>
                  <Button.Root class="btn btn-ghost w-full" @click="logout">
                    <Button.Content>ログアウト</Button.Content>
                  </Button.Root>
                </div>
              </Popover.Content>
            </Popover.Root>
          </template>
          <template v-else>
            <NirA to="/signin" class="btn btn-primary">サインイン</NirA>
          </template>
        </div>
      </div>
      <div v-if="authStore.user" class="app-upload-strip">
        <NirA to="/uploader" class="app-upload-button" aria-label="ファイルアップロード">
          <span class="app-upload-icon" aria-hidden="true">
            <Upload :size="16" :stroke-width="2" />
          </span>
          <span>アップロード</span>
        </NirA>
        <NirA v-if="latestUploadJob" :to="navUploadLink" class="app-upload-status">
          <span class="app-upload-text">
            {{ navUploadText }}
          </span>
          <span class="app-upload-percent">{{ navUploadPercent }}%</span>
        </NirA>
        <NirA to="/my/uploadings?tab=browser" class="app-upload-history-button" aria-label="アップロード履歴">
          <CircleFadingArrowUp :size="16" :stroke-width="2" />
        </NirA>
        <span v-if="latestUploadJob" class="app-upload-progress" aria-hidden="true">
          <span class="app-upload-progress-fill" :style="{ width: `${navUploadPercent}%` }" />
        </span>
      </div>
    </header>

    <main class="app-main">
      <div v-if="!isReady" class="page-loading">
        <span class="spinner" />
        読み込み中...
      </div>
      <component :is="CurrentPage" v-else-if="CurrentPage" />
    </main>
  </div>
</template>

<style module lang="scss">

</style>

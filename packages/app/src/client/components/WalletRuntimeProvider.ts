import { defineComponent, Fragment, h, inject, ref, shallowRef, provide, type App, type InjectionKey, type PropType } from 'vue';
import { QueryClient, VueQueryPlugin, type QueryClient as QueryClientInstance } from '@tanstack/vue-query';
import { WagmiPlugin } from '@wagmi/vue';
import { createWagmiConfig } from '@/wagmi';
import Loading from './Loading.vue';
import ErrorComponent from './Error.vue';

type WagmiConfig = Awaited<ReturnType<typeof createWagmiConfig>>;

type WalletRuntime = {
	config: WagmiConfig;
	queryClient: QueryClientInstance;
};

type ReloadWalletRuntime = () => void;

const reloadWalletRuntimeKey: InjectionKey<ReloadWalletRuntime> = Symbol('reloadWalletRuntime');

let walletRuntimePromise: Promise<WalletRuntime> | null = null;

type WalletRuntimeMeta = {
	appName: string;
	reownProjectId: string;
	walletConnectChainIds: number[];
};

function getWalletConnectChainIds(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value.filter((chainId): chainId is number => Number.isSafeInteger(chainId) && chainId > 0);
}

async function getWalletRuntimeMeta(): Promise<WalletRuntimeMeta> {
	try {
		const res = await fetch('/api/meta');
		if (!res.ok) return { appName: 'CFW FileUp', reownProjectId: '', walletConnectChainIds: [] };
		const meta = await res.json() as { appName?: unknown; reownProjectId?: unknown; walletConnectChainIds?: unknown };
		return {
			appName: typeof meta.appName === 'string' && meta.appName.trim() !== '' ? meta.appName.trim() : 'CFW FileUp',
			reownProjectId: typeof meta.reownProjectId === 'string' ? meta.reownProjectId : '',
			walletConnectChainIds: getWalletConnectChainIds(meta.walletConnectChainIds),
		};
	} catch {
		return { appName: 'CFW FileUp', reownProjectId: '', walletConnectChainIds: [] };
	}
}

function getWalletRuntime(): Promise<WalletRuntime> {
	walletRuntimePromise ??= (async () => {
		const meta = await getWalletRuntimeMeta();
		return {
			config: await createWagmiConfig(meta.reownProjectId, meta.walletConnectChainIds, meta.appName),
			queryClient: new QueryClient(),
		};
	})();

	return walletRuntimePromise;
}

export function useWalletRuntimeReload(): ReloadWalletRuntime {
	return inject(reloadWalletRuntimeKey, () => undefined);
}

const WalletRuntimeReady = defineComponent({
	name: 'WalletRuntimeReady',
	props: {
		config: {
			type: Object as PropType<WagmiConfig>,
			required: true,
		},
		queryClient: {
			type: Object as PropType<QueryClientInstance>,
			required: true,
		},
		reload: {
			type: Function as PropType<ReloadWalletRuntime>,
			required: true,
		},
	},
	setup(props, { slots }) {
		const app = {
			provide(key, value) {
				provide(key as InjectionKey<unknown>, value);
				return app;
			},
		} as App;

		VueQueryPlugin.install?.(app, { queryClient: props.queryClient });
		WagmiPlugin.install?.(app, { config: props.config });
		provide(reloadWalletRuntimeKey, props.reload);

		return () => h(Fragment, {}, slots.default?.());
	},
});

export default defineComponent({
	name: 'WalletRuntimeProvider',
	setup(_, { slots }) {
		const runtime = shallowRef<WalletRuntime | null>(null);
		const error = shallowRef<Error | null>(null);
		const runtimeKey = ref(0);
		let loadId = 0;

		async function loadRuntime(reset: boolean): Promise<void> {
			const currentLoadId = ++loadId;
			error.value = null;
			runtime.value = null;
			if (reset) {
				walletRuntimePromise = null;
				runtimeKey.value += 1;
			}
			try {
				const nextRuntime = await getWalletRuntime();
				if (currentLoadId !== loadId) return;
				runtime.value = nextRuntime;
			} catch (e) {
				if (currentLoadId !== loadId) return;
				error.value = e instanceof globalThis.Error ? e : new globalThis.Error(String(e));
			}
		}

		function reloadWalletRuntime(): void {
			void loadRuntime(true);
		}

		void loadRuntime(false);

		return () => {
			if (error.value) return h(ErrorComponent, { error: error.value });
			if (!runtime.value) return h(Loading);

			return h(WalletRuntimeReady, {
				key: runtimeKey.value,
				config: runtime.value.config,
				queryClient: runtime.value.queryClient,
				reload: reloadWalletRuntime,
			}, slots);
		};
	},
});

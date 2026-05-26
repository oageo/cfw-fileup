import { defineComponent, Fragment, h, shallowRef, provide, type App, type InjectionKey, type PropType } from 'vue';
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

let walletRuntimePromise: Promise<WalletRuntime> | null = null;

type WalletRuntimeMeta = {
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
		if (!res.ok) return { reownProjectId: '', walletConnectChainIds: [] };
		const meta = await res.json() as { reownProjectId?: unknown; walletConnectChainIds?: unknown };
		return {
			reownProjectId: typeof meta.reownProjectId === 'string' ? meta.reownProjectId : '',
			walletConnectChainIds: getWalletConnectChainIds(meta.walletConnectChainIds),
		};
	} catch {
		return { reownProjectId: '', walletConnectChainIds: [] };
	}
}

function getWalletRuntime(): Promise<WalletRuntime> {
	walletRuntimePromise ??= (async () => {
		const meta = await getWalletRuntimeMeta();
		return {
			config: await createWagmiConfig(meta.reownProjectId, meta.walletConnectChainIds),
			queryClient: new QueryClient(),
		};
	})();

	return walletRuntimePromise;
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

		return () => h(Fragment, {}, slots.default?.());
	},
});

export default defineComponent({
	name: 'WalletRuntimeProvider',
	setup(_, { slots }) {
		const runtime = shallowRef<WalletRuntime | null>(null);
		const error = shallowRef<Error | null>(null);

		void (async () => {
			try {
				runtime.value = await getWalletRuntime();
			} catch (e) {
				error.value = e instanceof globalThis.Error ? e : new globalThis.Error(String(e));
			}
		})();

		return () => {
			if (error.value) return h(ErrorComponent, { error: error.value });
			if (!runtime.value) return h(Loading);

			return h(WalletRuntimeReady, runtime.value, slots);
		};
	},
});

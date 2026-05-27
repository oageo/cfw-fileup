import { createConfig, http, injected } from '@wagmi/vue';
import { arbitrum, base, mainnet, optimism, polygon, sepolia } from '@wagmi/vue/chains';
import type { Chain } from 'viem';
import { getChainMetadata } from '@/utils/chain-metadata';

const defaultChains = [mainnet, sepolia, base, polygon, arbitrum, optimism] as const satisfies readonly Chain[];
type ConnectorFactory = NonNullable<Parameters<typeof createConfig>[0]['connectors']>[number];

async function resolveChains(walletConnectChainIds: readonly number[]): Promise<[Chain, ...Chain[]]> {
	const chainsById = new Map<number, Chain>();

	for (const chain of defaultChains) {
		chainsById.set(chain.id, chain);
	}

	if (walletConnectChainIds.length > 0) {
		const chains = await Promise.all(walletConnectChainIds.map(async chainId => await getChainMetadata(chainId).catch(() => null)));
		for (const chain of chains) if (chain) chainsById.set(chain.id, chain as Chain);
	}

	const chains = [...chainsById.values()];
	return chains as [Chain, ...Chain[]];
}

function withoutEagerSetup(connectorFactory: ConnectorFactory): ConnectorFactory {
	return config => {
		const connector = connectorFactory(config);
		return {
			...connector,
			setup: undefined,
		};
	};
}

export async function createWagmiConfig(reownProjectId: string, walletConnectChainIds: readonly number[] = [], appName = 'CFW FileUp') {
	const chains = await resolveChains(walletConnectChainIds);
	const connectors = reownProjectId ? await (async () => {
		const { walletConnect } = await import('@wagmi/vue/connectors');
		return [
			injected(),
			withoutEagerSetup(walletConnect({
				projectId: reownProjectId,
				isNewChainsStale: false,
				metadata: {
					name: appName,
					description: `Upload files to ${appName}.`,
					url: window.location.origin,
					icons: [`${window.location.origin}/icon.any-192.png`],
				},
				showQrModal: true,
			})),
		];
	})() : [
		injected(),
	];

	return createConfig({
		chains,
		connectors,
		transports: Object.fromEntries(chains.map(chain => [chain.id, http()])),
	});
}

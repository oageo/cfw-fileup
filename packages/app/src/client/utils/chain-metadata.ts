import type { Chain } from 'viem';

declare const __VIEM_VERSION__: string;

export type ChainMetadata = Pick<Chain, 'id' | 'name' | 'nativeCurrency' | 'rpcUrls' | 'blockExplorers' | 'testnet'>;

const chainMetadataPromises = new Map<number, Promise<ChainMetadata>>();

function isChainMetadata(value: unknown): value is ChainMetadata {
	if (typeof value !== 'object' || value === null) return false;
	const chain = value as Partial<ChainMetadata>;
	return typeof chain.id === 'number'
		&& typeof chain.name === 'string'
		&& typeof chain.nativeCurrency === 'object'
		&& chain.nativeCurrency !== null
		&& typeof chain.nativeCurrency.name === 'string'
		&& typeof chain.nativeCurrency.symbol === 'string'
		&& typeof chain.nativeCurrency.decimals === 'number'
		&& typeof chain.rpcUrls === 'object'
		&& chain.rpcUrls !== null
		&& typeof chain.rpcUrls.default === 'object'
		&& chain.rpcUrls.default !== null
		&& Array.isArray(chain.rpcUrls.default.http)
		&& chain.rpcUrls.default.http.every(url => typeof url === 'string');
}

export async function getChainMetadata(chainId: number): Promise<ChainMetadata | null> {
	if (!Number.isSafeInteger(chainId) || chainId <= 0) return null;
	const existingPromise = chainMetadataPromises.get(chainId);
	if (existingPromise) return await existingPromise;

	const promise = (async () => {
		const res = await fetch(`/assets/chains/${encodeURIComponent(__VIEM_VERSION__)}/${chainId}.json`);
		if (res.status === 404) throw new Error(`chain ${chainId} は viem/chains に見つかりません`);
		if (!res.ok) throw new Error(`chain ${chainId} のメタデータ取得に失敗しました`);
		const contentType = res.headers.get('content-type') ?? '';
		if (!contentType.toLowerCase().includes('application/json')) {
			throw new Error(`chain ${chainId} のメタデータがJSONではありません`);
		}
		const data = await res.json() as unknown;
		if (!isChainMetadata(data) || data.id !== chainId) throw new Error(`chain ${chainId} のメタデータが不正です`);
		return data;
	})();

	chainMetadataPromises.set(chainId, promise);
	try {
		return await promise;
	} catch (error) {
		chainMetadataPromises.delete(chainId);
		throw error;
	}
}

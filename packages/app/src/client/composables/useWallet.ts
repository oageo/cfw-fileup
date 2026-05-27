import { computed, onScopeDispose, ref, shallowRef, toRaw } from 'vue';
import {
	ChainNotConfiguredError,
	useChainId,
	useConnection,
	useConnect,
	useConfig,
	useConnectors,
	useSendTransaction,
	useSignMessage,
	useSwitchChain,
	useSwitchConnection,
	useWaitForTransactionReceipt,
	type Connector,
} from '@wagmi/vue';
import { getAddress, toHex, type Address, type Hex, type TransactionReceipt } from 'viem';

type ConnectedWallet = {
	address: Address;
	chainId: number;
};

type WalletConnectorOption = {
	uid: string;
	id: string;
	name: string;
	type: string;
};

type ConnectedWalletConnection = {
	address: Address;
	chainId: number;
	connectorUid: string;
	connectorId: string;
	connectorName: string;
};

type WaitForWalletTransactionReceiptOptions = {
	chainId: number;
	confirmations?: number;
	pollingInterval?: number;
	timeout?: number;
};

type WalletChainConfig = {
	chainId: number;
	name: string;
	nativeCurrencyName: string;
	nativeCurrencySymbol: string;
	nativeCurrencyDecimals: number;
	rpcUrls: string[];
	blockExplorerUrl: string | null;
};

type WalletTokenConfig = {
	address: Address;
	symbol: string;
	decimals: number;
	image?: string;
};

type WalletProvider = {
	request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
};

type WalletConnectionLike = {
	accounts: readonly Address[];
	chainId: number;
	connector: Connector;
};

type WalletConfig = ReturnType<typeof useConfig>;

function chainIdHex(chainId: number): `0x${string}` {
	return `0x${chainId.toString(16)}`;
}

function getErrorCode(error: unknown): number | string | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const maybeError = error as { code?: unknown };
	return typeof maybeError.code === 'number' || typeof maybeError.code === 'string' ? maybeError.code : undefined;
}

function isChainNotConfiguredError(error: unknown): boolean {
	if (error instanceof ChainNotConfiguredError) return true;
	if (!(error instanceof Error)) return false;
	if (error.message.includes('Chain not configured')) return true;
	const cause = error.cause;
	return cause instanceof Error && isChainNotConfiguredError(cause);
}

function isWalletConnectStaleSessionError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	// WalletConnect reports this when the wallet has already deleted the session topic.
	return message.includes('No matching key')
		&& message.includes('session topic');
}

function isWalletConnectStorageKey(key: string): boolean {
	const normalized = key.toLowerCase();
	return normalized.includes('walletconnect')
		|| normalized.includes('wallet_connect')
		|| normalized.includes('wc@');
}

async function deleteBrowserDatabase(name: string): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	await new Promise<void>((resolve) => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
		request.onblocked = () => resolve();
	});
}

function removeWalletConnection(config: WalletConfig, connectorUid: string): void {
	config.setState((state) => {
		const connections = new Map(state.connections);
		connections.delete(connectorUid);
		if (connections.size === 0) {
			return {
				...state,
				connections,
				current: null,
				status: 'disconnected',
			};
		}
		const nextConnection = connections.values().next().value as WalletConnectionLike;
		return {
			...state,
			connections,
			current: state.current === connectorUid ? rawConnector(nextConnection.connector).uid : state.current,
			status: 'connected',
		};
	});
}

function parseHexQuantity(value: unknown): bigint | null {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
	return BigInt(value);
}

function parseWalletChainId(value: unknown): number | null {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
	const hex = parseHexQuantity(value);
	if (hex !== null) {
		const chainId = Number(hex);
		return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
	}
	if (typeof value !== 'string') return null;
	const chainId = Number(value);
	return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function rawConnector(connector: Connector): Connector {
	return toRaw(connector);
}

function isSameWalletConnector(left: Connector, right: Connector): boolean {
	return left.uid === right.uid || left.id === right.id;
}

function formatWalletConnectorName(connector: Connector): string {
	const connectorRaw = rawConnector(connector);
	if (connectorRaw.id === 'injected' && connectorRaw.name === 'Injected') return 'ブラウザウォレット';
	return connectorRaw.name;
}

function getWalletConnectorOptions(connectors: readonly Connector[]): WalletConnectorOption[] {
	const connectorRaws = connectors.map(rawConnector);
	const hasSpecificInjectedConnector = connectorRaws.some(connector => connector.type === 'injected' && connector.id !== 'injected');

	return connectorRaws
		.filter(connector => !(hasSpecificInjectedConnector && connector.id === 'injected' && connector.name === 'Injected'))
		.map(connector => ({
			uid: connector.uid,
			id: connector.id,
			name: formatWalletConnectorName(connector),
			type: connector.type,
		}));
}

function getWalletConnectionSnapshots(connections: Iterable<WalletConnectionLike>): ConnectedWalletConnection[] {
	return Array.from(connections).flatMap(connection => {
		const connectionRaw = toRaw(connection);
		const connectorRaw = rawConnector(connectionRaw.connector);
		return connectionRaw.accounts.map(account => ({
			address: account,
			chainId: connectionRaw.chainId,
			connectorUid: connectorRaw.uid,
			connectorId: connectorRaw.id,
			connectorName: formatWalletConnectorName(connectorRaw),
		}));
	});
}

function getWalletConnectionKey(connections: readonly ConnectedWalletConnection[]): string {
	return connections
		.map(connection => `${connection.connectorUid}:${connection.chainId}:${connection.address.toLowerCase()}`)
		.sort()
		.join('|');
}

export function useWallet() {
	const config = useConfig();
	const { address, chainId: accountChainId, connector: activeConnector } = useConnection();
	const currentChainId = useChainId();
	const connectors = useConnectors();
	const { mutateAsync: connectMutationAsync } = useConnect();
	const { mutateAsync: signMessageMutationAsync } = useSignMessage();
	const { mutateAsync: switchChainMutationAsync } = useSwitchChain();
	const { mutateAsync: switchConnectionMutationAsync } = useSwitchConnection();
	const { mutateAsync: sendTransactionMutationAsync } = useSendTransaction();
	const connectedWalletConnectionSnapshots = shallowRef<ConnectedWalletConnection[]>(
		getWalletConnectionSnapshots(config.state.connections.values()),
	);

	const unsubscribeConnections = config.subscribe(
		state => getWalletConnectionSnapshots(state.connections.values()),
		connections => {
			connectedWalletConnectionSnapshots.value = connections;
		},
		{
			equalityFn: (previous, next) => getWalletConnectionKey(previous) === getWalletConnectionKey(next),
		},
	);
	onScopeDispose(() => {
		unsubscribeConnections();
	});

	const receiptHash = ref<Hex>();
	const receiptChainId = ref<number>();
	const receiptConfirmations = ref(1);
	const receiptPollingInterval = ref<number>();
	const receiptTimeout = ref<number>();
	const receiptQuery = useWaitForTransactionReceipt({
		hash: receiptHash,
		chainId: receiptChainId,
		confirmations: receiptConfirmations,
		pollingInterval: receiptPollingInterval,
		timeout: receiptTimeout,
		query: {
			enabled: false,
			retry: false,
		},
	} as Parameters<typeof useWaitForTransactionReceipt>[0]);

	const walletAddress = computed(() => address.value);
	const walletChainId = computed(() => accountChainId.value);
	const activeWalletConnectorUid = computed(() => activeConnector.value ? rawConnector(activeConnector.value).uid : null);
	const connectedWalletConnections = computed<ConnectedWalletConnection[]>(() => connectedWalletConnectionSnapshots.value);
	const walletConnectors = computed<WalletConnectorOption[]>(() => getWalletConnectorOptions(connectors.value));

	function findWalletConnector(connectorUid?: string | null): Connector | undefined {
		if (connectorUid) {
			const connector = connectors.value.find(connector => {
				const connectorRaw = rawConnector(connector);
				return connectorRaw.uid === connectorUid || connectorRaw.id === connectorUid;
			});
			return connector ? rawConnector(connector) : undefined;
		}
		if (activeConnector.value) return rawConnector(activeConnector.value);
		const connector = connectors.value[0];
		return connector ? rawConnector(connector) : undefined;
	}

	function getWalletConnector(connectorUid?: string | null): Connector {
		const connector = findWalletConnector(connectorUid);
		if (!connector) throw new Error('Ethereum wallet が見つかりません');
		return connector;
	}

	async function getWalletProvider(connectorUid?: string | null): Promise<WalletProvider> {
		const provider = await rawConnector(getWalletConnector(connectorUid)).getProvider?.() as WalletProvider | undefined;
		if (!provider) throw new Error('Ethereum wallet が見つかりません');
		return provider;
	}

	async function getWalletProviderChainId(provider: WalletProvider): Promise<number | null> {
		return parseWalletChainId(await provider.request({ method: 'eth_chainId' }));
	}

	async function waitForWalletProviderChain(provider: WalletProvider, chainId: number): Promise<void> {
		const startedAt = Date.now();
		const timeout = 10_000;
		while (Date.now() - startedAt <= timeout) {
			if (await getWalletProviderChainId(provider) === chainId) return;
			await sleep(250);
		}
		throw new Error(`ウォレットのチェーン切替を検出できませんでした。ウォレット側で chain ${chainId} に切り替わっているか確認してください。`);
	}

	function handleWalletConnectStaleSession(error: unknown, connectorUid?: string | null): never {
		if (!isWalletConnectStaleSessionError(error)) throw error;
		if (connectorUid) {
			const connector = findWalletConnector(connectorUid);
			if (connector) removeWalletConnection(config, connector.uid);
		}
		throw new Error('WalletConnectの接続情報が古くなっています。WalletConnect解除を押してから、もう一度接続してください。');
	}

	async function requestWalletProviderChainSwitch(provider: WalletProvider, chainId: number, connectorUid?: string | null): Promise<void> {
		try {
			await provider.request({
				method: 'wallet_switchEthereumChain',
				params: [{ chainId: chainIdHex(chainId) }],
			});
			await waitForWalletProviderChain(provider, chainId);
		} catch (error) {
			handleWalletConnectStaleSession(error, connectorUid);
		}
	}

	async function requestWalletPersonalSign(provider: WalletProvider, message: string, signer: Address, connectorUid?: string | null): Promise<Hex> {
		try {
			return await provider.request({
				method: 'personal_sign',
				params: [message, signer],
			}) as Hex;
		} catch (error) {
			handleWalletConnectStaleSession(error, connectorUid);
		}
	}

	async function connectWallet(connectorUid?: string | null): Promise<ConnectedWallet> {
		const requestedConnector = connectorUid ? findWalletConnector(connectorUid) : null;
		const activeConnectorRaw = activeConnector.value ? rawConnector(activeConnector.value) : null;
		const isRequestedConnectorActive = requestedConnector
			&& activeConnectorRaw
			&& isSameWalletConnector(activeConnectorRaw, requestedConnector);
		if (address.value && accountChainId.value && (!requestedConnector || isRequestedConnectorActive)) {
			return { address: address.value, chainId: accountChainId.value };
		}

		const connector = rawConnector(getWalletConnector(connectorUid));

		const result = await connectMutationAsync({ connector });
		const connectedAddress = result.accounts[0];
		if (!connectedAddress) throw new Error('ウォレット接続に失敗しました');

		return {
			address: connectedAddress,
			chainId: result.chainId,
		};
	}

	async function switchWalletChain(chainId: number): Promise<void> {
		if (accountChainId.value === chainId) return;
		await switchChainMutationAsync({ chainId } as Parameters<typeof switchChainMutationAsync>[0]);
	}

	async function switchWalletConnection(connectorUid: string): Promise<ConnectedWallet> {
		const connector = rawConnector(getWalletConnector(connectorUid));
		const result = await switchConnectionMutationAsync({ connector });
		const connectedAddress = result.accounts[0];
		if (!connectedAddress) throw new Error('ウォレット接続に失敗しました');
		return {
			address: connectedAddress,
			chainId: result.chainId,
		};
	}

	async function disconnectWalletConnection(connectorUid: string): Promise<void> {
		const connector = rawConnector(getWalletConnector(connectorUid));
		try {
			await connector.disconnect?.();
		} catch (error) {
			if (!isWalletConnectStaleSessionError(error)) throw error;
		}
		// Stale WalletConnect sessions can fail during disconnect before wagmi cleans up.
		removeWalletConnection(config, connector.uid);
	}

	async function clearWalletConnectStorage(): Promise<void> {
		// WalletConnect v2 keeps session data outside wagmi, mostly in this IndexedDB.
		if (typeof localStorage !== 'undefined') {
			for (const key of Object.keys(localStorage)) {
				if (isWalletConnectStorageKey(key)) localStorage.removeItem(key);
			}
		}
		await deleteBrowserDatabase('WALLET_CONNECT_V2_INDEXED_DB');
		await config.storage?.removeItem('recentConnectorId');
	}

	async function switchOrAddWalletChain(chain: WalletChainConfig, connectorUid?: string | null): Promise<void> {
		const requestedConnector = connectorUid ? findWalletConnector(connectorUid) : null;
		const activeConnectorRaw = activeConnector.value ? rawConnector(activeConnector.value) : null;
		const isRequestedConnectorActive = requestedConnector
			&& activeConnectorRaw
			&& isSameWalletConnector(activeConnectorRaw, requestedConnector);
		const requestedConnection = requestedConnector ? config.state.connections.get(requestedConnector.uid) : null;
		if (!requestedConnector || isRequestedConnectorActive) {
			if (accountChainId.value === chain.chainId) return;
		} else if (requestedConnection?.chainId === chain.chainId) {
			return;
		}

		if (!requestedConnector || isRequestedConnectorActive) {
			try {
				await switchWalletChain(chain.chainId);
				return;
			} catch (error) {
				if (isWalletConnectStaleSessionError(error)) handleWalletConnectStaleSession(error, requestedConnector?.uid);
				if (!isChainNotConfiguredError(error)) throw error;
			}
		}

		const provider = await getWalletProvider(connectorUid);

		try {
			await requestWalletProviderChainSwitch(provider, chain.chainId, connectorUid);
			return;
		} catch (error) {
			if (getErrorCode(error) !== 4902) throw error;
		}

		await provider.request({
			method: 'wallet_addEthereumChain',
			params: [{
				chainId: chainIdHex(chain.chainId),
				chainName: chain.name,
				nativeCurrency: {
					name: chain.nativeCurrencyName,
					symbol: chain.nativeCurrencySymbol,
					decimals: chain.nativeCurrencyDecimals,
				},
				rpcUrls: chain.rpcUrls,
				blockExplorerUrls: chain.blockExplorerUrl ? [chain.blockExplorerUrl] : undefined,
			}],
		});
		await requestWalletProviderChainSwitch(provider, chain.chainId, connectorUid);
	}

	async function signWalletMessage(message: string, connectorUid?: string | null, account?: Address): Promise<Hex> {
		if (connectorUid) {
			const signer = account ?? address.value;
			if (!signer) throw new Error('ウォレット接続に失敗しました');
			const provider = await getWalletProvider(connectorUid);
			return await requestWalletPersonalSign(provider, message, signer, connectorUid);
		}

		try {
			return await signMessageMutationAsync({ message });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (!errorMessage.includes('ConnectorChainMismatchError')) throw error;
			if (!address.value) throw error;
			const provider = await getWalletProvider();
			return await requestWalletPersonalSign(provider, message, address.value);
		}
	}

	async function watchWalletAsset(token: WalletTokenConfig): Promise<boolean> {
		const provider = await getWalletProvider();
		const options: Record<string, unknown> = {
			address: getAddress(token.address),
			symbol: token.symbol.slice(0, 11),
			decimals: token.decimals,
		};
		if (token.image) options.image = token.image;
		const result = await provider.request({
			method: 'wallet_watchAsset',
			params: {
				type: 'ERC20',
				options,
			},
		});
		return result === true;
	}

	async function sendWalletTransaction(params: {
		account: Address;
		chainId: number;
		data: Hex;
		to: Address;
		value?: bigint;
	}): Promise<Hex> {
		try {
			return await sendTransactionMutationAsync({
				chainId: params.chainId,
				data: params.data,
				to: params.to,
				value: params.value ?? 0n,
			} as Parameters<typeof sendTransactionMutationAsync>[0]);
		} catch (error) {
			if (!isChainNotConfiguredError(error)) throw error;
		}

		const provider = await getWalletProvider();
		const txHash = await provider.request({
			method: 'eth_sendTransaction',
			params: [{
				from: params.account,
				to: params.to,
				data: params.data,
				value: toHex(params.value ?? 0n),
			}],
		});
		if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error('txHash の取得に失敗しました');
		return txHash as Hex;
	}

	async function waitForWalletTransactionReceipt(
		hash: Hex,
		options: WaitForWalletTransactionReceiptOptions,
	): Promise<TransactionReceipt> {
		receiptHash.value = hash;
		receiptChainId.value = options.chainId;
		receiptConfirmations.value = Math.max(1, options.confirmations ?? 1);
		receiptPollingInterval.value = options.pollingInterval;
		receiptTimeout.value = options.timeout;

		try {
			const result = await receiptQuery.refetch({ throwOnError: true });
			if (!result.data) throw new Error('送金トランザクションの確認に失敗しました');
			return result.data as TransactionReceipt;
		} catch (error) {
			if (!isChainNotConfiguredError(error)) throw error;
		}

		const provider = await getWalletProvider();
		const startedAt = Date.now();
		const timeout = options.timeout ?? 120_000;
		const pollingInterval = options.pollingInterval ?? 4_000;
		const confirmations = Math.max(1, options.confirmations ?? 1);

		while (timeout === 0 || Date.now() - startedAt <= timeout) {
			const receipt = await provider.request({
				method: 'eth_getTransactionReceipt',
				params: [hash],
			}) as { blockNumber?: unknown } | null;
			const receiptBlockNumber = parseHexQuantity(receipt?.blockNumber);
			if (receipt && receiptBlockNumber !== null) {
				if (confirmations <= 1) return receipt as TransactionReceipt;
				const blockNumberRaw = await provider.request({ method: 'eth_blockNumber' });
				const blockNumber = parseHexQuantity(blockNumberRaw);
				if (blockNumber !== null && blockNumber >= receiptBlockNumber && blockNumber - receiptBlockNumber + 1n >= BigInt(confirmations)) {
					return receipt as TransactionReceipt;
				}
			}
			await sleep(pollingInterval);
		}
		throw new Error('送金トランザクションの確認がタイムアウトしました');
	}

	return {
		currentChainId,
		walletAddress,
		walletChainId,
		activeWalletConnectorUid,
		connectedWalletConnections,
		walletConnectors,
		connectWallet,
		disconnectWalletConnection,
		clearWalletConnectStorage,
		switchWalletConnection,
		switchWalletChain,
		switchOrAddWalletChain,
		signWalletMessage,
		watchWalletAsset,
		sendWalletTransaction,
		waitForWalletTransactionReceipt,
	};
}

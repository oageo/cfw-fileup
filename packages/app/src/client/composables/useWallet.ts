import { computed, onScopeDispose, ref, shallowRef, toRaw } from 'vue';
import {
	ChainNotConfiguredError,
	useChainId,
	useConnection,
	useConnect,
	useConfig,
	useConnectors,
	useDisconnect,
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

type WalletEventProvider = WalletProvider & {
	on?: (event: 'accountsChanged' | 'chainChanged', listener: (payload: unknown) => void) => void;
	removeListener?: (event: 'accountsChanged' | 'chainChanged', listener: (payload: unknown) => void) => void;
	off?: (event: 'accountsChanged' | 'chainChanged', listener: (payload: unknown) => void) => void;
};

type WalletConnectionLike = {
	accounts: readonly Address[];
	chainId: number;
	connector: Connector;
};

type WalletProviderSubscription = {
	provider: WalletEventProvider;
	accountsChanged: (payload: unknown) => void;
	chainChanged: (payload: unknown) => void;
};

type WalletConfig = ReturnType<typeof useConfig>;

const walletProviderSubscriptions = new Map<string, WalletProviderSubscription>();
const pendingWalletProviderSubscriptionConnectorUids = new Set<string>();
let walletProviderSubscriptionUsers = 0;

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

function parseHexQuantity(value: unknown): bigint | null {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
	return BigInt(value);
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function rawConnector(connector: Connector): Connector {
	return toRaw(connector);
}

function parseWalletAccounts(accounts: unknown): Address[] {
	if (!Array.isArray(accounts)) return [];
	return accounts.flatMap((account) => {
		if (typeof account !== 'string') return [];
		try {
			return [getAddress(account)];
		} catch {
			return [];
		}
	});
}

function parseWalletChainId(chainId: unknown): number | null {
	if (typeof chainId === 'number' && Number.isSafeInteger(chainId) && chainId > 0) return chainId;
	if (typeof chainId !== 'string') return null;
	const parsed = Number(chainId);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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

function updateWalletConnectionAccounts(config: WalletConfig, connectorUid: string, accountsPayload: unknown): void {
	const accounts = parseWalletAccounts(accountsPayload);
	config.setState((state) => {
		const connection = state.connections.get(connectorUid);
		if (!connection) return state;

		const connections = new Map(state.connections);
		if (accounts.length === 0) {
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
			};
		}

		connections.set(connectorUid, {
			...connection,
			accounts: accounts as unknown as readonly [Address, ...Address[]],
		});
		return {
			...state,
			connections,
		};
	});
}

function updateWalletConnectionChain(config: WalletConfig, connectorUid: string, chainIdPayload: unknown): void {
	const chainId = parseWalletChainId(chainIdPayload);
	if (chainId == null) return;
	config.setState((state) => {
		const connection = state.connections.get(connectorUid);
		if (!connection) return state;
		return {
			...state,
			connections: new Map(state.connections).set(connectorUid, {
				...connection,
				chainId,
			}),
		};
	});
}

function removeWalletProviderSubscription(connectorUid: string): void {
	const subscription = walletProviderSubscriptions.get(connectorUid);
	if (!subscription) return;
	subscription.provider.removeListener?.('accountsChanged', subscription.accountsChanged);
	subscription.provider.removeListener?.('chainChanged', subscription.chainChanged);
	subscription.provider.off?.('accountsChanged', subscription.accountsChanged);
	subscription.provider.off?.('chainChanged', subscription.chainChanged);
	walletProviderSubscriptions.delete(connectorUid);
}

function syncWalletProviderSubscriptions(config: WalletConfig): void {
	const connections = Array.from(config.state.connections.entries());
	const connectedConnectorUids = new Set(connections.map(([connectorUid]) => connectorUid));

	for (const connectorUid of Array.from(walletProviderSubscriptions.keys())) {
		if (!connectedConnectorUids.has(connectorUid)) removeWalletProviderSubscription(connectorUid);
	}

	for (const [connectorUid, connection] of connections) {
		if (walletProviderSubscriptions.has(connectorUid) || pendingWalletProviderSubscriptionConnectorUids.has(connectorUid)) continue;
		pendingWalletProviderSubscriptionConnectorUids.add(connectorUid);
		void rawConnector(connection.connector).getProvider?.()
			.then((provider) => {
				pendingWalletProviderSubscriptionConnectorUids.delete(connectorUid);
				const walletProvider = provider as WalletEventProvider | undefined;
				if (walletProviderSubscriptionUsers <= 0 || !config.state.connections.has(connectorUid)) return;
				if (!walletProvider?.on || walletProviderSubscriptions.has(connectorUid)) return;
				const accountsChanged = (payload: unknown) => updateWalletConnectionAccounts(config, connectorUid, payload);
				const chainChanged = (payload: unknown) => updateWalletConnectionChain(config, connectorUid, payload);
				walletProvider.on('accountsChanged', accountsChanged);
				walletProvider.on('chainChanged', chainChanged);
				walletProviderSubscriptions.set(connectorUid, { provider: walletProvider, accountsChanged, chainChanged });
			})
			.catch(() => {
				pendingWalletProviderSubscriptionConnectorUids.delete(connectorUid);
			});
	}
}

function releaseWalletProviderSubscriptions(): void {
	walletProviderSubscriptionUsers -= 1;
	if (walletProviderSubscriptionUsers > 0) return;
	walletProviderSubscriptionUsers = 0;
	pendingWalletProviderSubscriptionConnectorUids.clear();
	for (const connectorUid of Array.from(walletProviderSubscriptions.keys())) {
		removeWalletProviderSubscription(connectorUid);
	}
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
	const { mutateAsync: disconnectMutationAsync } = useDisconnect();
	const { mutateAsync: sendTransactionMutationAsync } = useSendTransaction();
	const connectedWalletConnectionSnapshots = shallowRef<ConnectedWalletConnection[]>(
		getWalletConnectionSnapshots(config.state.connections.values()),
	);
	walletProviderSubscriptionUsers += 1;

	const unsubscribeConnections = config.subscribe(
		state => getWalletConnectionSnapshots(state.connections.values()),
		connections => {
			connectedWalletConnectionSnapshots.value = connections;
			syncWalletProviderSubscriptions(config);
		},
		{
			equalityFn: (previous, next) => getWalletConnectionKey(previous) === getWalletConnectionKey(next),
		},
	);
	syncWalletProviderSubscriptions(config);
	onScopeDispose(() => {
		unsubscribeConnections();
		releaseWalletProviderSubscriptions();
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

	async function connectWallet(connectorUid?: string | null): Promise<ConnectedWallet> {
		const requestedConnector = connectorUid ? findWalletConnector(connectorUid) : null;
		const activeConnectorRaw = activeConnector.value ? rawConnector(activeConnector.value) : null;
		const isRequestedConnectorActive = requestedConnector
			&& activeConnectorRaw
			&& (activeConnectorRaw.uid === requestedConnector.uid || activeConnectorRaw.id === requestedConnector.id);
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
		await disconnectMutationAsync({ connector });
	}

	async function switchOrAddWalletChain(chain: WalletChainConfig, connectorUid?: string | null): Promise<void> {
		if (accountChainId.value === chain.chainId) return;
		const requestedConnector = connectorUid ? findWalletConnector(connectorUid) : null;
		const activeConnectorRaw = activeConnector.value ? rawConnector(activeConnector.value) : null;
		const isRequestedConnectorActive = requestedConnector
			&& activeConnectorRaw
			&& (activeConnectorRaw.uid === requestedConnector.uid || activeConnectorRaw.id === requestedConnector.id);
		if (!requestedConnector || isRequestedConnectorActive) {
			try {
				await switchWalletChain(chain.chainId);
				return;
			} catch (error) {
				if (!isChainNotConfiguredError(error)) throw error;
			}
		}

		const provider = await getWalletProvider(connectorUid);
		const chainId = chainIdHex(chain.chainId);

		try {
			await provider.request({
				method: 'wallet_switchEthereumChain',
				params: [{ chainId }],
			});
			return;
		} catch (error) {
			if (getErrorCode(error) !== 4902) throw error;
		}

		await provider.request({
			method: 'wallet_addEthereumChain',
			params: [{
				chainId,
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
	}

	async function signWalletMessage(message: string, connectorUid?: string | null, account?: Address): Promise<Hex> {
		if (connectorUid) {
			const signer = account ?? address.value;
			if (!signer) throw new Error('ウォレット接続に失敗しました');
			const provider = await getWalletProvider(connectorUid);
			return await provider.request({
				method: 'personal_sign',
				params: [message, signer],
			}) as Hex;
		}

		try {
			return await signMessageMutationAsync({ message });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (!errorMessage.includes('ConnectorChainMismatchError')) throw error;
			if (!address.value) throw error;
			const provider = await getWalletProvider();
			return await provider.request({
				method: 'personal_sign',
				params: [message, address.value],
			}) as Hex;
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
		switchWalletConnection,
		switchWalletChain,
		switchOrAddWalletChain,
		signWalletMessage,
		watchWalletAsset,
		sendWalletTransaction,
		waitForWalletTransactionReceipt,
	};
}

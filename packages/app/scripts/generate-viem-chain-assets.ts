import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

type ChainLike = {
	id: number;
	name: string;
	nativeCurrency: unknown;
	rpcUrls: unknown;
	blockExplorers?: unknown;
	testnet?: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const viemPackageJsonPath = require.resolve('viem/package.json');
const viemRoot = dirname(viemPackageJsonPath);
const viemPackageJson = JSON.parse(readFileSync(viemPackageJsonPath, 'utf8')) as { version?: string };
const viemVersion = viemPackageJson.version ?? '';
const indexSource = readFileSync(resolve(viemRoot, 'chains/index.ts'), 'utf8');
const assetsOutRoot = resolve(appRoot, `public/assets/chains/${viemVersion}`);

function parseExportNames(exportList: string): string[] {
	return exportList
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split(',')
		.map(part => part.trim())
		.filter(Boolean)
		.map(part => part.split(/\s+as\s+/).at(-1)?.trim() ?? part)
		.filter(Boolean);
}

function isChainLike(value: unknown): value is ChainLike {
	return typeof value === 'object'
		&& value !== null
		&& typeof (value as { id?: unknown }).id === 'number'
		&& Number.isSafeInteger((value as { id: number }).id)
		&& typeof (value as { name?: unknown }).name === 'string'
		&& typeof (value as { nativeCurrency?: unknown }).nativeCurrency === 'object'
		&& (value as { nativeCurrency?: unknown }).nativeCurrency !== null
		&& typeof (value as { rpcUrls?: unknown }).rpcUrls === 'object'
		&& (value as { rpcUrls?: unknown }).rpcUrls !== null;
}

function toChainAsset(chain: ChainLike): Record<string, unknown> {
	return {
		id: chain.id,
		name: chain.name,
		nativeCurrency: chain.nativeCurrency,
		rpcUrls: chain.rpcUrls,
		blockExplorers: chain.blockExplorers,
		testnet: chain.testnet,
	};
}

const exportPattern = /export\s*\{([\s\S]*?)\}\s*from\s*'\.\/definitions\/([^']+)\.js'/g;
const writtenChainIds = new Set<number>();

rmSync(assetsOutRoot, { recursive: true, force: true });
mkdirSync(assetsOutRoot, { recursive: true });

for (const match of indexSource.matchAll(exportPattern)) {
	const [, exportList, fileName] = match;
	if (!exportList || !fileName) continue;
	const exportNames = parseExportNames(exportList);
	const moduleUrl = pathToFileURL(resolve(viemRoot, `_esm/chains/definitions/${fileName}.js`)).href;
	const module = await import(moduleUrl) as Record<string, unknown>;

	for (const exportName of exportNames) {
		const chain = module[exportName];
		if (!isChainLike(chain)) continue;
		if (writtenChainIds.has(chain.id)) continue;
		writeFileSync(
			resolve(assetsOutRoot, `${chain.id}.json`),
			`${JSON.stringify(toChainAsset(chain))}\n`,
		);
		writtenChainIds.add(chain.id);
	}
}

console.log(`Generated ${writtenChainIds.size} viem chain JSON assets for viem ${viemVersion}.`);

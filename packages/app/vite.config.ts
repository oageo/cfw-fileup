import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

const devTunnelName = process.env.CF_DEV_TUNNEL;
const devTunnel = devTunnelName === undefined || devTunnelName === ''
	? false
	: ['1', 'true', 'quick'].includes(devTunnelName.toLowerCase())
		? true
		: {
			name: devTunnelName,
			autoStart: true,
		};

export default defineConfig({
	preview: {
		allowedHosts: [
			'.trycloudflare.com',
		],
	},
	server: {
		watch: {
			// .wrangler/state はMiniflareが頻繁に書き換えるため、HMRのトリガー対象から除外
			ignored: ['**/.wrangler/**'],
		},
	},
	resolve: {
		alias: {
			'@': resolve(__dirname, 'src/client'),
		},
	},
	plugins: [
		cloudflare({
			configPath: './wrangler.jsonc',
			tunnel: devTunnel as boolean,
		}),
		vue(),
		VitePWA({
			strategies: 'injectManifest',
			srcDir: 'src/sw',
			filename: 'index.ts',
			injectRegister: 'auto',
			includeAssets: ['favicon.svg', 'favicon.ico'],
			manifest: {
				name: 'CFW FileUp',
				short_name: 'FileUp',
				description: 'Upload files to CFW FileUp.',
				lang: 'ja',
				start_url: '/my/buckets',
				scope: '/',
				display: 'standalone',
				background_color: '#f1f5f9',
				theme_color: '#4f46e5',
				icons: [
					{
						src: '/icon.any-192.png',
						sizes: '192x192',
						type: 'image/png',
						purpose: 'any',
					},
					{
						src: '/icon.any-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any',
					},
					{
						src: '/icon.any-1200.png',
						sizes: '1200x1200',
						type: 'image/png',
						purpose: 'any',
					},
					{
						src: '/icon.maskable-192.png',
						sizes: '192x192',
						type: 'image/png',
						purpose: 'maskable',
					},
					{
						src: '/icon.maskable-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable',
					},
					{
						src: '/icon.maskable-1200.png',
						sizes: '1200x1200',
						type: 'image/png',
						purpose: 'maskable',
					},
				],
				share_target: {
					action: '/share-target',
					method: 'POST',
					enctype: 'multipart/form-data',
					params: {
						files: [
							{
								name: 'files',
								accept: ['*/*'],
							},
						],
					},
				},
			},
			devOptions: {
				enabled: true,
				type: 'module',
			},
			workbox: {
				skipWaiting: true,
				clientsClaim: true,
			},
		}),
	],
});

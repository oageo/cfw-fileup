/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// https://github.com/misskey-dev/misskey/blob/e2335567005ccd6e45db1556ae1095bb00d87e52/packages/frontend/src/router.ts

import { inject } from 'vue';
import { page } from '@/router.definition.js';
import { Nirax } from '@/nirax.js';
import { ROUTE_DEF } from '@/router.definition.js';

export type Router = Nirax<typeof ROUTE_DEF>;

export function createRouter(fullPath: string, loggedIn: boolean = false): Router {
	return new Nirax(ROUTE_DEF, fullPath, loggedIn, page(() => import('@/pages/not-found.vue')));
}

interface RouterGlobalState {
	mainRouter?: Router;
	listenersInitialized?: boolean;
}

const routerGlobalState = globalThis as typeof globalThis & { __cfwFileupRouter?: RouterGlobalState };
const routerState = routerGlobalState.__cfwFileupRouter ??= {};

// Keep one router across component HMR so stale page modules cannot update only history.
// If this module itself changes, reload below because routes/listeners are part of app wiring.
export const mainRouter = routerState.mainRouter ??= createRouter(window.location.pathname + window.location.search + window.location.hash);

if (!routerState.listenersInitialized) {
	window.addEventListener('popstate', (event) => {
		mainRouter.replaceByPath(window.location.pathname + window.location.search + window.location.hash);
	});

	mainRouter.addListener('push', ctx => {
		window.history.pushState({ }, '', ctx.fullPath);
	});

	mainRouter.addListener('replace', ctx => {
		window.history.replaceState({ }, '', ctx.fullPath);
	});

	mainRouter.addListener('forceReplace', ctx => {
		window.location.replace(ctx.fullPath);
	});

	mainRouter.addListener('forcePush', ctx => {
		window.location.href = ctx.fullPath;
	});

	mainRouter.addListener('change', ctx => {
		//if (_DEV_) console.log('mainRouter: change', ctx.fullPath);
		//analytics.page({
		//	path: ctx.fullPath,
		//	title: ctx.fullPath,
		//});
	});

	mainRouter.init();
	routerState.listenersInitialized = true;
} else {
	mainRouter.replaceByPath(window.location.pathname + window.location.search + window.location.hash);
}

if (import.meta.hot) {
	import.meta.hot.accept(() => {
		window.location.reload();
	});
}

const ROUTER_SYMBOL = Symbol();

export function useRouter(): Router {
	return inject(ROUTER_SYMBOL, null) ?? mainRouter;
}

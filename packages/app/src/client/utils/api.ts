import type * as v from 'valibot';
import { authHeaders } from '../store/auth';
import type { ApiDef } from '../../shared/api';
import type { ApiErrorResponse } from '../../shared/api-errors';

type GetSuccessSchema<Res> =
	Res extends { 200: { content: { 'application/json': { vSchema: infer S } } } }
		? S extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>
			? S
			: never
		: never;

export type ApiSuccess<E extends keyof ApiDef> = {
	ok: true;
	status: number;
	data: v.InferOutput<GetSuccessSchema<ApiDef[E]['res']>>;
};

export type ApiFailure = {
	ok: false;
	status: number;
	data: ApiErrorResponse;
};

export type ApiResult<E extends keyof ApiDef> = ApiSuccess<E> | ApiFailure;

export async function apiPost<E extends keyof ApiDef>(
	endpoint: E,
	body?: v.InferOutput<ApiDef[E]['req']>,
	url?: string,
): Promise<ApiResult<E>> {
	const res = await fetch(url ?? endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeaders() },
		body: JSON.stringify(body ?? {}),
	});
	const data = await res.json();
	if (res.ok) {
		return { ok: true, status: res.status, data };
	}
	return {
		ok: false,
		status: res.status,
		data: toApiErrorResponse(data, res.status),
	};
}

function isApiErrorResponse(data: unknown): data is ApiErrorResponse {
	return typeof data === 'object'
		&& data !== null
		&& 'error' in data
		&& typeof data.error === 'string'
		&& 'message' in data
		&& typeof data.message === 'string';
}

function toApiErrorResponse(data: unknown, status: number): ApiErrorResponse {
	if (isApiErrorResponse(data)) return data;

	if (typeof data === 'object'
		&& data !== null
		&& 'error' in data
		&& typeof data.error === 'string') {
		return {
			error: 'INTERNAL_SERVER_ERROR',
			message: data.error,
		};
	}

	return { error: 'INTERNAL_SERVER_ERROR', message: `HTTP ${status}` };
}

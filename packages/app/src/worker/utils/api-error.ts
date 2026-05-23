import { HTTPException } from 'hono/http-exception';
import { type ApiErrorCode, type ApiErrorResponse } from '../../shared/api-errors';

export class ApiError extends HTTPException {
	public readonly code: ApiErrorCode;

	public constructor(status: ConstructorParameters<typeof HTTPException>[0], code: ApiErrorCode, message: string = code) {
		super(status, { message });
		this.code = code;
	}
}

export function apiError(status: ConstructorParameters<typeof HTTPException>[0], code: ApiErrorCode, message: string = code): ApiError {
	return new ApiError(status, code, message);
}

export function createApiErrorResponse(code: ApiErrorCode, message: string = code): ApiErrorResponse {
	return {
		error: code,
		message,
	};
}

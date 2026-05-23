import { HTTPException } from 'hono/http-exception';
import { apiErrorMessages, type ApiErrorCode, type ApiErrorResponse } from '../../shared/api-errors';

export class ApiError extends HTTPException {
	public readonly code: ApiErrorCode;

	public constructor(status: ConstructorParameters<typeof HTTPException>[0], code: ApiErrorCode, message = apiErrorMessages[code]) {
		super(status, { message });
		this.code = code;
	}
}

export function apiError(status: ConstructorParameters<typeof HTTPException>[0], code: ApiErrorCode, message = apiErrorMessages[code]): ApiError {
	return new ApiError(status, code, message);
}

export function createApiErrorResponse(code: ApiErrorCode, message = apiErrorMessages[code]): ApiErrorResponse {
	return {
		error: code,
		message,
	};
}

export function getRequestIp(request: { header(name: string): string | undefined }): string | null {
	return request.header('CF-Connecting-IP') ?? null;
}


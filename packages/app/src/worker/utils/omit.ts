export function omitResAndReq<
	T extends Record<string, unknown>,
> (o: T): Omit<T, 'req' | 'res'> {
	const rest: Partial<T> = { ...o };
	delete rest.req;
	delete rest.res;
	return rest as Omit<T, 'req' | 'res'>;
};

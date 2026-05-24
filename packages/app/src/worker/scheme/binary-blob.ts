import { customType } from 'drizzle-orm/sqlite-core';

export const binaryBlob = customType<{
	data: Uint8Array;
	driverData: Uint8Array | ArrayBuffer;
}>({
	dataType() {
		return 'blob';
	},
	toDriver(value) {
		return value;
	},
	fromDriver(value) {
		return value instanceof Uint8Array ? value : new Uint8Array(value);
	},
});

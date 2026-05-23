import ipaddr from 'ipaddr.js';

export function ipMatchesCidr(ip: string, cidr: string): boolean {
	try {
		const parsedIp = ipaddr.parse(ip);
		if (!cidr.includes('/')) {
			const parsedRange = ipaddr.parse(cidr);
			return parsedIp.kind() === parsedRange.kind() && parsedIp.toString() === parsedRange.toString();
		}
		const [range, prefix] = ipaddr.parseCIDR(cidr);
		if (parsedIp.kind() !== range.kind()) return false;
		return parsedIp.match(range, prefix);
	} catch {
		return false;
	}
}

export function isValidCidr(cidr: string): boolean {
	try {
		ipaddr.parseCIDR(cidr);
		return true;
	} catch {
		return ipaddr.isValid(cidr);
	}
}

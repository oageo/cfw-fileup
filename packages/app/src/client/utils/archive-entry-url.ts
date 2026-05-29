export function archiveEntryDownloadUrl(fileId: string, entryPath: string, token?: string | null): string {
	const base = `/d/${fileId}/${encodeURIComponent(':entries')}/${encodeURIComponent(entryPath)}`;
	return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

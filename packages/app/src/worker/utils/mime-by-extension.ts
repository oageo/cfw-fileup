const mimeTypesByExtension: Record<string, string> = {
	css: 'text/css',
	csv: 'text/csv',
	html: 'text/html',
	js: 'text/javascript',
	json: 'application/json',
	md: 'text/markdown',
	sh: 'text/x-shellscript',
	svg: 'image/svg+xml',
	toml: 'application/toml',
	ts: 'text/typescript',
	txt: 'text/plain',
	xhtml: 'application/xhtml+xml',
	xml: 'application/xml',
	yaml: 'application/yaml',
	yml: 'application/yaml',
};

export function inferMimeTypeByExtension(path: string): string | undefined {
	const filename = path.split('/').pop() ?? path;
	const extension = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : undefined;
	return extension ? mimeTypesByExtension[extension] : undefined;
}

// Writing rolled results back over their inline code in a file's text.

/**
 * Replace each `raw` with its result, in order, taking the first copy still in the section each time
 * (so two identical `pick:loot` in one paragraph each get their own roll). Without section info, or if
 * the section no longer holds the code, the first copy anywhere in the file is used.
 */
export function writeResults(
	data: string,
	writes: { raw: string; text: string }[],
	lineStart?: number,
	lineEnd?: number,
): string {
	const lines = data.split('\n');
	const last = lines.length - 1;
	const replaceFirst = (raw: string, text: string, start: number, end: number): boolean => {
		for (let i = start; i <= end; i++) {
			const at = lines[i].indexOf(raw);
			if (at >= 0) {
				lines[i] = lines[i].slice(0, at) + text + lines[i].slice(at + raw.length);
				return true;
			}
		}
		return false;
	};
	for (const { raw, text } of writes) {
		const inSection = lineStart !== undefined && replaceFirst(raw, text, lineStart, Math.min(lineEnd ?? last, last));
		if (!inSection) replaceFirst(raw, text, 0, last);
	}
	return lines.join('\n');
}

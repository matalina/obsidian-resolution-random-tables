// Parsing random tables out of markdown notes.
//
// A table is a heading followed by a markdown table. The first header cell is the dice formula,
// and the first column holds the numbers or ranges each row covers:
//
//   ## Loot
//   | d6  | Item          |
//   | --- | ------------- |
//   | 1-3 | {coin} coins  |
//   | 4-5 | A rusty sword |
//   | 6   | {gem}         |
//
// Ranges may be written against the DC (`2-DC-6`, `DC-5–DC-1`, `DC+5+`), which makes the table a
// resolution table for `oracle:` and `task:`. Optional `key: value` lines between the heading and the
// table override the DC settings for that table:  `dc: 12`, `shift: 2`, `base: 0`, `step: 3`.
//
// A table whose first column isn't numbers is a plain list: every row is equally likely.

import { isDiceFormula } from './dice';

export interface Term {
	/** Counts from the DC rather than from zero. */
	dc: boolean;
	n: number;
}

export interface RangeSpec {
	min: Term;
	/** null = open-ended upwards (`DC+5+`, `19+`). */
	max: Term | null;
}

export interface DcOverrides {
	/** Oracle DC at 50/50. */
	dc?: number;
	/** DC change per step of likelihood. */
	shift?: number;
	/** Task DC = base + level × step. */
	base?: number;
	step?: number;
}

export interface TableRow {
	/** null on plain-list tables. */
	range: RangeSpec | null;
	value: string;
}

export interface RandomTable {
	/** Slug of the heading, used to refer to it: `pick:loot`. */
	name: string;
	heading: string;
	/** Vault path of the note it lives in. */
	path: string;
	/** 0-based line of the heading. */
	line: number;
	/** Dice from the header cell, or null to work it out. */
	formula: string | null;
	rows: TableRow[];
	/** Plain list — every row equally likely. */
	uniform: boolean;
	/** Some range counts from the DC — a resolution table. */
	usesDc: boolean;
	overrides: DcOverrides;
}

const TERM = String.raw`(?:dc\s*[+-]\s*\d+|dc|\d+)`;
const SINGLE_RE = new RegExp(`^(${TERM})$`, 'i');
const RANGE_RE = new RegExp(String.raw`^(${TERM})\s*(?:[-–—]|to|\.\.)\s*(${TERM})$`, 'i');
const OPEN_RE = new RegExp(String.raw`^(${TERM})\s*\+$`, 'i');
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const OVERRIDE_RE = /^\s*(dc|shift|base|step)\s*:\s*(-?\d+)\s*$/i;

function parseTerm(text: string): Term {
	const t = text.replace(/\s+/g, '').toLowerCase();
	if (t.startsWith('dc')) {
		const rest = t.slice(2);
		return { dc: true, n: rest ? parseInt(rest, 10) : 0 };
	}
	// `00` on a percentile table means 100
	if (/^0+$/.test(t) && t.length > 1) return { dc: false, n: 100 };
	return { dc: false, n: parseInt(t, 10) };
}

/** `5`, `1-3`, `1–3`, `2 to 4`, `19+`, `DC`, `2-DC-6`, `DC-5–DC-1`, `DC+5+` */
export function parseRange(cell: string): RangeSpec | null {
	const text = stripEmphasis(cell).trim();
	let m = SINGLE_RE.exec(text);
	if (m) {
		const t = parseTerm(m[1]);
		return { min: t, max: t };
	}
	m = RANGE_RE.exec(text);
	if (m) return { min: parseTerm(m[1]), max: parseTerm(m[2]) };
	m = OPEN_RE.exec(text);
	if (m) return { min: parseTerm(m[1]), max: null };
	return null;
}

export function termValue(term: Term, dc: number | undefined): number | null {
	if (!term.dc) return term.n;
	return dc === undefined ? null : dc + term.n;
}

export function rangeUsesDc(range: RangeSpec): boolean {
	return range.min.dc || !!range.max?.dc;
}

function stripEmphasis(text: string): string {
	return text.replace(/\*\*|__/g, '').replace(/[*_]/g, '');
}

/** Heading text → the name used in `pick:`. Links and emphasis are dropped. */
export function slugify(text: string): string {
	return text
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replace(/\[\[([^\]]+)\]\]/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.toLowerCase()
		.replace(/[*_`~]/g, '')
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.trim()
		.replace(/[\s-]+/g, '-');
}

/** Split a markdown table row into cells, honouring `\|`. */
export function splitRow(line: string): string[] {
	let text = line.trim();
	if (text.startsWith('|')) text = text.slice(1);
	if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
	const cells: string[] = [];
	let current = '';
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '\\' && text[i + 1] === '|') {
			current += '|';
			i++;
		} else if (c === '|') {
			cells.push(current.trim());
			current = '';
		} else {
			current += c;
		}
	}
	cells.push(current.trim());
	return cells;
}

const isTableLine = (line: string | undefined) => !!line && line.trim().startsWith('|');
const isSeparator = (line: string) => /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line.trim());

/** Every table in a note. Tables without a heading above them are ignored. */
export function parseTables(content: string, path: string): RandomTable[] {
	const lines = content.split(/\r?\n/);
	const tables: RandomTable[] = [];
	let inFence = false;

	for (let i = 0; i < lines.length; i++) {
		if (/^\s*(```|~~~)/.test(lines[i])) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const heading = HEADING_RE.exec(lines[i]);
		if (!heading) continue;

		const headingLine = i;
		const overrides: DcOverrides = {};
		let j = i + 1;
		for (; j < lines.length; j++) {
			if (lines[j].trim() === '') continue;
			const o = OVERRIDE_RE.exec(lines[j]);
			if (!o) break;
			overrides[o[1].toLowerCase() as keyof DcOverrides] = parseInt(o[2], 10);
		}
		if (!isTableLine(lines[j]) || !lines[j + 1] || !isSeparator(lines[j + 1])) continue;

		const header = splitRow(lines[j]);
		const bodyLines: string[] = [];
		for (j += 2; j < lines.length && isTableLine(lines[j]); j++) bodyLines.push(lines[j]);
		i = j - 1;

		const table = buildTable(heading[2], path, headingLine, header, bodyLines.map(splitRow), overrides);
		if (table) tables.push(table);
	}
	return tables;
}

function buildTable(
	headingText: string,
	path: string,
	line: number,
	header: string[],
	body: string[][],
	overrides: DcOverrides,
): RandomTable | null {
	const name = slugify(headingText);
	const rows = body.filter((cells) => cells.some((c) => c !== ''));
	if (!name || rows.length === 0) return null;

	const headCell = stripEmphasis(header[0] ?? '').trim();
	const formula = isDiceFormula(headCell) ? headCell : null;
	const ranges = rows.map((cells) => (cells.length > 1 ? parseRange(cells[0]) : null));
	const ranged = ranges.filter((r) => r !== null).length;

	// Ranged when the dice header says so or most of the first column is numbers.
	if (formula || ranged * 2 > rows.length) {
		const tableRows: TableRow[] = [];
		rows.forEach((cells, idx) => {
			const range = ranges[idx];
			if (!range) return;
			tableRows.push({ range, value: joinValue(cells.slice(1)) });
		});
		if (tableRows.length === 0) return null;
		return {
			name,
			heading: headingText.trim(),
			path,
			line,
			formula,
			rows: tableRows,
			uniform: false,
			usesDc: tableRows.some((r) => r.range !== null && rangeUsesDc(r.range)),
			overrides,
		};
	}

	return {
		name,
		heading: headingText.trim(),
		path,
		line,
		formula: null,
		rows: rows.map((cells) => ({ range: null, value: joinValue(cells) })),
		uniform: true,
		usesDc: false,
		overrides,
	};
}

/** Extra columns are kept, joined with an em dash: `| 3 | Torch | 1 cp |` → `Torch — 1 cp`. */
function joinValue(cells: string[]): string {
	return cells.filter((c) => c !== '').join(' — ');
}

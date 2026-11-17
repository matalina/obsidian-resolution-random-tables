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
// Rows can also match the natural die (`nat 20`, `Natural 1`), be open-ended downwards (`≤DC-10`,
// `5 or less`), or say it in words: `Beat target by 10+`, `Beat target by 0–9`, `Miss by 1–2`,
// `Miss by 10+`. A trailing `(Name)` in that cell is the row's label: `**Miss by 1–2 (Near Miss)**`.
//
// A table whose first column isn't numbers is a plain list: every row is equally likely.

import { isDiceFormula } from './dice';

export interface Term {
	/** Counts from the DC rather than from zero. */
	dc: boolean;
	n: number;
}

export interface RangeSpec {
	/** null = open-ended downwards (`≤DC-10`, `Miss by 10+`). */
	min: Term | null;
	/** null = open-ended upwards (`DC+5+`, `19+`). */
	max: Term | null;
	/** Matches the die as rolled, before modifiers, ahead of every other row: `nat 20`. */
	natural?: number;
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
	/** `(Near Miss)` from the range cell, if it had one. */
	label: string | null;
	/** The value cells (every cell on a plain list, every cell after the range otherwise). */
	cells: string[];
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
	/** Slugs of the value columns' headers, for picking one: `degrees.attack`. */
	columns: string[];
	/** Plain list — every row equally likely. */
	uniform: boolean;
	/** Some range counts from the DC — a resolution table. */
	usesDc: boolean;
	overrides: DcOverrides;
}

const TERM = String.raw`(?:dc\s*[+-]\s*\d+|dc|\d+)`;
const SINGLE_RE = new RegExp(`^(${TERM})$`, 'i');
const RANGE_RE = new RegExp(String.raw`^(${TERM})\s*(?:[-–—]|to|\.\.)\s*(${TERM})$`, 'i');
const OPEN_UP_RE = new RegExp(String.raw`^(?:(${TERM})\s*\+|(?:≥|>=)\s*(${TERM})|(${TERM})\s+or\s+(?:more|higher|above))$`, 'i');
const OPEN_DOWN_RE = new RegExp(String.raw`^(?:(?:≤|<=)\s*(${TERM})|(${TERM})\s+or\s+(?:less|lower|below))$`, 'i');
const NATURAL_RE = /^nat(?:ural)?\s*(\d+)$/i;
const BY = String.raw`\s+(?:the\s+)?(?:target|dc)?\s*by\s+(\d+)\s*(?:(?:[-–—]|to)\s*(\d+)|(\+|or\s+more))?$`;
const BEAT_RE = new RegExp(String.raw`^beat(?:s|en)?${BY}`, 'i');
const MISS_RE = new RegExp(String.raw`^miss(?:es|ed)?${BY}`, 'i');
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

const dcTerm = (n: number): Term => ({ dc: true, n });

/** `Beat target by 0–9`, `Beat target by 10+`, `Miss by 1–2`, `Miss by 10+` */
function parsePhrase(text: string): RangeSpec | null {
	let m = BEAT_RE.exec(text);
	if (m) {
		const a = parseInt(m[1], 10);
		if (m[2]) return { min: dcTerm(a), max: dcTerm(parseInt(m[2], 10)) };
		return { min: dcTerm(a), max: m[3] ? null : dcTerm(a) };
	}
	m = MISS_RE.exec(text);
	if (m) {
		const a = parseInt(m[1], 10);
		if (m[2]) return { min: dcTerm(-parseInt(m[2], 10)), max: dcTerm(-a) };
		return { min: m[3] ? null : dcTerm(-a), max: dcTerm(-a) };
	}
	return null;
}

/** `5`, `1-3`, `1–3`, `2 to 4`, `19+`, `≤5`, `DC`, `2-DC-6`, `DC-5–DC-1`, `DC+5+`, `nat 20`, `Miss by 1–2` */
export function parseRange(cell: string): RangeSpec | null {
	const text = stripEmphasis(cell).trim();
	let m = NATURAL_RE.exec(text);
	if (m) {
		const n = parseInt(m[1], 10);
		return { min: { dc: false, n }, max: { dc: false, n }, natural: n };
	}
	m = SINGLE_RE.exec(text);
	if (m) {
		const t = parseTerm(m[1]);
		return { min: t, max: t };
	}
	m = RANGE_RE.exec(text);
	if (m) return { min: parseTerm(m[1]), max: parseTerm(m[2]) };
	m = OPEN_UP_RE.exec(text);
	if (m) return { min: parseTerm(m[1] ?? m[2] ?? m[3]), max: null };
	m = OPEN_DOWN_RE.exec(text);
	if (m) return { min: null, max: parseTerm(m[1] ?? m[2]) };
	return parsePhrase(text);
}

/** A first-column cell: its range, plus a trailing `(Label)` if it has one. */
export function parseRangeCell(cell: string): { range: RangeSpec; label: string | null } | null {
	const text = stripEmphasis(cell).trim();
	const paren = /^(.+?)\s*\(([^()]+)\)$/.exec(text);
	if (paren) {
		const range = parseRange(paren[1]);
		if (range) return { range, label: paren[2].trim() };
	}
	const range = parseRange(text);
	return range ? { range, label: null } : null;
}

export function termValue(term: Term, dc: number | undefined): number | null {
	if (!term.dc) return term.n;
	return dc === undefined ? null : dc + term.n;
}

export function rangeUsesDc(range: RangeSpec): boolean {
	return !!range.min?.dc || !!range.max?.dc;
}

const isBlank = (cell: string | undefined) => !cell || /^[\s—–-]*$/.test(cell);

/**
 * What a row rolls to. With a column (`degrees.attack`): the label, then that column. Without one:
 * the label if the row has one, otherwise every value cell joined with an em dash.
 */
export function rowText(row: TableRow, column?: number): string {
	if (column !== undefined) {
		const cell = row.cells[column];
		if (isBlank(cell)) return row.label ?? '';
		return row.label ? `${row.label} — ${cell}` : cell;
	}
	if (row.label) return row.label;
	return row.cells.filter((c) => !isBlank(c)).join(' — ');
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
	const ranges = rows.map((cells) => (cells.length > 1 ? parseRangeCell(cells[0]) : null));
	const ranged = ranges.filter((r) => r !== null).length;
	const base = { name, heading: headingText.trim(), path, line, overrides };

	// Ranged when the dice header says so or most of the first column is numbers.
	if (formula || ranged * 2 > rows.length) {
		const tableRows: TableRow[] = [];
		rows.forEach((cells, idx) => {
			const parsed = ranges[idx];
			if (!parsed) return;
			tableRows.push({ range: parsed.range, label: parsed.label, cells: cells.slice(1) });
		});
		if (tableRows.length === 0) return null;
		return {
			...base,
			formula,
			rows: tableRows,
			columns: header.slice(1).map(slugify),
			uniform: false,
			usesDc: tableRows.some((r) => r.range !== null && rangeUsesDc(r.range)),
		};
	}

	return {
		...base,
		formula: null,
		rows: rows.map((cells) => ({ range: null, label: null, cells })),
		columns: header.map(slugify),
		uniform: true,
		usesDc: false,
	};
}

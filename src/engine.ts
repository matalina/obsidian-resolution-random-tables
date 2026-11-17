// The rolling engine: finding tables by name, rolling them (with nested `{refs}`), and the
// `pick:`, `oracle:` and `task:` commands. No Obsidian imports, so it can be unit-tested.

import { DiceError, rollDice, isDiceFormula, Rng } from './dice';
import { parseRange, RandomTable, rowText, slugify, TableRow, Term, termValue } from './tables';

export interface ResolutionSettings {
	/** Die rolled for oracle and task when the results table doesn't name one. */
	die: string;
	/** Oracle DC at 50/50. */
	oracleDc: number;
	/** DC change per `+` or `-` on the oracle. */
	shift: number;
	/** Task DC = taskBase + level × taskStep. */
	taskBase: number;
	taskStep: number;
	/** Vault table used for `oracle:` when none is named; blank = built-in Yes/No bands. */
	oracleTable: string;
	/** Vault table used for `task:` when none is named; blank = built-in Success/Fail bands. */
	taskTable: string;
	/** Add the roll in italics after the result. */
	showRolls: boolean;
}

export const DEFAULT_RESOLUTION: ResolutionSettings = {
	die: '1d20',
	oracleDc: 15,
	shift: 3,
	taskBase: 0,
	taskStep: 3,
	oracleTable: '',
	taskTable: '',
	showRolls: true,
};

export type Outcome = { ok: true; text: string } | { ok: false; error: string };

export type Command =
	| { kind: 'pick'; ref: string }
	| { kind: 'oracle'; likelihood: number; ref: string }
	| { kind: 'task'; level: number; mod: number; ref: string }
	| { kind: 'invalid'; error: string };

const MAX_DEPTH = 12;

// ---------------------------------------------------------------- registry

function basename(path: string): string {
	const file = path.split('/').pop() ?? path;
	return file.replace(/\.md$/i, '');
}

export interface Found {
	table: RandomTable;
	/** Index into the table's value columns, when the ref picked one. */
	column?: number;
}

export class TableRegistry {
	private byPath = new Map<string, RandomTable[]>();

	setFile(path: string, tables: RandomTable[]) {
		if (tables.length) this.byPath.set(path, tables);
		else this.byPath.delete(path);
	}

	removeFile(path: string) {
		this.byPath.delete(path);
	}

	clear() {
		this.byPath.clear();
	}

	all(): RandomTable[] {
		return [...this.byPath.values()].flat();
	}

	/**
	 * `loot`, `Treasure#loot` when the name is in more than one note, `Treasure` for a note with one
	 * table, and any of those with `.column` to take one column: `degrees.attack`.
	 */
	find(ref: string): Found | { error: string } {
		const whole = this.findTable(ref);
		if ('table' in whole) return whole;
		const dot = ref.lastIndexOf('.');
		if (dot > 0) {
			const base = this.findTable(ref.slice(0, dot));
			if ('table' in base) {
				const want = slugify(ref.slice(dot + 1));
				const column = base.table.columns.indexOf(want);
				if (column < 0) {
					const cols = base.table.columns.filter(Boolean).join(', ');
					return { error: `"${base.table.name}" has no column "${want}" (columns: ${cols})` };
				}
				return { table: base.table, column };
			}
		}
		return whole;
	}

	private findTable(ref: string): { table: RandomTable } | { error: string } {
		const hash = ref.lastIndexOf('#');
		const note = hash >= 0 ? ref.slice(0, hash).trim() : '';
		const name = slugify(hash >= 0 ? ref.slice(hash + 1) : ref);
		if (!name) return { error: 'No table named' };

		const inNote = (t: RandomTable, want: string) =>
			basename(t.path).toLowerCase() === want || t.path.replace(/\.md$/i, '').toLowerCase() === want;

		let found = this.all().filter((t) => t.name === name);
		if (note) {
			const want = note.replace(/\.md$/i, '').toLowerCase();
			found = found.filter((t) => inNote(t, want));
		}
		if (found.length === 0 && !note) {
			// A note name on its own finds the note's only table.
			const want = ref.trim().replace(/\.md$/i, '').toLowerCase();
			const tables = this.all().filter((t) => inNote(t, want));
			if (tables.length === 1) return { table: tables[0] };
			if (tables.length > 1) {
				return { error: `"${ref.trim()}" has ${tables.length} tables — write ${basename(tables[0].path)}#${tables[0].name}` };
			}
		}
		if (found.length === 0) return { error: `No table "${ref.trim()}"` };

		const notes = [...new Set(found.map((t) => t.path))];
		if (notes.length > 1) {
			const names = notes.map(basename).join(', ');
			return { error: `"${name}" is in ${notes.length} notes (${names}) — write Note#${name}` };
		}
		return { table: found[0] };
	}

	/** The shortest ref that finds this table: `loot`, or `Treasure#loot` when the name repeats. */
	refFor(table: RandomTable): string {
		const notes = new Set(this.all().filter((t) => t.name === table.name).map((t) => t.path));
		return notes.size > 1 ? `${basename(table.path)}#${table.name}` : table.name;
	}
}

// ---------------------------------------------------------------- rolling

interface RollContext {
	registry: TableRegistry;
	rng: Rng;
	depth: number;
}

export interface TableRoll {
	value: string;
	formula: string;
	/** The dice as rolled, before the modifier. */
	natural: number;
	/** natural + modifier: what the rows are matched against. */
	total: number;
}

interface RollOptions {
	dc?: number;
	/** Die to use when the table's header doesn't name one. */
	die?: string;
	column?: number;
	/** Added to the roll after the natural rows are checked. */
	mod?: number;
}

class RollError extends Error {}

/** A range end, with null (open-ended) standing for `open`. */
function bound(term: Term | null, dc: number | undefined, open: number): number | null {
	return term === null ? open : termValue(term, dc);
}

function rowFor(table: RandomTable, natural: number, total: number, dc: number | undefined): TableRow | null {
	const natRow = table.rows.find((r) => r.range?.natural === natural);
	if (natRow) return natRow;

	let lowest: { row: TableRow; min: number } | null = null;
	let highest: { row: TableRow; min: number } | null = null;
	for (const row of table.rows) {
		if (!row.range || row.range.natural !== undefined) continue;
		const min = bound(row.range.min, dc, -Infinity);
		const max = bound(row.range.max, dc, Infinity);
		if (min === null || max === null) throw new RollError(`"${table.name}" counts from the DC — use it with oracle: or task:`);
		if (total >= min && total <= max) return row;
		if (!lowest || min < lowest.min) lowest = { row, min };
		if (!highest || min > highest.min) highest = { row, min };
	}
	// Resolution tables clamp, so a modified DC can't fall off either end of the bands.
	if (dc !== undefined && lowest && highest) return total < lowest.min ? lowest.row : highest.row;
	return null;
}

function rollTable(table: RandomTable, ctx: RollContext, opts: RollOptions = {}): TableRoll {
	const { dc, column } = opts;
	const mod = opts.mod ?? 0;
	if (table.uniform) {
		const formula = `1d${table.rows.length}`;
		const { total } = rollDice(formula, ctx.rng);
		return { value: expand(rowText(table.rows[total - 1], column), ctx), formula, natural: total, total };
	}

	let formula = table.formula ?? opts.die;
	if (!formula) {
		const tops = table.rows.map((r) => {
			const edge = r.range?.max ?? r.range?.min ?? null;
			return edge ? termValue(edge, dc) ?? 0 : 0;
		});
		formula = `1d${Math.max(...tops)}`;
	}
	const natural = rollDice(formula, ctx.rng).total;
	const total = natural + mod;
	const row = rowFor(table, natural, total, dc);
	if (!row) throw new RollError(`"${table.name}" has no row for ${total}`);
	return { value: expand(rowText(row, column), ctx), formula, natural, total };
}

/** Fill `{table}`, `{Note#table}` and `{2d6*10}` in a result. */
export function expand(text: string, ctx: RollContext): string {
	return text.replace(/\{([^{}]+)\}/g, (_whole, inner: string) => {
		const ref = inner.trim();
		const found = ctx.registry.find(ref);
		if ('table' in found) {
			if (ctx.depth >= MAX_DEPTH) throw new RollError(`Tables nest more than ${MAX_DEPTH} deep at {${ref}}`);
			if (found.table.usesDc) throw new RollError(`{${ref}} counts from the DC and can't be nested`);
			return rollTable(found.table, { ...ctx, depth: ctx.depth + 1 }, { column: found.column }).value;
		}
		if (isDiceFormula(ref) || /^\s*-?\d+\s*$/.test(ref)) return String(rollDice(ref, ctx.rng).total);
		throw new RollError(found.error.replace('No table', 'No table or dice') + ` in {${ref}}`);
	});
}

// ---------------------------------------------------------------- built-in bands

function bands(labels: [string, string, string, string, string]): RandomTable {
	const ranges = ['1', '2-DC-6', 'DC-5-DC-1', 'DC-DC+4', 'DC+5+'];
	return {
		name: '',
		heading: '',
		path: '',
		line: 0,
		formula: null,
		rows: ranges.map((r, i) => ({ range: parseRange(r), label: null, cells: [labels[i]] })),
		columns: [''],
		uniform: false,
		usesDc: true,
		overrides: {},
	};
}

export const ORACLE_BANDS = bands(['No, and', 'No, but', 'Yes, but', 'Yes', 'Yes, and']);
export const TASK_BANDS = bands(['Fail, and', 'Fail, but', 'Success, but', 'Success', 'Success, and']);

// ---------------------------------------------------------------- commands

export const COMMAND_RE = /^(pick|oracle|task)\s*:\s*([\s\S]*)$/i;

/** Parse the text inside the backticks. null = not one of ours. */
export function parseCommand(code: string): Command | null {
	const m = COMMAND_RE.exec(code.trim());
	if (!m) return null;
	const kind = m[1].toLowerCase();
	const arg = m[2].trim();

	if (kind === 'pick') {
		if (!arg) return { kind: 'invalid', error: 'pick: needs a table name' };
		return { kind: 'pick', ref: arg };
	}
	if (kind === 'oracle') {
		const o = /^([+-]*)\s*(.*)$/.exec(arg)!;
		const signs = o[1];
		if (signs.includes('+') && signs.includes('-')) return { kind: 'invalid', error: 'oracle: takes + or -, not both' };
		if (signs.length > 2) return { kind: 'invalid', error: 'oracle: takes at most ++ or --' };
		const likelihood = signs.startsWith('-') ? -signs.length : signs.length;
		return { kind: 'oracle', likelihood, ref: o[2].trim() };
	}
	const t = /^(\d+)\s*(?:([+-])\s*(\d+)(?=\s|$))?\s*(.*)$/.exec(arg);
	if (!t) return { kind: 'invalid', error: 'task: needs a level, e.g. task:4' };
	const mod = t[2] ? (t[2] === '-' ? -1 : 1) * parseInt(t[3], 10) : 0;
	return { kind: 'task', level: parseInt(t[1], 10), mod, ref: t[4].trim() };
}

const LIKELIHOOD: Record<number, string> = {
	2: 'very likely',
	1: 'likely',
	0: '',
	[-1]: 'unlikely',
	[-2]: 'very unlikely',
};

export interface RunEnv {
	registry: TableRegistry;
	settings: ResolutionSettings;
	rng?: Rng;
}

function annotate(value: string, note: string, settings: ResolutionSettings): string {
	return settings.showRolls ? `${value} ← _(${note})_` : value;
}

function resultsTable(ref: string, fallback: string, builtin: RandomTable, registry: TableRegistry): Found {
	const name = ref || fallback;
	if (!name) return { table: builtin };
	const found = registry.find(name);
	if ('error' in found) throw new RollError(found.error);
	return found;
}

const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

/** `1d20: 14`, or `1d20+3: 11+3 = 14` with a modifier. */
function rollNote(r: TableRoll, mod: number): string {
	return mod ? `${r.formula}${signed(mod)}: ${r.natural}${signed(mod)} = ${r.total}` : `${r.formula}: ${r.total}`;
}

/** What's wrong with a command before it's rolled (unknown table, wrong kind of table), or null. */
export function checkCommand(command: Command, registry: TableRegistry, settings: ResolutionSettings): string | null {
	if (command.kind === 'invalid') return command.error;
	const ref = command.kind === 'pick' ? command.ref : command.ref || (command.kind === 'oracle' ? settings.oracleTable : settings.taskTable);
	if (!ref) return null;
	const found = registry.find(ref);
	if ('error' in found) return found.error;
	if (command.kind === 'pick' && found.table.usesDc) return `"${found.table.name}" counts from the DC — use it with oracle: or task:`;
	return null;
}

/** Roll a command and return the text that replaces it in the note. */
export function runCommand(command: Command, env: RunEnv): Outcome {
	const { registry, settings } = env;
	const ctx: RollContext = { registry, rng: env.rng ?? Math.random, depth: 0 };
	try {
		switch (command.kind) {
			case 'invalid':
				return { ok: false, error: command.error };

			case 'pick': {
				const found = registry.find(command.ref);
				if ('error' in found) return { ok: false, error: found.error };
				if (found.table.usesDc) {
					return { ok: false, error: `"${found.table.name}" counts from the DC — use it with oracle: or task:` };
				}
				const r = rollTable(found.table, ctx, { column: found.column });
				return { ok: true, text: annotate(r.value, `${r.formula}: ${r.total}`, settings) };
			}

			case 'oracle': {
				const { table, column } = resultsTable(command.ref, settings.oracleTable, ORACLE_BANDS, registry);
				const o = table.overrides;
				const dc = (o.dc ?? settings.oracleDc) - command.likelihood * (o.shift ?? settings.shift);
				const r = rollTable(table, ctx, { dc, die: settings.die, column });
				const label = LIKELIHOOD[command.likelihood];
				return {
					ok: true,
					text: annotate(r.value, `oracle${label ? ' ' + label : ''} · DC ${dc} · ${r.formula}: ${r.total}`, settings),
				};
			}

			case 'task': {
				const { table, column } = resultsTable(command.ref, settings.taskTable, TASK_BANDS, registry);
				const o = table.overrides;
				const dc = (o.base ?? settings.taskBase) + command.level * (o.step ?? settings.taskStep);
				const r = rollTable(table, ctx, { dc, die: settings.die, column, mod: command.mod });
				return {
					ok: true,
					text: annotate(r.value, `task ${command.level} · DC ${dc} · ${rollNote(r, command.mod)}`, settings),
				};
			}
		}
	} catch (e) {
		if (e instanceof RollError || e instanceof DiceError) return { ok: false, error: e.message };
		throw e;
	}
}

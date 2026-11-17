// The rolling engine: finding tables by name, rolling them (with nested `{refs}`), and the
// `pick:`, `oracle:` and `task:` commands. No Obsidian imports, so it can be unit-tested.

import { DiceError, rollDice, isDiceFormula, Rng } from './dice';
import { parseRange, RandomTable, slugify, TableRow, termValue } from './tables';

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
	| { kind: 'task'; level: number; ref: string }
	| { kind: 'invalid'; error: string };

const MAX_DEPTH = 12;

// ---------------------------------------------------------------- registry

function basename(path: string): string {
	const file = path.split('/').pop() ?? path;
	return file.replace(/\.md$/i, '');
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

	/** `loot`, `Loot`, or `Treasure#Loot` when the name is in more than one note. */
	find(ref: string): { table: RandomTable } | { error: string } {
		const hash = ref.lastIndexOf('#');
		const note = hash >= 0 ? ref.slice(0, hash).trim() : '';
		const name = slugify(hash >= 0 ? ref.slice(hash + 1) : ref);
		if (!name) return { error: 'No table named' };

		let found = this.all().filter((t) => t.name === name);
		if (note) {
			const want = note.replace(/\.md$/i, '').toLowerCase();
			found = found.filter(
				(t) =>
					basename(t.path).toLowerCase() === want ||
					t.path.replace(/\.md$/i, '').toLowerCase() === want,
			);
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
	total: number;
}

class RollError extends Error {}

function rowFor(table: RandomTable, total: number, dc: number | undefined): TableRow | null {
	let lowest: { row: TableRow; min: number } | null = null;
	let highest: { row: TableRow; min: number } | null = null;
	for (const row of table.rows) {
		if (!row.range) continue;
		const min = termValue(row.range.min, dc);
		const max = row.range.max ? termValue(row.range.max, dc) : Infinity;
		if (min === null || max === null) throw new RollError(`"${table.name}" counts from the DC — use it with oracle: or task:`);
		if (total >= min && total <= max) return row;
		if (!lowest || min < lowest.min) lowest = { row, min };
		if (!highest || min > highest.min) highest = { row, min };
	}
	// Resolution tables clamp, so a modified DC can't fall off either end of the bands.
	if (dc !== undefined && lowest && highest) return total < lowest.min ? lowest.row : highest.row;
	return null;
}

function rollTable(table: RandomTable, ctx: RollContext, dc?: number, die?: string): TableRoll {
	if (table.uniform) {
		const formula = `1d${table.rows.length}`;
		const { total } = rollDice(formula, ctx.rng);
		return { value: expand(table.rows[total - 1].value, ctx), formula, total };
	}

	let formula = table.formula ?? die;
	if (!formula) {
		const top = Math.max(...table.rows.map((r) => (r.range?.max ? termValue(r.range.max, dc) ?? 0 : termValue(r.range!.min, dc) ?? 0)));
		formula = `1d${top}`;
	}
	const { total } = rollDice(formula, ctx.rng);
	const row = rowFor(table, total, dc);
	if (!row) throw new RollError(`"${table.name}" has no row for ${total}`);
	return { value: expand(row.value, ctx), formula, total };
}

/** Fill `{table}`, `{Note#table}` and `{2d6*10}` in a result. */
export function expand(text: string, ctx: RollContext): string {
	return text.replace(/\{([^{}]+)\}/g, (_whole, inner: string) => {
		const ref = inner.trim();
		const found = ctx.registry.find(ref);
		if ('table' in found) {
			if (ctx.depth >= MAX_DEPTH) throw new RollError(`Tables nest more than ${MAX_DEPTH} deep at {${ref}}`);
			if (found.table.usesDc) throw new RollError(`{${ref}} counts from the DC and can't be nested`);
			return rollTable(found.table, { ...ctx, depth: ctx.depth + 1 }).value;
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
		rows: ranges.map((r, i) => ({ range: parseRange(r), value: labels[i] })),
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
	const t = /^(\d+)\s*(.*)$/.exec(arg);
	if (!t) return { kind: 'invalid', error: 'task: needs a level, e.g. task:4' };
	return { kind: 'task', level: parseInt(t[1], 10), ref: t[2].trim() };
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

function resultsTable(ref: string, fallback: string, builtin: RandomTable, registry: TableRegistry): RandomTable {
	const name = ref || fallback;
	if (!name) return builtin;
	const found = registry.find(name);
	if ('error' in found) throw new RollError(found.error);
	return found.table;
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
				const r = rollTable(found.table, ctx);
				return { ok: true, text: annotate(r.value, `${r.formula}: ${r.total}`, settings) };
			}

			case 'oracle': {
				const table = resultsTable(command.ref, settings.oracleTable, ORACLE_BANDS, registry);
				const o = table.overrides;
				const dc = (o.dc ?? settings.oracleDc) - command.likelihood * (o.shift ?? settings.shift);
				const r = rollTable(table, ctx, dc, settings.die);
				const label = LIKELIHOOD[command.likelihood];
				return {
					ok: true,
					text: annotate(r.value, `oracle${label ? ' ' + label : ''} · DC ${dc} · ${r.formula}: ${r.total}`, settings),
				};
			}

			case 'task': {
				const table = resultsTable(command.ref, settings.taskTable, TASK_BANDS, registry);
				const o = table.overrides;
				const dc = (o.base ?? settings.taskBase) + command.level * (o.step ?? settings.taskStep);
				const r = rollTable(table, ctx, dc, settings.die);
				return {
					ok: true,
					text: annotate(r.value, `task ${command.level} · DC ${dc} · ${r.formula}: ${r.total}`, settings),
				};
			}
		}
	} catch (e) {
		if (e instanceof RollError || e instanceof DiceError) return { ok: false, error: e.message };
		throw e;
	}
}

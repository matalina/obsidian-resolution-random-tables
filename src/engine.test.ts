import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { isDiceFormula, rollDice } from './dice';
import { parseRange, parseTables, rowText, slugify } from './tables';
import { DEFAULT_RESOLUTION, parseCommand, runCommand, TableRegistry } from './engine';

/** An rng that makes every die land on `face` for a die of `sides`. */
const face = (n: number, sides: number) => () => (n - 1) / sides + 1e-9;
/** Faces in order, each for the given die size. */
const seq = (...rolls: [number, number][]) => {
	let i = 0;
	return () => {
		const [n, sides] = rolls[i++ % rolls.length];
		return (n - 1) / sides + 1e-9;
	};
};

describe('dice', () => {
	it('rolls expressions', () => {
		expect(rollDice('2d6+1', face(3, 6)).total).toBe(7);
		expect(rollDice('d%', face(42, 100)).total).toBe(42);
		expect(rollDice('(1d4+1)*10', face(2, 4)).total).toBe(30);
		expect(rollDice('2d6x10', face(1, 6)).total).toBe(20);
		expect(rollDice('4d6kh3', seq([1, 6], [5, 6], [6, 6], [2, 6])).total).toBe(13);
		expect(rollDice('2d20kl1', seq([15, 20], [4, 20])).total).toBe(4);
	});
	it('rejects junk', () => {
		expect(isDiceFormula('d20')).toBe(true);
		expect(isDiceFormula('Item')).toBe(false);
		expect(isDiceFormula('2d')).toBe(false);
		expect(() => rollDice('2d6+')).toThrow();
	});
});

describe('ranges', () => {
	it('parses numbers and DC terms', () => {
		expect(parseRange('5')).toEqual({ min: { dc: false, n: 5 }, max: { dc: false, n: 5 } });
		expect(parseRange('1–3')).toEqual({ min: { dc: false, n: 1 }, max: { dc: false, n: 3 } });
		expect(parseRange('2-DC-6')).toEqual({ min: { dc: false, n: 2 }, max: { dc: true, n: -6 } });
		expect(parseRange('DC-5–DC-1')).toEqual({ min: { dc: true, n: -5 }, max: { dc: true, n: -1 } });
		expect(parseRange('DC-DC+4')).toEqual({ min: { dc: true, n: 0 }, max: { dc: true, n: 4 } });
		expect(parseRange('DC+5+')).toEqual({ min: { dc: true, n: 5 }, max: null });
		expect(parseRange('**19+**')).toEqual({ min: { dc: false, n: 19 }, max: null });
		expect(parseRange('00')).toEqual({ min: { dc: false, n: 100 }, max: { dc: false, n: 100 } });
		expect(parseRange('Sword')).toBeNull();
	});
	it('slugs headings', () => {
		expect(slugify('Loot Table (Floor 3)')).toBe('loot-table-floor-3');
		expect(slugify('[[Goblins|Goblin]] Names')).toBe('goblin-names');
	});
});

const NOTE = `# Treasure

## Loot
| d6 | Item | Cost |
| --- | --- | --- |
| 1-3 | {coin} coins | |
| 4-5 | A rusty sword | 2 gp |
| 6 | {gem} worth {2d6*10} gp | |

## Coin
| d4 |  |
|---|---|
| 1-4 | Copper |

## Gem
| Gem |
|---|
| Ruby |

## Door
dc: 12
shift: 2
| d20 | Answer |
| --- | --- |
| 1 | Locked and trapped |
| 2-DC-6 | Locked |
| DC-5–DC-1 | Stuck |
| DC+ | Open |

\`\`\`
## Not a table
| d6 | x |
|---|---|
| 1-6 | x |
\`\`\`
`;

function registry() {
	const reg = new TableRegistry();
	reg.setFile('Tables/Treasure.md', parseTables(NOTE, 'Tables/Treasure.md'));
	return reg;
}

describe('parsing notes', () => {
	it('finds headed tables, skipping fences', () => {
		const tables = parseTables(NOTE, 'Treasure.md');
		expect(tables.map((t) => t.name)).toEqual(['loot', 'coin', 'gem', 'door']);
		const [loot, , gem, door] = tables;
		expect(loot.formula).toBe('d6');
		expect(rowText(loot.rows[1])).toBe('A rusty sword — 2 gp');
		expect(gem.uniform).toBe(true);
		expect(door.usesDc).toBe(true);
		expect(door.overrides).toEqual({ dc: 12, shift: 2 });
	});
});

describe('commands', () => {
	const env = (rng: () => number, settings = DEFAULT_RESOLUTION) => ({ registry: registry(), settings, rng });

	it('parses', () => {
		expect(parseCommand('pick: loot')).toEqual({ kind: 'pick', ref: 'loot' });
		expect(parseCommand('oracle:')).toEqual({ kind: 'oracle', likelihood: 0, ref: '' });
		expect(parseCommand('oracle:-- door')).toEqual({ kind: 'oracle', likelihood: -2, ref: 'door' });
		expect(parseCommand('task:4 door')).toEqual({ kind: 'task', level: 4, mod: 0, ref: 'door' });
		expect(parseCommand('task:15 +3 degrees.attack')).toEqual({ kind: 'task', level: 15, mod: 3, ref: 'degrees.attack' });
		expect(parseCommand('task:15 -2')).toEqual({ kind: 'task', level: 15, mod: -2, ref: '' });
		expect(parseCommand('task:')).toMatchObject({ kind: 'invalid' });
		expect(parseCommand('oracle:+-')).toMatchObject({ kind: 'invalid' });
		expect(parseCommand('dice:2d6')).toBeNull();
	});

	it('picks with nested tables and dice', () => {
		const out = runCommand(parseCommand('pick:loot')!, env(seq([6, 6], [1, 1], [3, 6], [4, 6])));
		expect(out).toEqual({ ok: true, text: 'Ruby worth 70 gp ← _(d6: 6)_' });
		const coins = runCommand(parseCommand('pick:Treasure#Loot')!, env(seq([2, 6], [3, 4])));
		expect(coins).toEqual({ ok: true, text: 'Copper coins ← _(d6: 2)_' });
	});

	it('reports unknown tables and DC tables used with pick', () => {
		expect(runCommand(parseCommand('pick:nope')!, env(Math.random))).toEqual({ ok: false, error: 'No table "nope"' });
		expect(runCommand(parseCommand('pick:door')!, env(Math.random)).ok).toBe(false);
	});

	it('asks for Note#name when a name is in two notes', () => {
		const reg = registry();
		reg.setFile('Other.md', parseTables('## Loot\n| d2 | x |\n|-|-|\n| 1-2 | y |', 'Other.md'));
		const out = runCommand(parseCommand('pick:loot')!, { registry: reg, settings: DEFAULT_RESOLUTION });
		expect(out.ok).toBe(false);
		expect(runCommand(parseCommand('pick:Other#loot')!, { registry: reg, settings: DEFAULT_RESOLUTION, rng: face(1, 2) })).toEqual({
			ok: true,
			text: 'y ← _(d2: 1)_',
		});
	});

	it('oracle uses the built-in bands at DC 15, shifted by likelihood', () => {
		expect(runCommand(parseCommand('oracle:')!, env(face(15, 20)))).toEqual({
			ok: true,
			text: 'Yes ← _(oracle · DC 15 · 1d20: 15)_',
		});
		expect(runCommand(parseCommand('oracle:+')!, env(face(10, 20)))).toEqual({
			ok: true,
			text: 'Yes, but ← _(oracle likely · DC 12 · 1d20: 10)_',
		});
		expect(runCommand(parseCommand('oracle:--')!, env(face(20, 20)))).toEqual({
			ok: true,
			text: 'Yes, but ← _(oracle very unlikely · DC 21 · 1d20: 20)_',
		});
		expect(runCommand(parseCommand('oracle:')!, env(face(1, 20)))).toMatchObject({ text: expect.stringMatching(/^No, and/) });
	});

	it('task rolls against level × step', () => {
		expect(runCommand(parseCommand('task:4')!, env(face(17, 20)))).toEqual({
			ok: true,
			text: 'Success, and ← _(task 4 · DC 12 · 1d20: 17)_',
		});
		const settings = { ...DEFAULT_RESOLUTION, taskBase: 10, taskStep: 1, showRolls: false };
		expect(runCommand(parseCommand('task:2')!, env(face(9, 20), settings))).toEqual({ ok: true, text: 'Success, but' });
	});

	it('a results table overrides the DC settings and clamps', () => {
		// dc: 12, shift: 2 → likely = DC 10
		expect(runCommand(parseCommand('oracle:+ door')!, env(face(10, 20)))).toEqual({
			ok: true,
			text: 'Open ← _(oracle likely · DC 10 · d20: 10)_',
		});
		expect(runCommand(parseCommand('oracle: door')!, env(face(7, 20)))).toMatchObject({ text: expect.stringMatching(/^Stuck/) });
	});

	it('uses the default results table from settings', () => {
		const settings = { ...DEFAULT_RESOLUTION, oracleTable: 'door', showRolls: false };
		expect(runCommand(parseCommand('oracle:')!, env(face(1, 20), settings))).toEqual({ ok: true, text: 'Locked and trapped' });
	});
});

describe('the example note', () => {
	it('rolls every command in it', async () => {
		const { readFileSync } = await import('fs');
		const path = 'Resolution and Random Tables Example.md';
		const text = readFileSync('examples/resolution-and-random-tables.md', 'utf8');
		const reg = new TableRegistry();
		reg.setFile(path, parseTables(text, path));
		expect(reg.all().map((t) => t.name)).toEqual(['loot', 'gem', 'wandering-mob', 'door', 'trap-outcome']);
		const codes = [...text.matchAll(/`((?:pick|oracle|task):[^`]*)`/g)].map((m) => m[1]);
		expect(codes.length).toBe(9);
		for (const code of codes) {
			for (let i = 0; i < 50; i++) {
				const out = runCommand(parseCommand(code)!, { registry: reg, settings: DEFAULT_RESOLUTION });
				expect(out, code).toMatchObject({ ok: true });
			}
		}
	});
});

describe('Dungeon Crawler Carl degrees of success', () => {
	const path = 'Degrees of Success.md';
	const text = readFileSync('src/fixtures/Degrees of Success.md', 'utf8');
	const reg = new TableRegistry();
	reg.setFile(path, parseTables(text, path));
	// Target number = the level: base 0, step 1
	const settings = { ...DEFAULT_RESOLUTION, taskBase: 0, taskStep: 1, showRolls: false };
	const roll = (code: string, natural: number) =>
		runCommand(parseCommand(code)!, { registry: reg, settings, rng: face(natural, 20) });

	it('reads the phrase rows', () => {
		const [table] = reg.all();
		expect(table.usesDc).toBe(true);
		expect(table.columns).toEqual(['attack', 'evade', 'non-combat']);
		expect(table.rows.map((r) => r.label)).toEqual([
			'Critical Hit',
			'Amazing Success',
			'Standard Success',
			'Near Miss',
			'Standard Fail',
			'Major Fail',
			'Critical Fail',
		]);
	});

	it('is found by note name, with or without a column', () => {
		expect(roll('task:15 Degrees of Success', 15)).toEqual({ ok: true, text: 'Standard Success' });
		expect(roll('task:15 Degrees of Success.attack', 14)).toEqual({
			ok: true,
			text: 'Near Miss — GM calls a near miss, inviting other players to use an Intervene Action',
		});
		// Evade has a dash for Near Miss: just the label
		expect(roll('task:15 Degrees of Success.evade', 13)).toEqual({ ok: true, text: 'Near Miss' });
	});

	it('matches every band, the modifier and naturals', () => {
		const band = (code: string, n: number) => {
			const out = roll(code, n);
			return out.ok ? out.text : out.error;
		};
		expect(band('task:10 Degrees of Success', 20)).toBe('Critical Hit');
		expect(band('task:5 Degrees of Success', 15)).toBe('Amazing Success');
		expect(band('task:15 Degrees of Success', 12)).toBe('Standard Fail');
		expect(band('task:15 Degrees of Success', 5)).toBe('Major Fail');
		expect(band('task:15 Degrees of Success', 1)).toBe('Critical Fail');
		// A modifier moves the total but not the natural: 19+3 = 22 vs 12 → Amazing, nat 1 stays Critical Fail
		expect(band('task:12 +3 Degrees of Success', 19)).toBe('Amazing Success');
		expect(band('task:5 +10 Degrees of Success', 1)).toBe('Critical Fail');
		expect(band('task:15 -2 Degrees of Success', 16)).toBe('Near Miss');
	});

	it('shows the modifier in the roll note', () => {
		const out = runCommand(parseCommand('task:12 +3 Degrees of Success')!, {
			registry: reg,
			settings: { ...settings, showRolls: true },
			rng: face(11, 20),
		});
		expect(out).toEqual({ ok: true, text: 'Standard Success ← _(task 12 · DC 12 · 1d20+3: 11+3 = 14)_' });
	});

	it('names the columns when one is wrong', () => {
		expect(roll('task:15 Degrees of Success.defence', 10)).toEqual({
			ok: false,
			error: '"degrees-of-success-failure-reworded" has no column "defence" (columns: attack, evade, non-combat)',
		});
	});
});

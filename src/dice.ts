// A small dice-expression roller: `d20`, `2d6+1`, `4d6kh3`, `d%`, `(1d4+1)*10`, `2d6x10`.
// Kept in-house so the plugin doesn't ship a full maths library for a handful of dice.

export type Rng = () => number;

export interface DiceRoll {
	formula: string;
	total: number;
	/** Every die rolled, in order, for display. */
	rolls: number[];
}

export class DiceError extends Error {}

const MAX_DICE = 1000;
const MAX_SIDES = 1_000_000;

class Parser {
	private pos = 0;
	readonly rolls: number[] = [];

	constructor(
		private readonly src: string,
		private readonly rng: Rng,
	) {}

	parse(): number {
		const value = this.expr();
		this.skipSpace();
		if (this.pos < this.src.length) {
			throw new DiceError(`Unexpected "${this.src[this.pos]}" in "${this.src}"`);
		}
		return value;
	}

	private skipSpace() {
		while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
	}

	private peek(): string {
		this.skipSpace();
		return this.src[this.pos]?.toLowerCase() ?? '';
	}

	private expr(): number {
		let value = this.term();
		for (let op = this.peek(); op === '+' || op === '-'; op = this.peek()) {
			this.pos++;
			const rhs = this.term();
			value = op === '+' ? value + rhs : value - rhs;
		}
		return value;
	}

	private term(): number {
		let value = this.factor();
		for (let op = this.peek(); op === '*' || op === 'x' || op === '/'; op = this.peek()) {
			this.pos++;
			const rhs = this.factor();
			if (op === '/') {
				if (rhs === 0) throw new DiceError(`Division by zero in "${this.src}"`);
				value = Math.floor(value / rhs);
			} else {
				value = value * rhs;
			}
		}
		return value;
	}

	private factor(): number {
		const c = this.peek();
		if (c === '(') {
			this.pos++;
			const value = this.expr();
			if (this.peek() !== ')') throw new DiceError(`Missing ")" in "${this.src}"`);
			this.pos++;
			return value;
		}
		if (c === '-') {
			this.pos++;
			return -this.factor();
		}
		return this.diceOrNumber();
	}

	private readInt(): number | null {
		this.skipSpace();
		const m = /^\d+/.exec(this.src.slice(this.pos));
		if (!m) return null;
		this.pos += m[0].length;
		return parseInt(m[0], 10);
	}

	private diceOrNumber(): number {
		const count = this.readInt();
		if (this.peek() !== 'd') {
			if (count === null) throw new DiceError(`Expected a number or dice in "${this.src}"`);
			return count;
		}
		this.pos++;
		let sides: number | null;
		if (this.peek() === '%') {
			this.pos++;
			sides = 100;
		} else {
			sides = this.readInt();
		}
		if (sides === null) throw new DiceError(`Missing die size in "${this.src}"`);
		const n = count ?? 1;
		if (n < 1 || n > MAX_DICE) throw new DiceError(`Can't roll ${n} dice`);
		if (sides < 1 || sides > MAX_SIDES) throw new DiceError(`Can't roll a d${sides}`);

		const rolled: number[] = [];
		for (let i = 0; i < n; i++) rolled.push(Math.floor(this.rng() * sides) + 1);
		this.rolls.push(...rolled);

		// Keep highest / lowest: `4d6kh3`, `2d20kl1`, `4d6k3` (= kh)
		if (this.peek() === 'k') {
			this.pos++;
			let lowest = false;
			const which = this.peek();
			if (which === 'h' || which === 'l') {
				lowest = which === 'l';
				this.pos++;
			}
			const keep = this.readInt() ?? 1;
			const sorted = [...rolled].sort((a, b) => (lowest ? a - b : b - a));
			return sorted.slice(0, keep).reduce((a, b) => a + b, 0);
		}
		return rolled.reduce((a, b) => a + b, 0);
	}
}

export function rollDice(formula: string, rng: Rng = Math.random): DiceRoll {
	const parser = new Parser(formula, rng);
	const total = parser.parse();
	return { formula: formula.trim(), total, rolls: parser.rolls };
}

/** True when `text` is a valid expression that rolls at least one die. */
export function isDiceFormula(text: string): boolean {
	if (!/d/i.test(text)) return false;
	try {
		rollDice(text, () => 0);
		return true;
	} catch {
		return false;
	}
}

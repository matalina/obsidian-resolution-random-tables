import { describe, expect, it } from 'vitest';
import { writeResults } from './write';

describe('writeResults', () => {
	it('gives each identical command in a section its own result', () => {
		const data = 'intro `pick:loot`\nA `pick:loot` and `pick:loot`\nB `oracle:`';
		const out = writeResults(
			data,
			[
				{ raw: '`pick:loot`', text: 'Sword' },
				{ raw: '`pick:loot`', text: 'Shield' },
			],
			1,
			1,
		);
		expect(out).toBe('intro `pick:loot`\nA Sword and Shield\nB `oracle:`');
	});
	it('falls back to the first copy in the file when the section moved', () => {
		expect(writeResults('`oracle:`\nx', [{ raw: '`oracle:`', text: 'Yes' }], 5, 9)).toBe('Yes\nx');
	});
	it('leaves the file alone when the code is gone', () => {
		expect(writeResults('nothing', [{ raw: '`task:4`', text: 'Success' }])).toBe('nothing');
	});
});

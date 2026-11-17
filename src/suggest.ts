// Autocomplete table names after `pick:`, `oracle:+ ` and `task:4 `.

import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo } from 'obsidian';
import { TableRegistry } from './engine';
import { RandomTable } from './tables';

const TRIGGERS: { kind: 'pick' | 'resolution'; re: RegExp }[] = [
	{ kind: 'pick', re: /`pick\s*:\s*([^`]*)$/i },
	{ kind: 'resolution', re: /`oracle\s*:\s*[+-]*\s*([^\s`+-][^`]*)$/i },
	{ kind: 'resolution', re: /`task\s*:\s*\d+\s+([^`]*)$/i },
];

export class TableSuggest extends EditorSuggest<RandomTable> {
	private kind: 'pick' | 'resolution' = 'pick';

	constructor(
		app: App,
		private readonly registry: TableRegistry,
	) {
		super(app);
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		const before = editor.getLine(cursor.line).slice(0, cursor.ch);
		for (const t of TRIGGERS) {
			const m = t.re.exec(before);
			if (!m) continue;
			this.kind = t.kind;
			return { start: { line: cursor.line, ch: cursor.ch - m[1].length }, end: cursor, query: m[1] };
		}
		return null;
	}

	getSuggestions(context: EditorSuggestContext): RandomTable[] {
		const q = context.query.trim().toLowerCase();
		const wantDc = this.kind === 'resolution';
		return this.registry
			.all()
			.filter((t) => (wantDc ? true : !t.usesDc))
			.filter((t) => !q || t.name.includes(q.replace(/\s+/g, '-')) || t.heading.toLowerCase().includes(q) || t.path.toLowerCase().includes(q))
			.sort((a, b) => Number(b.usesDc === wantDc) - Number(a.usesDc === wantDc) || a.name.localeCompare(b.name))
			.slice(0, 50);
	}

	renderSuggestion(table: RandomTable, el: HTMLElement): void {
		el.addClass('rrt-suggestion');
		el.createDiv({ text: table.heading });
		el.createDiv({ cls: 'rrt-suggestion-note', text: `${this.registry.refFor(table)} · ${table.path}` });
	}

	selectSuggestion(table: RandomTable): void {
		const ctx = this.context;
		if (!ctx) return;
		ctx.editor.replaceRange(this.registry.refFor(table), ctx.start, ctx.end);
	}
}

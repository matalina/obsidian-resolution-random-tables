// Live Preview: `pick:…`, `oracle:…` and `task:…` roll on their own as soon as the cursor is off
// them, and the result replaces the code (backticks included) — once, the same way Tag and Tally's
// `pick:` works. A command that can't roll stays as code, marked in red with the reason on hover.

import { syntaxTree } from '@codemirror/language';
import { EditorSelection, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import { Outcome, parseCommand } from './engine';

export interface LiveHost {
	/** Roll the text inside the backticks. */
	run(code: string): Outcome | null;
	/** Bumped when tables or settings change, so failed commands are retried. */
	generation(): number;
}

function selected(from: number, to: number, selection: EditorSelection): boolean {
	return selection.ranges.some((r) => r.from <= to && r.to >= from);
}

export function liveExtension(host: LiveHost) {
	class LivePlugin implements PluginValue {
		decorations: DecorationSet = Decoration.none;
		private gen: number;
		/** Ranges already queued for replacement, so a rebuild before it lands doesn't roll twice. */
		private pending = new Set<string>();

		constructor(view: EditorView) {
			this.gen = host.generation();
			this.build(view);
		}

		update(update: ViewUpdate) {
			if (!update.state.field(editorLivePreviewField)) {
				this.decorations = Decoration.none;
				return;
			}
			const gen = host.generation();
			// The syntax-tree check catches lazy parsing catching up after a scroll.
			if (
				update.docChanged ||
				update.viewportChanged ||
				update.selectionSet ||
				gen !== this.gen ||
				syntaxTree(update.startState) !== syntaxTree(update.state)
			) {
				this.gen = gen;
				this.build(update.view);
			}
		}

		private build(view: EditorView) {
			const builder = new RangeSetBuilder<Decoration>();
			if (!view.state.field(editorLivePreviewField)) {
				this.decorations = builder.finish();
				return;
			}
			const doc = view.state.doc;
			const selection = view.state.selection;
			for (const { from, to } of view.visibleRanges) {
				syntaxTree(view.state).iterate({
					from,
					to,
					enter: (node) => {
						const type = node.type.name;
						if (!type.includes('inline-code') || type.includes('formatting')) return;
						// Only plain single-backtick code, so the replacement covers exactly `code`.
						const start = node.from - 1;
						const end = node.to + 1;
						if (doc.sliceString(start, node.from) !== '`' || doc.sliceString(node.to, end) !== '`') return;
						if (selected(start, end, selection)) return;

						const code = doc.sliceString(node.from, node.to);
						if (!parseCommand(code)) return;
						const key = `${start}:${code}`;
						if (this.pending.has(key)) return;

						const outcome = host.run(code);
						if (!outcome) return;
						if (!outcome.ok) {
							builder.add(
								start,
								end,
								Decoration.mark({ class: 'rrt-error', attributes: { title: outcome.error, 'aria-label': outcome.error } }),
							);
							return;
						}

						// Can't change the document while CodeMirror is building decorations, so the
						// replacement goes in on the next tick, after checking the code is still there.
						this.pending.add(key);
						const raw = '`' + code + '`';
						window.setTimeout(() => {
							this.pending.delete(key);
							if (view.state.doc.sliceString(start, end) !== raw) return;
							view.dispatch({ changes: { from: start, to: end, insert: outcome.text } });
						}, 0);
					},
				});
			}
			this.decorations = builder.finish();
		}
	}

	return ViewPlugin.fromClass(LivePlugin, { decorations: (v) => v.decorations });
}

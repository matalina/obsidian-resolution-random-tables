// Reading view: `pick:…`, `oracle:…` and `task:…` roll as soon as they render and the results are
// written into the file in place of the code — once, the same way Tag and Tally's `pick:` works.
// A command that can't roll stays as code, marked in red with the reason on hover.

import { App, MarkdownPostProcessorContext, TFile } from 'obsidian';
import { Outcome, parseCommand } from './engine';
import { writeResults } from './write';

export function readingProcessor(app: App, run: (code: string) => Outcome | null) {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		const codes = Array.from(el.querySelectorAll('code')).filter((c) => !c.closest('pre'));
		if (!codes.length) return;
		const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(file instanceof TFile)) return;

		const writes: { raw: string; text: string }[] = [];
		for (const node of codes) {
			const code = node.textContent ?? '';
			if (!parseCommand(code)) continue;
			const outcome = run(code);
			if (!outcome) continue;
			if (!outcome.ok) {
				node.addClass('rrt-error');
				node.setAttr('title', outcome.error);
				continue;
			}
			writes.push({ raw: '`' + code + '`', text: outcome.text });
			// Show the result straight away; the file write re-renders the section with the real text.
			node.replaceWith(createSpan({ text: outcome.text }));
		}
		if (!writes.length) return;

		const section = ctx.getSectionInfo(el);
		void app.vault.process(file, (data) => writeResults(data, writes, section?.lineStart, section?.lineEnd));
	};
}

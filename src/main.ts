import { Notice, Plugin } from 'obsidian';
import { Outcome, parseCommand, runCommand, TableRegistry } from './engine';
import { liveExtension } from './live';
import { readingProcessor } from './reading';
import { DEFAULT_SETTINGS, PluginSettings, SettingsTab } from './settings';
import { VaultTables } from './store';
import { TableSuggest } from './suggest';

export default class ResolutionTablesPlugin extends Plugin {
	settings: PluginSettings;
	readonly registry = new TableRegistry();
	private tables: VaultTables;
	private gen = 0;
	/** Nothing rolls until the vault's tables are loaded, or every `pick:` would fail on startup. */
	private ready = false;

	async onload() {
		await this.loadSettings();
		this.tables = new VaultTables(this.app, this.registry, () => this.settings.tablesFolder);

		this.app.workspace.onLayoutReady(async () => {
			await this.reloadTables();
			this.ready = true;
			this.refresh();
		});
		this.registerEvent(
			this.app.metadataCache.on('changed', (file, data, cache) => {
				this.tables.onChanged(file, data, cache);
				this.gen++;
			}),
		);
		this.registerEvent(this.app.vault.on('delete', (file) => this.tables.onDelete(file)));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.tables.onRename(file, oldPath)));

		this.registerMarkdownPostProcessor(readingProcessor(this.app, (code) => this.run(code)));
		this.registerEditorExtension(liveExtension({ run: (code) => this.run(code), generation: () => this.gen }));
		this.registerEditorSuggest(new TableSuggest(this.app, this.registry));
		this.addSettingTab(new SettingsTab(this.app, this));

		this.addCommand({
			id: 'reload-tables',
			name: 'Reload tables',
			callback: async () => {
				await this.reloadTables();
				this.refresh();
				new Notice(`Loaded ${this.registry.all().length} tables`);
			},
		});
	}

	/** Roll the text inside a pair of backticks; null when it isn't ours or tables aren't loaded yet. */
	run(code: string): Outcome | null {
		if (!this.ready) return null;
		const command = parseCommand(code);
		if (!command) return null;
		return runCommand(command, { registry: this.registry, settings: this.settings });
	}

	async reloadTables() {
		await this.tables.loadAll();
		this.gen++;
	}

	/** Re-run the editor extension and re-render reading views, so anything waiting rolls now. */
	private refresh() {
		this.gen++;
		this.app.workspace.updateOptions();
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view as { previewMode?: { rerender(full?: boolean): void } };
			view.previewMode?.rerender(true);
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<PluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.gen++;
	}
}

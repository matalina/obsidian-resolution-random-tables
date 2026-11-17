import { App, debounce, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_RESOLUTION, ResolutionSettings } from './engine';
import { isDiceFormula } from './dice';
import type ResolutionTablesPlugin from './main';

export interface PluginSettings extends ResolutionSettings {
	/** Only notes in this folder are searched for tables; blank = the whole vault. */
	tablesFolder: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	...DEFAULT_RESOLUTION,
	tablesFolder: '',
};

export class SettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: ResolutionTablesPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		const reload = debounce(() => void this.plugin.reloadTables().then(() => this.updateCount()), 600, true);

		new Setting(containerEl)
			.setName('Tables folder')
			.setDesc('Only notes in this folder (and its subfolders) are searched for tables. Leave blank to use the whole vault.')
			.addText((t) =>
				t
					.setPlaceholder('Whole vault')
					.setValue(s.tablesFolder)
					.onChange(async (v) => {
						s.tablesFolder = v.trim();
						await this.plugin.saveSettings();
						reload();
					}),
			);
		this.countEl = containerEl.createDiv({ cls: 'setting-item-description rrt-count' });
		this.updateCount();

		new Setting(containerEl)
			.setName('Show the roll')
			.setDesc('Write the roll after the result, in italics.')
			.addToggle((t) =>
				t.setValue(s.showRolls).onChange(async (v) => {
					s.showRolls = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName('Oracle and task').setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'A results table can override any of these with lines like "dc: 12" or "step: 2" between its heading and the table.',
		});

		new Setting(containerEl)
			.setName('Die')
			.setDesc('Rolled for the oracle and tasks when the results table does not name a die in its header.')
			.addText((t) =>
				t.setValue(s.die).onChange(async (v) => {
					if (!isDiceFormula(v)) return;
					s.die = v.trim();
					await this.plugin.saveSettings();
				}),
			);

		this.number(containerEl, 'Oracle DC', 'DC for a 50/50 question: oracle:', s.oracleDc, (v) => (s.oracleDc = v));
		this.number(
			containerEl,
			'Likelihood shift',
			'How much each + lowers, and each - raises, the oracle DC: oracle:+ and oracle:--',
			s.shift,
			(v) => (s.shift = v),
		);
		this.number(containerEl, 'Task base', 'Task DC = base + level × step', s.taskBase, (v) => (s.taskBase = v));
		this.number(containerEl, 'Task step', 'Task DC = base + level × step', s.taskStep, (v) => (s.taskStep = v));

		new Setting(containerEl)
			.setName('Default oracle table')
			.setDesc('A table from your vault to answer oracle: when none is named. Leave blank for the built-in yes and no bands.')
			.addText((t) =>
				t.setValue(s.oracleTable).onChange(async (v) => {
					s.oracleTable = v.trim();
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName('Default task table')
			.setDesc('A table from your vault to answer task: when none is named. Leave blank for the built-in success and fail bands.')
			.addText((t) =>
				t.setValue(s.taskTable).onChange(async (v) => {
					s.taskTable = v.trim();
					await this.plugin.saveSettings();
				}),
			);
	}

	private countEl: HTMLElement;

	private updateCount() {
		const tables = this.plugin.registry.all();
		const notes = new Set(tables.map((t) => t.path)).size;
		this.countEl?.setText(`Found ${tables.length} table${tables.length === 1 ? '' : 's'} in ${notes} note${notes === 1 ? '' : 's'}.`);
	}

	private number(el: HTMLElement, name: string, desc: string, value: number, set: (v: number) => void) {
		new Setting(el)
			.setName(name)
			.setDesc(desc)
			.addText((t) => {
				t.inputEl.type = 'number';
				t.setValue(String(value)).onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isNaN(n)) return;
					set(n);
					await this.plugin.saveSettings();
				});
			});
	}
}

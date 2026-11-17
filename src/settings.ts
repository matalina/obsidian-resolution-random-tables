import { App, debounce, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
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

type Key = keyof PluginSettings;

const TEXT_KEYS: Key[] = ['tablesFolder', 'die', 'oracleTable', 'taskTable'];
const NUMBER_KEYS: Key[] = ['oracleDc', 'shift', 'taskBase', 'taskStep'];

export class SettingsTab extends PluginSettingTab {
	private countEl: HTMLElement | null = null;
	private readonly reload: () => void;

	constructor(
		app: App,
		private readonly plugin: ResolutionTablesPlugin,
	) {
		super(app, plugin);
		this.reload = debounce(() => void this.plugin.reloadTables().then(() => this.updateCount()), 600, true);
	}

	// Rendered by Obsidian from these definitions, which also feed its settings search.
	getSettingDefinitions(): SettingDefinitionItem<Key>[] {
		return [
			{
				name: 'Tables folder',
				desc: 'Only notes in this folder (and its subfolders) are searched for tables. Leave blank to use the whole vault.',
				control: { type: 'folder', key: 'tablesFolder', placeholder: 'Whole vault' },
			},
			{
				name: 'Tables found',
				searchable: false,
				render: (setting) => {
					this.countEl = setting.descEl;
					this.updateCount();
					return () => (this.countEl = null);
				},
			},
			{
				name: 'Show the roll',
				desc: 'Write the roll after the result, in italics.',
				control: { type: 'toggle', key: 'showRolls' },
			},
			{
				type: 'group',
				heading: 'Oracle and task',
				items: [
					{
						name: 'Die',
						desc: 'Rolled for the oracle and tasks when the results table does not name a die in its header.',
						aliases: ['dice'],
						control: {
							type: 'text',
							key: 'die',
							placeholder: DEFAULT_SETTINGS.die,
							validate: (v) => (isDiceFormula(v) ? undefined : 'Not a dice formula, e.g. 1d20 or 2d6+1'),
						},
					},
					{
						name: 'Oracle DC',
						desc: 'DC for a 50/50 question: oracle:',
						control: { type: 'number', key: 'oracleDc', step: 1 },
					},
					{
						name: 'Likelihood shift',
						desc: 'How much each + lowers, and each - raises, the oracle DC: oracle:+ and oracle:--',
						control: { type: 'number', key: 'shift', step: 1 },
					},
					{
						name: 'Task base',
						desc: 'Task DC = base + level × step',
						control: { type: 'number', key: 'taskBase', step: 1 },
					},
					{
						name: 'Task step',
						desc: 'Task DC = base + level × step',
						control: { type: 'number', key: 'taskStep', step: 1 },
					},
					{
						name: 'Default oracle table',
						desc: 'A table from your vault to answer oracle: when none is named. Leave blank for the built-in yes and no bands.',
						control: { type: 'text', key: 'oracleTable' },
					},
					{
						name: 'Default task table',
						desc: 'A table from your vault to answer task: when none is named. Leave blank for the built-in success and fail bands.',
						control: { type: 'text', key: 'taskTable' },
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as Key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings as unknown as Record<string, unknown>;
		if (TEXT_KEYS.includes(key as Key)) {
			const text = typeof value === 'string' ? value.trim() : '';
			if (key === 'die' && !isDiceFormula(text)) return;
			s[key] = text;
		} else if (NUMBER_KEYS.includes(key as Key)) {
			const n = typeof value === 'number' ? value : parseInt(String(value), 10);
			if (!Number.isFinite(n)) return;
			s[key] = Math.trunc(n);
		} else if (key === 'showRolls') {
			s[key] = value === true;
		} else {
			return;
		}
		await this.plugin.saveSettings();
		if (key === 'tablesFolder') this.reload();
	}

	private updateCount() {
		const tables = this.plugin.registry.all();
		const notes = new Set(tables.map((t) => t.path)).size;
		this.countEl?.setText(`${tables.length} table${tables.length === 1 ? '' : 's'} in ${notes} note${notes === 1 ? '' : 's'}.`);
	}
}

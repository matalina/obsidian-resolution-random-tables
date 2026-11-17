// Keeps the table registry in step with the vault: loads every note that has a table once the
// layout is ready, then re-parses a note whenever Obsidian re-indexes it.

import { App, CachedMetadata, TAbstractFile, TFile } from 'obsidian';
import { TableRegistry } from './engine';
import { parseTables } from './tables';

export class VaultTables {
	constructor(
		private readonly app: App,
		readonly registry: TableRegistry,
		private readonly folder: () => string,
	) {}

	private inScope(path: string): boolean {
		const folder = this.folder().trim().replace(/^\/+|\/+$/g, '');
		return !folder || path === folder || path.startsWith(folder + '/');
	}

	private mightHaveTables(cache: CachedMetadata | null): boolean {
		// Without a cache yet, read the file rather than miss it.
		if (!cache) return true;
		return !!cache.headings?.length && !!cache.sections?.some((s) => s.type === 'table');
	}

	async loadAll(): Promise<void> {
		this.registry.clear();
		const files = this.app.vault.getMarkdownFiles().filter((f) => this.inScope(f.path));
		await Promise.all(files.map((f) => this.loadFile(f)));
	}

	async loadFile(file: TFile, content?: string, cache?: CachedMetadata): Promise<void> {
		if (!this.inScope(file.path)) {
			this.registry.removeFile(file.path);
			return;
		}
		if (!this.mightHaveTables(cache ?? this.app.metadataCache.getFileCache(file))) {
			this.registry.removeFile(file.path);
			return;
		}
		const text = content ?? (await this.app.vault.cachedRead(file));
		this.registry.setFile(file.path, parseTables(text, file.path));
	}

	onChanged = (file: TFile, data: string, cache: CachedMetadata): void => {
		void this.loadFile(file, data, cache);
	};

	onDelete = (file: TAbstractFile): void => {
		this.registry.removeFile(file.path);
	};

	onRename = (file: TAbstractFile, oldPath: string): void => {
		this.registry.removeFile(oldPath);
		if (file instanceof TFile && file.extension === 'md') void this.loadFile(file);
	};
}

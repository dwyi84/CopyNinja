/**
 * In-memory clipboard history. This module is deliberately free of Shell/St
 * imports so it can be exercised by `gjs -m tests/run.js`.
 */
export class HistoryStore {
    constructor({limit = 500} = {}) {
        this.limit = Math.max(1, Number(limit) || 500);
        this.items = [];
    }

    setLimit(limit) {
        this.limit = Math.max(1, Number(limit) || this.limit);
        return this._trim();
    }

    replaceAll(items) {
        this.items = (Array.isArray(items) ? items : [])
            .filter(item => item && item.kind && item.hash)
            .slice(0, this.limit);
    }

    /**
     * Inserts an entry, deduplicating by content hash. Re-copied content is
     * promoted to the top of the list and keeps its existing image files.
     */
    add(item) {
        const index = this.items.findIndex(existing => existing.hash === item.hash);
        if (index >= 0) {
            const [existing] = this.items.splice(index, 1);
            existing.createdAt = item.createdAt;
            existing.sourceApp = item.sourceApp ?? existing.sourceApp;
            this.items.unshift(existing);
            return {item: existing, removed: []};
        }

        this.items.unshift(item);
        return {item, removed: this._trim()};
    }

    promote(item) {
        const index = this.items.findIndex(existing => existing.id === item.id);
        if (index < 0)
            return item;

        const [existing] = this.items.splice(index, 1);
        existing.createdAt = new Date();
        this.items.unshift(existing);
        return existing;
    }

    removeById(id) {
        const index = this.items.findIndex(item => item.id === id);
        if (index < 0)
            return null;
        return this.items.splice(index, 1)[0];
    }

    clear() {
        this.items = [];
    }

    filtered(query = '') {
        const needle = String(query).normalize('NFC').trim().toLocaleLowerCase();
        if (!needle)
            return this.items;

        return this.items.filter(item =>
            (item.searchText ?? '').normalize('NFC').toLocaleLowerCase().includes(needle));
    }

    /** 1–9 map to the first nine entries, 0 maps to the tenth. */
    quickSlot(query, slot) {
        const list = this.filtered(query);
        const index = slot === 0 ? 9 : slot - 1;
        return list[index] ?? null;
    }

    _trim() {
        if (this.items.length <= this.limit)
            return [];
        return this.items.splice(this.limit);
    }
}

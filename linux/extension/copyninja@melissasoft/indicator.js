import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {ClipboardItem} from './model.js';
import {ClipboardCapture} from './capture.js';
import {HistoryStore} from './store.js';
import {HistoryStorage} from './storage.js';
import {makeThumbnail} from './image.js';
import {formatBytes, formatTimestamp, quickSlotLabel} from './format.js';
import {_} from './i18n.js';
import {UpdateManager} from './updater.js';

const Cairo = imports.gi.cairo;

const PANEL_ICON_SIZE = 18;
const POPUP_WIDTH = 360;
const QUICK_KEYS = {
    [Clutter.KEY_1]: 1,
    [Clutter.KEY_2]: 2,
    [Clutter.KEY_3]: 3,
    [Clutter.KEY_4]: 4,
    [Clutter.KEY_5]: 5,
    [Clutter.KEY_6]: 6,
    [Clutter.KEY_7]: 7,
    [Clutter.KEY_8]: 8,
    [Clutter.KEY_9]: 9,
    [Clutter.KEY_0]: 0,
};

function mapPoint(x, y, size) {
    const scale = size / 100;
    return [(x - 50) * scale + size / 2, (y - 50) * scale + size / 2];
}

function quadTo(cr, from, control, to) {
    const c1 = [
        from[0] + (2 / 3) * (control[0] - from[0]),
        from[1] + (2 / 3) * (control[1] - from[1]),
    ];
    const c2 = [
        to[0] + (2 / 3) * (control[0] - to[0]),
        to[1] + (2 / 3) * (control[1] - to[1]),
    ];
    cr.curveTo(c1[0], c1[1], c2[0], c2[1], to[0], to[1]);
}

function drawShuriken(cr, size) {
    const p = (x, y) => mapPoint(x, y, size);

    const top = p(50, 4);
    const right = p(96, 50);
    const bottom = p(50, 96);
    const left = p(4, 50);

    cr.moveTo(top[0], top[1]);
    quadTo(cr, top, p(61, 39), right);
    quadTo(cr, right, p(61, 61), bottom);
    quadTo(cr, bottom, p(39, 61), left);
    quadTo(cr, left, p(39, 39), top);
    cr.closePath();

    const center = p(50, 50);
    cr.newSubPath();
    cr.arc(center[0], center[1], 9 * (size / 100), 0, 2 * Math.PI);

    cr.setFillRule(Cairo.FillRule.EVEN_ODD);
    cr.fill();
}

export const CopyNinjaIndicator = GObject.registerClass(
class CopyNinjaIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'CopyNinja');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._updater = new UpdateManager({
            extension,
            onStateChanged: () => this._syncUpdateButton(),
            onBeforeDialog: () => this.menu?.close(),
        });
        this._versionLabel = null;
        this._updateButton = null;

        this._store = new HistoryStore({limit: this._settings.get_int('history-limit')});
        this._storage = new HistoryStorage();
        this._clipboard = St.Clipboard.get_default();

        this._capture = new ClipboardCapture({
            settings: this._settings,
            onCapture: capture => this._handleCapture(capture),
        });

        this._rows = [];
        this._selectedIndex = 0;
        this._searchTimeoutId = 0;
        this._previewDialog = null;
        this._confirmDialog = null;
        this._settingsIds = [];

        this._buildPanelIcon();
        this._buildMenu();
        this._connectSettings();
        this._initialize();
        this._updater.checkForUpdates(false);
    }

    // -------------------------------------------------------------------- panel

    _buildPanelIcon() {
        this.add_style_class_name('copyninja-panel-button');

        this._iconArea = new St.DrawingArea({style_class: 'copyninja-panel-icon'});
        this._iconArea.set_size(PANEL_ICON_SIZE, PANEL_ICON_SIZE);
        this._iconArea.y_align = Clutter.ActorAlign.CENTER;
        this._iconArea.connect('repaint', () => this._drawPanelIcon());
        this.add_child(this._iconArea);

        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._themeChangedId = this._themeContext.connect('changed',
            () => this._iconArea?.queue_repaint());

        this._iconArea.queue_repaint();
    }

    _drawPanelIcon() {
        if (!this._iconArea)
            return;

        const cr = this._iconArea.get_context();
        const [surfaceWidth, surfaceHeight] = this._iconArea.get_surface_size();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
        const logicalWidth = surfaceWidth / scale;
        const logicalHeight = surfaceHeight / scale;

        cr.save();
        cr.translate(
            (logicalWidth - PANEL_ICON_SIZE) / 2,
            (logicalHeight - PANEL_ICON_SIZE) / 2);

        const color = this._iconArea.get_theme_node().get_foreground_color();
        if (color.alpha === 0)
            cr.setSourceRGBA(1, 1, 1, 1);
        else
            cr.setSourceRGBA(color.red / 255, color.green / 255,
                color.blue / 255, color.alpha / 255);

        drawShuriken(cr, PANEL_ICON_SIZE);
        cr.restore();
        cr.$dispose();
    }

    // -------------------------------------------------------------------- menu

    _buildMenu() {
        this.menu.box.add_style_class_name('copyninja-menu');
        this.menu.box.set_width(POPUP_WIDTH);

        this._buildHeader();
        this._buildSearch();
        this._buildList();
        this._buildFooter();

        this.menu.connect('open-state-changed', (menu, open) => {
            if (open)
                this._opened();
            else
                this._closed();
        });
    }

    _buildHeader() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'copyninja-header-item',
        });

        const box = new St.BoxLayout({x_expand: true, style_class: 'copyninja-header'});

        const icon = new St.DrawingArea({style_class: 'copyninja-header-icon'});
        icon.set_size(18, 18);
        icon.y_align = Clutter.ActorAlign.CENTER;
        icon.connect('repaint', () => {
            const cr = icon.get_context();
            const [w, h] = icon.get_surface_size();
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
            cr.save();
            cr.translate((w / scale - 18) / 2, (h / scale - 18) / 2);
            const color = icon.get_theme_node().get_foreground_color();
            if (color.alpha === 0)
                cr.setSourceRGBA(1, 1, 1, 1);
            else
                cr.setSourceRGBA(color.red / 255, color.green / 255,
                    color.blue / 255, color.alpha / 255);
            drawShuriken(cr, 18);
            cr.restore();
            cr.$dispose();
        });
        box.add_child(icon);

        box.add_child(new St.Label({
            text: _('CopyNinja'),
            style_class: 'copyninja-title',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._versionLabel = new St.Label({
            text: `v${this._updater.currentVersion}`,
            style_class: 'copyninja-version',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._versionLabel);
        box.add_child(new St.Widget({x_expand: true}));

        this._updateButton = new St.Button({
            style_class: 'copyninja-header-btn copyninja-header-update-idle',
            can_focus: false,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
            label: _('Check for Updates'),
        });
        this._updateButton.connect('clicked', () => this._onUpdateButtonClicked());
        box.add_child(this._updateButton);

        this._clearButton = new St.Button({
            style_class: 'copyninja-icon-button',
            can_focus: false,
            child: new St.Icon({icon_name: 'edit-delete-symbolic', icon_size: 16}),
        });
        this._clearButton.connect('clicked', () => this._confirmClear());
        box.add_child(this._clearButton);

        const settingsButton = new St.Button({
            style_class: 'copyninja-icon-button',
            can_focus: false,
            child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16}),
        });
        settingsButton.connect('clicked', () => {
            this.menu.close();
            this._extension.openPreferences();
        });
        box.add_child(settingsButton);

        item.add_child(box);
        this.menu.addMenuItem(item);
        this._syncUpdateButton();
    }

    _onUpdateButtonClicked() {
        if (!this._updater)
            return;
        if (this._updater.state === 'available')
            this._updater.promptInstallUpdate();
        else
            this._updater.checkForUpdates(true);
    }

    _syncUpdateButton() {
        if (this._versionLabel && this._updater)
            this._versionLabel.text = `v${this._updater.currentVersion}`;

        if (!this._updateButton || !this._updater)
            return;

        const state = this._updater.state ?? 'idle';
        let label;
        let styleClass = 'copyninja-header-btn copyninja-header-update-idle';
        let reactive = true;

        switch (state) {
        case 'available':
            label = `v${this._updater.latestVersion} ${_('Update')}`;
            styleClass = 'copyninja-header-update-btn';
            break;
        case 'checking':
            label = _('Checking…');
            reactive = false;
            break;
        case 'installing':
            label = _('Updating…');
            reactive = false;
            break;
        case 'up_to_date':
            label = _('✓ Up to date');
            reactive = false;
            break;
        case 'installed':
            label = _('✓ Updated');
            reactive = false;
            break;
        case 'failed':
            label = _('Check failed');
            break;
        default:
            label = _('Check for Updates');
            break;
        }

        this._updateButton.style_class = styleClass;
        this._updateButton.label = label;
        this._updateButton.reactive = reactive;
        if (reactive)
            this._updateButton.remove_style_pseudo_class('insensitive');
        else
            this._updateButton.add_style_pseudo_class('insensitive');
    }

    _buildSearch() {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'copyninja-search-item',
        });

        const box = new St.BoxLayout({x_expand: true, style_class: 'copyninja-search-box'});
        box.add_child(new St.Icon({
            icon_name: 'edit-find-symbolic',
            icon_size: 14,
            style_class: 'copyninja-search-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._searchEntry = new St.Entry({
            style_class: 'copyninja-search-entry',
            can_focus: true,
            x_expand: true,
            hint_text: _('Search history'),
        });
        this._searchEntry.get_clutter_text().connect('text-changed', () => this._onSearchChanged());
        this._searchEntry.get_clutter_text().connect('key-press-event',
            (actor, event) => this._onKeyPress(actor, event));
        box.add_child(this._searchEntry);

        this._searchClear = new St.Button({
            style_class: 'copyninja-search-clear',
            can_focus: false,
            visible: false,
            child: new St.Icon({icon_name: 'edit-clear-symbolic', icon_size: 14}),
        });
        this._searchClear.connect('clicked', () => this._searchEntry.set_text(''));
        box.add_child(this._searchClear);

        item.add_child(box);
        this.menu.addMenuItem(item);
    }

    _buildList() {
        this._listSection = new PopupMenu.PopupMenuSection();
        this._scroll = new St.ScrollView({
            style_class: 'copyninja-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });
        this._scroll.add_child(this._listSection.actor);

        const section = new PopupMenu.PopupMenuSection();
        section.actor.add_child(this._scroll);
        this.menu.addMenuItem(section);
    }

    _buildFooter() {
        const hintItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'copyninja-hint-item',
        });
        const hints = new St.BoxLayout({vertical: true, style_class: 'copyninja-hints'});
        hints.add_child(new St.Label({
            text: _('Up/Down Move · Enter Copy · Ctrl+1~0 Quick'),
            style_class: 'copyninja-hint',
        }));
        hints.add_child(new St.Label({
            text: _('Space Preview · Esc Close'),
            style_class: 'copyninja-hint',
        }));
        hintItem.add_child(hints);
        this.menu.addMenuItem(hintItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const clearItem = new PopupMenu.PopupMenuItem(_('Clear all history'));
        clearItem.connect('activate', () => this._confirmClear());
        this.menu.addMenuItem(clearItem);
    }

    // -------------------------------------------------------------------- state

    toggle() {
        if (this.menu.isOpen)
            this.menu.close();
        else
            this.menu.open();
    }

    async _initialize() {
        try {
            const items = await this._storage.load();
            this._store.replaceAll(items);
            const referenced = items
                .flatMap(item => [item.image, item.thumb])
                .filter(Boolean);
            this._storage.pruneOrphans(referenced);
            this._refresh();
        } catch (error) {
            console.warn(`CopyNinja: could not initialise history — ${error.message}`);
        } finally {
            this._capture.start();
        }
    }

    _connectSettings() {
        this._settingsIds.push(this._settings.connect('changed::history-limit', () => {
            const removed = this._store.setLimit(this._settings.get_int('history-limit'));
            this._storage.save(this._store.items);
            this._deleteItems(removed);
            this._refresh();
        }));

        this._settingsIds.push(this._settings.connect('changed::clear-request',
            () => this._clearAll()));
    }

    _opened() {
        this._searchEntry.set_text('');
        this._selectedIndex = 0;
        this._refresh();
        this._syncUpdateButton();

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            if (this.menu.isOpen && this._searchEntry)
                global.stage.set_key_focus(this._searchEntry);
            return GLib.SOURCE_REMOVE;
        });
    }

    _closed() {
        if (this._previewDialog) {
            this._previewDialog.close();
            this._previewDialog = null;
        }
    }

    _onSearchChanged() {
        if (this._searchTimeoutId)
            GLib.source_remove(this._searchTimeoutId);

        const text = this._searchEntry.get_text();
        this._searchClear.visible = text.length > 0;
        this._selectedIndex = 0;

        this._searchTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            this._searchTimeoutId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    // -------------------------------------------------------------------- list

    _refresh() {
        if (!this._listSection)
            return;

        const query = this._searchEntry?.get_text() ?? '';
        const items = this._store.filtered(query);

        this._clearList();
        this._rows = [];

        if (items.length === 0) {
            this._addEmptyItem(query);
            this._selectedIndex = 0;
        } else {
            for (let index = 0; index < items.length; index++)
                this._addRow(items[index], index);
            this._selectedIndex = Math.max(0,
                Math.min(this._selectedIndex, items.length - 1));
        }

        this._applySelection();
        this._updateClearButton();
    }

    _clearList() {
        if (typeof this._listSection.removeAll === 'function') {
            this._listSection.removeAll();
            return;
        }
        for (const item of this._listSection._getMenuItems())
            item.destroy();
    }

    _addEmptyItem(query) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'copyninja-empty-item',
        });
        const box = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'copyninja-empty'});
        box.add_child(new St.Icon({
            icon_name: 'edit-copy-symbolic',
            icon_size: 40,
            style_class: 'copyninja-empty-icon',
        }));
        box.add_child(new St.Label({
            text: query ? _('No results') : _('No history yet'),
            style_class: 'copyninja-empty-title',
        }));
        box.add_child(new St.Label({
            text: query ? _('Try a different search term.') : _('Copied text and images will appear here.'),
            style_class: 'copyninja-empty-subtitle',
        }));
        item.add_child(box);
        this._listSection.addMenuItem(item);
    }

    _addRow(entry, index) {
        const row = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: false,
            style_class: 'copyninja-row',
        });
        row.entry = entry;

        const box = new St.BoxLayout({x_expand: true, style_class: 'copyninja-row-box'});

        if (entry.kind === 'image') {
            const thumbPath = entry.thumb ? this._storage.thumbPath(entry.thumb) : null;
            if (thumbPath && GLib.file_test(thumbPath, GLib.FileTest.EXISTS)) {
                box.add_child(new St.Icon({
                    gicon: Gio.icon_new_for_string(thumbPath),
                    icon_size: 34,
                    style_class: 'copyninja-thumb',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            } else {
                box.add_child(new St.Icon({
                    icon_name: 'image-x-generic-symbolic',
                    icon_size: 18,
                    style_class: 'copyninja-row-icon',
                    y_align: Clutter.ActorAlign.CENTER,
                }));
            }
        } else {
            box.add_child(new St.Icon({
                icon_name: 'text-x-generic-symbolic',
                icon_size: 16,
                style_class: 'copyninja-row-icon',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        const textBox = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'copyninja-row-text'});
        const preview = new St.Label({
            text: entry.kind === 'image' ? _('Image') : entry.preview,
            style_class: 'copyninja-preview',
        });
        preview.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        preview.clutter_text.set_line_wrap(false);
        textBox.add_child(preview);

        const meta = entry.kind === 'image'
            ? `${formatTimestamp(entry.createdAt)} · ${formatBytes(entry.size)}`
            : `${formatTimestamp(entry.createdAt)} · ${entry.text.length}`;
        textBox.add_child(new St.Label({text: meta, style_class: 'copyninja-meta'}));

        box.add_child(textBox);

        const slot = quickSlotLabel(index);
        if (slot) {
            box.add_child(new St.Label({
                text: `Ctrl+${slot}`,
                style_class: 'copyninja-badge',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        row.add_child(box);
        row.connect('activate', () => this._copyItem(entry));
        this._listSection.addMenuItem(row);
        this._rows.push(row);
    }

    _applySelection() {
        for (let index = 0; index < this._rows.length; index++) {
            const row = this._rows[index];
            if (index === this._selectedIndex)
                row.add_style_class_name('copyninja-row-selected');
            else
                row.remove_style_class_name('copyninja-row-selected');
        }
        this._ensureVisible();
    }

    _ensureVisible() {
        const row = this._rows[this._selectedIndex];
        if (!row)
            return;

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!row.get_stage())
                return GLib.SOURCE_REMOVE;

            const adjustment = this._scroll.vadjustment ?? this._scroll.vscroll?.adjustment;
            if (!adjustment)
                return GLib.SOURCE_REMOVE;

            const allocation = row.get_allocation_box();
            let y1 = allocation.y1;
            let y2 = allocation.y2;
            let parent = row.get_parent();
            while (parent && parent !== this._scroll) {
                const parentBox = parent.get_allocation_box();
                y1 += parentBox.y1;
                y2 += parentBox.y1;
                parent = parent.get_parent();
            }

            if (y1 < adjustment.value)
                adjustment.value = Math.max(0, y1);
            else if (y2 > adjustment.value + adjustment.page_size)
                adjustment.value = Math.min(adjustment.upper - adjustment.page_size,
                    y2 - adjustment.page_size);

            return GLib.SOURCE_REMOVE;
        });
    }

    _updateClearButton() {
        if (!this._clearButton)
            return;
        const enabled = this._store.items.length > 0;
        this._clearButton.reactive = enabled;
        this._clearButton.opacity = enabled ? 255 : 120;
    }

    // -------------------------------------------------------------------- keys

    _onKeyPress(actor, event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (ctrl && !shift && QUICK_KEYS[symbol] !== undefined) {
            this._copyQuickSlot(QUICK_KEYS[symbol]);
            return Clutter.EVENT_STOP;
        }

        if (ctrl && shift &&
            (symbol === Clutter.KEY_Delete || symbol === Clutter.KEY_BackSpace)) {
            this._confirmClear();
            return Clutter.EVENT_STOP;
        }

        switch (symbol) {
        case Clutter.KEY_Escape:
            if (this._previewDialog)
                this._previewDialog.close();
            else
                this.menu.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._select(this._selectedIndex - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._select(this._selectedIndex + 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._select(this._selectedIndex - 8);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._select(this._selectedIndex + 8);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Home:
            this._select(0);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_End:
            this._select(this._rows.length - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
            this._copySelected();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_space:
            if (!this._searchEntry.get_text().trim() && this._rows.length > 0) {
                this._showPreview(this._rows[this._selectedIndex]?.entry);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _select(index) {
        if (this._rows.length === 0)
            return;
        this._selectedIndex = Math.max(0, Math.min(index, this._rows.length - 1));
        this._applySelection();
    }

    _copySelected() {
        const row = this._rows[this._selectedIndex];
        if (row)
            this._copyItem(row.entry);
    }

    _copyQuickSlot(slot) {
        const item = this._store.quickSlot(this._searchEntry.get_text(), slot);
        if (item)
            this._copyItem(item);
    }

    // -------------------------------------------------------------------- actions

    async _copyItem(entry) {
        if (!entry)
            return;

        try {
            this._capture.suppressNextChange();

            if (entry.kind === 'text') {
                this._clipboard.set_text(St.ClipboardType.CLIPBOARD, entry.text ?? '');
            } else {
                const bytes = await this._storage.readImage(entry.image);
                if (!bytes)
                    throw new Error('Image file missing');
                this._clipboard.set_content(
                    St.ClipboardType.CLIPBOARD, entry.mime, new GLib.Bytes(bytes));
            }

            this._store.promote(entry);
            this._storage.save(this._store.items);

            if (this._previewDialog)
                this._previewDialog.close();
            this.menu.close();
        } catch (error) {
            console.warn(`CopyNinja: could not copy entry — ${error.message}`);
            Main.notify(_('CopyNinja'), _('Could not copy this item.'));
        }
    }

    _showPreview(entry) {
        if (!entry || this._previewDialog)
            return;

        const dialog = new ModalDialog.ModalDialog({
            styleClass: 'copyninja-preview-dialog',
            destroyOnClose: true,
        });

        const content = new St.BoxLayout({
            vertical: true,
            style_class: 'copyninja-preview-content',
        });

        if (entry.kind === 'text') {
            const scroll = new St.ScrollView({
                style_class: 'copyninja-preview-scroll',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
            });
            const label = new St.Label({
                text: entry.text ?? '',
                style_class: 'copyninja-preview-text',
            });
            label.clutter_text.set_line_wrap(true);
            label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            label.set_width(320);
            scroll.add_child(label);
            scroll.set_height(380);
            content.add_child(scroll);
        } else {
            const path = this._storage.imagePath(entry.image);
            if (path && GLib.file_test(path, GLib.FileTest.EXISTS)) {
                const bin = new St.Bin({style_class: 'copyninja-preview-image-bin'});
                bin.set_child(new St.Icon({
                    gicon: Gio.icon_new_for_string(path),
                    icon_size: 320,
                }));
                content.add_child(bin);
            } else {
                content.add_child(new St.Label({
                    text: _('Image unavailable'),
                    style_class: 'copyninja-preview-text',
                }));
            }
        }

        dialog.contentLayout.add_child(content);
        dialog.addButton({
            label: _('Copy'),
            action: () => {
                dialog.close();
                this._copyItem(entry);
            },
            default: true,
        });
        dialog.addButton({
            label: _('Close'),
            action: () => dialog.close(),
            key: Clutter.KEY_Escape,
        });

        dialog.connect('closed', () => {
            this._previewDialog = null;
            if (this.menu.isOpen)
                global.stage.set_key_focus(this._searchEntry);
        });

        this._previewDialog = dialog;
        dialog.open();
    }

    _confirmClear() {
        if (this._confirmDialog)
            return;

        const dialog = new ModalDialog.ModalDialog({destroyOnClose: true});
        const box = new St.BoxLayout({vertical: true, style_class: 'copyninja-confirm'});
        box.add_child(new St.Label({
            text: _('Clear all clipboard history?'),
            style_class: 'copyninja-confirm-title',
        }));
        box.add_child(new St.Label({
            text: _('This removes every stored entry and image, and clears the system clipboard.'),
            style_class: 'copyninja-confirm-body',
        }));
        dialog.contentLayout.add_child(box);

        dialog.addButton({
            label: _('Cancel'),
            action: () => dialog.close(),
            key: Clutter.KEY_Escape,
        });
        dialog.addButton({
            label: _('Clear All'),
            action: () => {
                dialog.close();
                this._clearAll();
            },
        });

        dialog.connect('closed', () => {
            this._confirmDialog = null;
        });

        this._confirmDialog = dialog;
        dialog.open();
    }

    async _clearAll() {
        this._capture.suppressNextChange();
        this._store.clear();
        await this._storage.clear();
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, '');
        this._refresh();
    }

    // -------------------------------------------------------------------- capture

    async _handleCapture(capture) {
        if (capture.kind === 'text') {
            const entry = new ClipboardItem({
                kind: 'text',
                text: capture.text,
                mime: capture.mime,
                hash: capture.hash,
                size: capture.size,
                sourceApp: capture.sourceApp,
            });
            this._insertItem(entry);
            return;
        }

        const id = GLib.uuid_string_random();
        const thumbnail = await makeThumbnail(capture.bytes);
        const files = await this._storage.saveImage(
            id, capture.mime, capture.bytes, thumbnail?.bytes ?? null);
        if (!files)
            return;

        const entry = new ClipboardItem({
            id,
            kind: 'image',
            mime: capture.mime,
            image: files.image,
            thumb: files.thumb,
            hash: capture.hash,
            size: capture.size,
            sourceApp: capture.sourceApp,
        });

        const result = this._insertItem(entry);
        if (result.item.id !== id) {
            // Duplicate image: the store reused the existing files.
            await this._storage.deleteImages([files.image, files.thumb]);
        }
    }

    _insertItem(entry) {
        const result = this._store.add(entry);
        this._storage.save(this._store.items);
        this._deleteItems(result.removed);

        if (this.menu.isOpen)
            this._refresh();
        this._updateClearButton();
        return result;
    }

    _deleteItems(items) {
        const names = (items ?? [])
            .flatMap(entry => [entry.image, entry.thumb])
            .filter(Boolean);
        if (names.length > 0)
            this._storage.deleteImages(names);
    }

    // -------------------------------------------------------------------- teardown

    destroy() {
        this._capture?.stop();
        this._updater?.destroy();
        this._updater = null;

        if (this._searchTimeoutId) {
            GLib.source_remove(this._searchTimeoutId);
            this._searchTimeoutId = 0;
        }

        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        if (this._themeChangedId) {
            this._themeContext.disconnect(this._themeChangedId);
            this._themeChangedId = 0;
        }

        if (this._previewDialog) {
            this._previewDialog.destroy();
            this._previewDialog = null;
        }
        if (this._confirmDialog) {
            this._confirmDialog.destroy();
            this._confirmDialog = null;
        }

        this._storage.flushSync(this._store.items);
        this._iconArea = null;

        super.destroy();
    }
});

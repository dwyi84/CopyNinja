import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CopyNinjaIndicator} from './indicator.js';

export default class CopyNinjaExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new CopyNinjaIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

        this._bindShortcut();
        this._shortcutChangedId = this._settings.connect('changed::toggle-copyninja',
            () => this._rebindShortcut());
    }

    disable() {
        if (this._shortcutChangedId) {
            this._settings.disconnect(this._shortcutChangedId);
            this._shortcutChangedId = 0;
        }

        this._unbindShortcut();
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    _bindShortcut() {
        try {
            Main.wm.addKeybinding(
                'toggle-copyninja',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._indicator?.toggle());
        } catch (error) {
            console.warn(`CopyNinja: could not bind toggle shortcut — ${error.message}`);
        }
    }

    _unbindShortcut() {
        try {
            Main.wm.removeKeybinding('toggle-copyninja');
        } catch {
            // Not bound yet or already removed.
        }
    }

    _rebindShortcut() {
        this._unbindShortcut();
        this._bindShortcut();
    }
}

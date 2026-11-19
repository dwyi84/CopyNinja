import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {_} from './i18n.js';
import {LINUX_FALLBACK_VERSION} from './version.js';

const REPO_URL = 'https://github.com/dwyi84/CopyNinja';
const LICENSE_URL = 'https://github.com/dwyi84/CopyNinja/blob/main/LICENSE';

function openUri(uri) {
    Gio.AppInfo.launch_default_for_uri(uri, null);
}

export default class CopyNinjaPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(620, 680);
        window.search_enabled = true;

        const settings = this.getSettings();
        const version = this.metadata['version-name'] ?? LINUX_FALLBACK_VERSION;

        const general = new Adw.PreferencesPage({
            title: _('Settings'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(general);

        const behaviour = new Adw.PreferencesGroup({
            title: _('Clipboard history'),
        });
        general.add(behaviour);

        const adjustment = new Gtk.Adjustment({
            lower: 50,
            upper: 2000,
            step_increment: 50,
            page_increment: 250,
            value: settings.get_int('history-limit'),
        });
        const limitRow = new Adw.SpinRow({
            title: _('History size'),
            subtitle: _('Maximum number of entries kept on disk.'),
            adjustment,
        });
        settings.bind('history-limit', adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(limitRow);

        const imageRow = new Adw.SwitchRow({
            title: _('Capture images'),
            subtitle: _('Store image clipboard entries.'),
        });
        settings.bind('capture-images', imageRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(imageRow);

        const shortcutRow = new Adw.ActionRow({title: _('Toggle popup')});
        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: settings.get_strv('toggle-copyninja')[0] ?? '',
            disabled_text: _('Not set'),
            valign: Gtk.Align.CENTER,
        });
        settings.connect('changed::toggle-copyninja', () => {
            shortcutLabel.accelerator = settings.get_strv('toggle-copyninja')[0] ?? '';
        });
        const changeButton = new Gtk.Button({
            label: _('Change'),
            valign: Gtk.Align.CENTER,
        });
        changeButton.connect('clicked', () =>
            this._showShortcutDialog(window, settings));
        shortcutRow.add_suffix(shortcutLabel);
        shortcutRow.add_suffix(changeButton);
        shortcutRow.activatable_widget = changeButton;
        behaviour.add(shortcutRow);

        const privacy = new Adw.PreferencesGroup({title: _('Privacy')});
        general.add(privacy);

        const excludedRow = new Adw.EntryRow({
            title: _('Excluded apps'),
            text: settings.get_strv('excluded-apps').join(', '),
            show_apply_button: true,
        });
        excludedRow.tooltip_text = _('WM_CLASS values, comma separated.');
        excludedRow.connect('apply', () => {
            const apps = excludedRow.text
                .split(',')
                .map(value => value.trim())
                .filter(Boolean);
            settings.set_strv('excluded-apps', apps);
        });
        privacy.add(excludedRow);

        const clearRow = new Adw.ActionRow({title: _('Clear history')});
        const clearButton = new Gtk.Button({
            label: _('Clear All'),
            valign: Gtk.Align.CENTER,
        });
        clearButton.add_css_class('destructive-action');
        clearButton.connect('clicked', () => this._confirmClear(window, settings));
        clearRow.add_suffix(clearButton);
        privacy.add(clearRow);

        const folderRow = new Adw.ActionRow({title: _('Open data folder')});
        const folderButton = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
        });
        folderButton.connect('clicked', () => {
            const dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'copyninja']);
            GLib.mkdir_with_parents(dir, 0o700);
            openUri(Gio.File.new_for_path(dir).get_uri());
        });
        folderRow.add_suffix(folderButton);
        folderRow.activatable_widget = folderButton;
        privacy.add(folderRow);

        const about = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic',
        });
        window.add(about);

        const aboutGroup = new Adw.PreferencesGroup();
        about.add(aboutGroup);

        const versionRow = new Adw.ActionRow({
            title: `CopyNinja for Ubuntu v${version}`,
            subtitle: _('GNOME Shell extension · Ubuntu 24.04+'),
        });
        aboutGroup.add(versionRow);

        const githubRow = new Adw.ActionRow({title: _('GitHub')});
        const githubButton = new Gtk.Button({
            icon_name: 'web-browser-symbolic',
            valign: Gtk.Align.CENTER,
        });
        githubButton.connect('clicked', () => openUri(REPO_URL));
        githubRow.add_suffix(githubButton);
        githubRow.activatable_widget = githubButton;
        aboutGroup.add(githubRow);

        const licenseRow = new Adw.ActionRow({title: _('License')});
        const licenseButton = new Gtk.Button({
            icon_name: 'web-browser-symbolic',
            valign: Gtk.Align.CENTER,
        });
        licenseButton.connect('clicked', () => openUri(LICENSE_URL));
        licenseRow.add_suffix(licenseButton);
        licenseRow.activatable_widget = licenseButton;
        aboutGroup.add(licenseRow);

        const privacyNote = new Adw.PreferencesGroup();
        about.add(privacyNote);
        privacyNote.add(new Adw.ActionRow({
            title: _('Clipboard history stays on this device.'),
            subtitle: 'MIT · MelissaSoft',
        }));
    }

    _showShortcutDialog(parent, settings) {
        const dialog = new Adw.Window({
            transient_for: parent,
            modal: true,
            title: _('Set shortcut'),
            default_width: 380,
            default_height: 160,
            resizable: false,
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
        });
        box.append(new Gtk.Label({
            label: _('Press the new shortcut…'),
            wrap: true,
        }));
        box.append(new Gtk.Label({
            label: _('Include at least one modifier.'),
            wrap: true,
        }));
        const hint = box.get_last_child();
        hint.add_css_class('dim-label');

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (controller, keyval, keycode, state) => {
            if (keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (!Gtk.accelerator_valid(keyval, mods))
                return Gdk.EVENT_PROPAGATE;

            settings.set_strv('toggle-copyninja', [Gtk.accelerator_name(keyval, mods)]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });

        dialog.add_controller(controller);
        dialog.set_content(box);
        dialog.present();
    }

    _confirmClear(parent, settings) {
        const dialog = new Adw.AlertDialog({
            heading: _('Clear all clipboard history?'),
            body: _('This removes every stored entry and image, and clears the system clipboard.'),
        });
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('clear', _('Clear All'));
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');

        dialog.connect('response', (dialog, response) => {
            if (response !== 'clear')
                return;
            settings.set_int('clear-request', settings.get_int('clear-request') + 1);
        });

        dialog.present(parent);
    }
}

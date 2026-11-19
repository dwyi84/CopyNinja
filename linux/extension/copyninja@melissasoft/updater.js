import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {_, t} from './i18n.js';
import {
    LINUX_FALLBACK_VERSION,
    isNewerVersion,
    parseMetadataVersion,
    pickLatestLinuxRelease,
} from './version.js';

const REPO = 'dwyi84/CopyNinja';
const LINUX_METADATA_URL = `https://raw.githubusercontent.com/${REPO}/ubuntu/linux/extension/copyninja@melissasoft/metadata.json`;
const RELEASES_API_URL = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
const REMOTE_INSTALL_URL = `https://raw.githubusercontent.com/${REPO}/ubuntu/linux/remote-install.sh`;
const REPO_HTML_URL = `https://github.com/${REPO}`;

export class UpdateManager {
    constructor({extension, onStateChanged = null, onBeforeDialog = null}) {
        this._extension = extension;
        this._onStateChanged = onStateChanged;
        this._onBeforeDialog = onBeforeDialog;

        this._installedVersion = extension.metadata?.['version-name'] ?? LINUX_FALLBACK_VERSION;
        this._state = 'idle';
        this._latestVersion = null;
        this._latestRef = null;
        this._latestUrl = null;
        this._proc = null;
        this._resetId = 0;
        this._dialog = null;
        this._destroyed = false;
    }

    get currentVersion() {
        return this._installedVersion ?? this._extension?.metadata?.['version-name'] ?? LINUX_FALLBACK_VERSION;
    }

    get state() {
        return this._state;
    }

    get latestVersion() {
        return this._latestVersion;
    }

    _emitState() {
        if (!this._destroyed)
            this._onStateChanged?.(this._state);
    }

    _scheduleIdleReset() {
        if (this._resetId)
            GLib.source_remove(this._resetId);
        this._resetId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
            this._resetId = 0;
            if (!this._destroyed && (this._state === 'up_to_date' || this._state === 'failed')) {
                this._state = 'idle';
                this._emitState();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    checkForUpdates(interactive = false) {
        if (this._destroyed || this._state === 'checking' || this._state === 'installing')
            return;

        if (this._resetId) {
            GLib.source_remove(this._resetId);
            this._resetId = 0;
        }

        this._state = 'checking';
        this._emitState();

        const pyScript = [
            'import json, urllib.request',
            'def fetch_json(url, headers):',
            '    req = urllib.request.Request(url, headers=headers)',
            '    with urllib.request.urlopen(req, timeout=8) as r:',
            '        return json.load(r)',
            'out = None',
            'try:',
            `    d = fetch_json(${JSON.stringify(LINUX_METADATA_URL)}, {'User-Agent': 'CopyNinja-Linux', 'Accept': 'application/json', 'Cache-Control': 'no-cache'})`,
            "    ver = str(d.get('version-name') or '').strip()",
            '    if ver:',
            "        out = {'source': 'metadata', 'metadata': d}",
            'except Exception:',
            '    pass',
            'if out is None:',
            `    d = fetch_json(${JSON.stringify(RELEASES_API_URL)}, {'User-Agent': 'CopyNinja-Linux', 'Accept': 'application/vnd.github+json'})`,
            "    out = {'source': 'releases', 'releases': d}",
            'print(json.dumps(out))',
        ].join('\n');

        let proc;
        try {
            proc = Gio.Subprocess.new(
                ['python3', '-c', pyScript],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            this._proc = proc;
        } catch (error) {
            this._proc = null;
            if (interactive) {
                this._state = 'failed';
                this._emitState();
                this._scheduleIdleReset();
                Main.notify(_('CopyNinja'), _('Failed to check for updates.'));
            } else {
                this._state = 'idle';
                this._emitState();
            }
            return;
        }

        proc.communicate_utf8_async(null, null, (p, result) => {
            let stdout = '';
            let ok = false;
            try {
                [, stdout] = p.communicate_utf8_finish(result);
                ok = p.get_successful();
            } catch {
                ok = false;
            }
            if (this._proc === p)
                this._proc = null;
            if (this._destroyed)
                return;

            let payload = null;
            if (ok && stdout) {
                try {
                    payload = JSON.parse(stdout);
                } catch {
                    payload = null;
                }
            }

            let fetchOk = false;
            let candidate = null;
            if (payload?.source === 'metadata') {
                const version = parseMetadataVersion(payload.metadata);
                if (version) {
                    fetchOk = true;
                    candidate = {
                        version,
                        ref: 'ubuntu',
                        htmlUrl: REPO_HTML_URL,
                    };
                }
            } else if (payload?.source === 'releases' && Array.isArray(payload.releases)) {
                fetchOk = true;
                candidate = pickLatestLinuxRelease(payload.releases);
            }

            if (!fetchOk) {
                if (interactive) {
                    this._state = 'failed';
                    this._emitState();
                    this._scheduleIdleReset();
                    Main.notify(_('CopyNinja'), _('Failed to check for updates.'));
                } else {
                    this._state = 'idle';
                    this._emitState();
                }
                return;
            }

            if (candidate && isNewerVersion(candidate.version, this.currentVersion)) {
                this._latestVersion = candidate.version;
                this._latestRef = candidate.ref || 'ubuntu';
                this._latestUrl = candidate.htmlUrl || REPO_HTML_URL;
                this._state = 'available';
                this._emitState();
                if (interactive)
                    this.promptInstallUpdate();
            } else if (interactive) {
                this._state = 'up_to_date';
                this._emitState();
                this._scheduleIdleReset();
                Main.notify(
                    _('CopyNinja'),
                    t(
                        `최신 버전을 사용 중입니다 (v${this.currentVersion}).`,
                        `You're up to date (v${this.currentVersion}).`
                    )
                );
            } else {
                this._state = 'idle';
                this._emitState();
            }
        });
    }

    promptInstallUpdate() {
        if (this._destroyed || !this._latestVersion || this._dialog)
            return;

        this._onBeforeDialog?.();

        const dialog = new ModalDialog.ModalDialog({destroyOnClose: true});
        const box = new St.BoxLayout({vertical: true, style_class: 'copyninja-update-dialog'});
        box.add_child(new St.Label({
            text: t(`v${this._latestVersion} 버전으로 업데이트하시겠습니까?`, `Update to v${this._latestVersion}?`),
            style_class: 'copyninja-update-dialog-title',
        }));

        const body = new St.Label({
            text: t(
                `CopyNinja v${this._latestVersion}을 사용할 수 있습니다 (현재 버전: v${this.currentVersion}). 자동으로 다운로드하여 설치합니다.`,
                `CopyNinja v${this._latestVersion} is available (current: v${this.currentVersion}). It will be downloaded and installed automatically.`
            ),
            style_class: 'copyninja-update-dialog-body',
        });
        body.clutter_text.line_wrap = true;
        body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        box.add_child(body);

        dialog.contentLayout.add_child(box);
        dialog.addButton({
            label: _('Later'),
            action: () => dialog.close(),
            key: Clutter.KEY_Escape,
        });
        dialog.addButton({
            label: _('Update Now'),
            action: () => {
                dialog.close();
                this.installUpdate();
            },
            default: true,
        });

        dialog.connect('closed', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });

        this._dialog = dialog;
        dialog.open();
    }

    installUpdate() {
        if (this._destroyed || !this._latestRef || this._state === 'installing')
            return;

        this._state = 'installing';
        this._emitState();

        const ref = this._latestRef;
        const targetVer = this._latestVersion;

        let proc;
        try {
            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            launcher.setenv('COPYNINJA_REF', ref, true);

            const localScript = GLib.build_filenamev([this._extension.path, 'remote-install.sh']);
            const cmd = GLib.file_test(localScript, GLib.FileTest.EXISTS)
                ? ['sh', localScript]
                : ['sh', '-c', `curl -fsSL ${REMOTE_INSTALL_URL} | sh`];

            proc = launcher.spawnv(cmd);
            this._proc = proc;
        } catch (error) {
            this._proc = null;
            this._state = 'failed';
            this._emitState();
            this._scheduleIdleReset();
            console.warn(`CopyNinja: failed to launch updater — ${error.message}`);
            Main.notify(_('CopyNinja'), _('Failed to start update installer.'));
            return;
        }

        proc.communicate_utf8_async(null, null, (p, result) => {
            let stderr = '';
            let ok = false;
            try {
                [, , stderr] = p.communicate_utf8_finish(result);
                ok = p.get_successful();
            } catch {
                ok = false;
            }
            if (this._proc === p)
                this._proc = null;
            if (this._destroyed)
                return;

            if (!ok) {
                if (stderr && stderr.trim())
                    console.warn(`CopyNinja update error: ${stderr.trim()}`);
                this._state = 'failed';
                this._emitState();
                this._scheduleIdleReset();
                Main.notify(_('CopyNinja'), _('Failed to install update.'));
                return;
            }

            this._installedVersion = targetVer;
            try {
                if (this._extension.metadata)
                    this._extension.metadata['version-name'] = targetVer;
            } catch {
                // metadata object may be read-only
            }
            this._state = 'installed';
            this._emitState();

            if (!Meta.is_wayland_compositor()) {
                this._promptRestartAfterUpdate(targetVer);
            } else {
                Main.notify(
                    _('CopyNinja'),
                    t(
                        `v${targetVer} 업데이트 설치 완료. 재로그인 시 새 UI가 적용됩니다.`,
                        `Updated to v${targetVer}. Log out and back in to apply the new UI.`
                    )
                );
            }
        });
    }

    _promptRestartAfterUpdate(version) {
        if (this._destroyed || this._dialog)
            return;

        const dialog = new ModalDialog.ModalDialog({destroyOnClose: true});
        const box = new St.BoxLayout({vertical: true, style_class: 'copyninja-update-dialog'});
        box.add_child(new St.Label({
            text: t(`v${version} 설치 완료`, `v${version} Installed`),
            style_class: 'copyninja-update-dialog-title',
        }));

        const body = new St.Label({
            text: t(
                '새 버전이 설치되었습니다. 지금 GNOME Shell을 재시작하여 UI를 바로 적용할까요?',
                'The new version has been installed. Restart GNOME Shell now to apply the updated UI?'
            ),
            style_class: 'copyninja-update-dialog-body',
        });
        body.clutter_text.line_wrap = true;
        body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        box.add_child(body);

        dialog.contentLayout.add_child(box);
        dialog.addButton({
            label: _('Later'),
            action: () => dialog.close(),
            key: Clutter.KEY_Escape,
        });
        dialog.addButton({
            label: _('Restart Now'),
            action: () => {
                dialog.close();
                Meta.restart(t('CopyNinja 업데이트 적용 중…', 'Applying CopyNinja update…'), global.context);
            },
            default: true,
        });

        dialog.connect('closed', () => {
            if (this._dialog === dialog)
                this._dialog = null;
        });

        this._dialog = dialog;
        dialog.open();
    }

    destroy() {
        this._destroyed = true;
        if (this._resetId) {
            GLib.source_remove(this._resetId);
            this._resetId = 0;
        }
        if (this._proc) {
            try {
                this._proc.force_exit();
            } catch {
                // already exited
            }
            this._proc = null;
        }
        if (this._dialog) {
            try {
                this._dialog.close();
            } catch {
                // already closed
            }
            this._dialog = null;
        }
    }
}

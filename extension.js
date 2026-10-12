import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `
<node>
  <interface name="org.gnome.shell.extensions.blackout">
    <method name="Toggle"/>
  </interface>
</node>`;

const MOD_MASK =
    Clutter.ModifierType.SUPER_MASK |
    Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.MOD1_MASK |
    Clutter.ModifierType.SHIFT_MASK;

function lowerKey(keyval) {
    if (keyval >= Clutter.KEY_A && keyval <= Clutter.KEY_Z)
        return keyval + (Clutter.KEY_a - Clutter.KEY_A);
    return keyval;
}

function parseAccel(accel) {
    // e.g. '<Super><Shift>b' / '<Super>Escape'
    let mods = 0;
    let rest = String(accel);

    const rules = [
        ['Super', Clutter.ModifierType.SUPER_MASK],
        ['Mod4', Clutter.ModifierType.SUPER_MASK],
        ['Control', Clutter.ModifierType.CONTROL_MASK],
        ['Primary', Clutter.ModifierType.CONTROL_MASK],
        ['Ctrl', Clutter.ModifierType.CONTROL_MASK],
        ['Alt', Clutter.ModifierType.MOD1_MASK],
        ['Mod1', Clutter.ModifierType.MOD1_MASK],
        ['Shift', Clutter.ModifierType.SHIFT_MASK],
    ];
    for (const [name, bit] of rules) {
        const token = `<${name}>`;
        if (rest.toLowerCase().includes(token.toLowerCase())) {
            mods |= bit;
            rest = rest.replace(new RegExp(token, 'ig'), '');
        }
    }
    rest = rest.replaceAll('<', '').replaceAll('>', '').trim();
    if (!rest)
        return null;

    const keyName = rest.length === 1 ? rest.toLowerCase() : rest;
    const keyval = Clutter[`KEY_${keyName}`] ??
        Clutter[`KEY_${keyName.toLowerCase()}`] ??
        Clutter[`KEY_${keyName[0].toUpperCase()}${keyName.slice(1)}`];
    if (!keyval)
        return null;
    return {keyval, mods: mods & MOD_MASK};
}

export default class Blackout extends Extension {
    enable() {
        this._overlay = null;
        this._grab = null;
        this._justHid = false;

        this._settings = this.getSettings();
        // Safe if a previous enable left the binding around.
        Main.wm.removeKeybinding('toggle-key');
        Main.wm.addKeybinding(
            'toggle-key',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.ALL,
            () => this.Toggle()
        );

        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, '/org/gnome/shell/extensions/blackout');
    }

    disable() {
        this._hide();
        Main.wm.removeKeybinding('toggle-key');
        this._settings = null;
        this._dbus.unexport();
        this._dbus = null;
    }

    Toggle() {
        // Ignore a second Toggle in the same key-press (wm binding + actor handler).
        if (this._justHid)
            return;

        if (this._overlay)
            this._hide();
        else
            this._show();
    }

    _show() {
        this._overlay = new St.Widget({
            style: 'background-color: #6667AB;',
            reactive: true,
            can_focus: true,
        });
        this._overlay.add_constraint(new Clutter.BindConstraint({
            source: global.stage,
            coordinate: Clutter.BindCoordinate.ALL,
        }));

        // Modal grabs can eat keys before the wm binding; handle dismiss here too.
        this._overlay.connect('key-press-event', (_actor, event) => {
            if (this._isDismissKey(event))
                this._hide();
            return Clutter.EVENT_STOP;
        });
        this._overlay.connect('key-release-event', () => Clutter.EVENT_STOP);
        this._overlay.connect('button-press-event', () => Clutter.EVENT_STOP);
        this._overlay.connect('scroll-event', () => Clutter.EVENT_STOP);

        Main.layoutManager.addTopChrome(this._overlay);

        this._grab = Main.pushModal(this._overlay, {
            actionMode: Shell.ActionMode.ALL,
        });
        if (!this._grab) {
            Main.layoutManager.removeChrome(this._overlay);
            this._overlay.destroy();
            this._overlay = null;
            return;
        }
        this._overlay.grab_key_focus();
    }

    _hide() {
        if (!this._overlay)
            return;

        const overlay = this._overlay;
        const grab = this._grab;
        this._overlay = null;
        this._grab = null;

        // Always tear down, even if something in here throws.
        try {
            if (grab)
                Main.popModal(grab);
        } catch (_e) {
            // ignore
        }

        try {
            Main.layoutManager.removeChrome(overlay);
        } catch (_e) {
            // ignore
        }

        try {
            overlay.destroy();
        } catch (_e) {
            // ignore
        }

        this._justHid = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._justHid = false;
            return GLib.SOURCE_REMOVE;
        });
    }

    _isDismissKey(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state() & MOD_MASK;

        // Bare Escape always dismisses (emergency exit).
        if (symbol === Clutter.KEY_Escape && state === 0)
            return true;

        const accel = this._settings?.get_strv('toggle-key')?.[0];
        if (!accel)
            return false;

        const parsed = parseAccel(accel);
        if (!parsed)
            return false;

        return lowerKey(symbol) === lowerKey(parsed.keyval) && state === parsed.mods;
    }
}

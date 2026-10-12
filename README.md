# Blackout

GNOME Shell extension that toggles a full-screen colored overlay (default shortcut: `Super+Shift+B`).

## Install

```bash
EXT="$HOME/.local/share/gnome-shell/extensions/blackout@local"
mkdir -p "$EXT"
cp -r extension.js metadata.json schemas "$EXT/"
glib-compile-schemas "$EXT/schemas"
gnome-extensions enable blackout@local
```

Then log out/in or restart GNOME Shell (`Alt+F2`, `r` on X11).

## Toggle via D-Bus

```bash
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/shell/extensions/blackout \
  --method org.gnome.shell.extensions.blackout.Toggle
```

UUID := copyninja@melissasoft
SRC := extension/$(UUID)
BUILD := build/$(UUID)
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all check stage install uninstall pack reload clean

all: check pack

check:
	gjs -m tests/run.js
	glib-compile-schemas --strict --dry-run $(SRC)/schemas

stage:
	rm -rf $(BUILD)
	mkdir -p $(BUILD)
	cp -a $(SRC)/. $(BUILD)/
	glib-compile-schemas $(BUILD)/schemas

install: stage
	-gnome-extensions disable $(UUID) 2>/dev/null
	mkdir -p $(HOME)/.local/share/gnome-shell/extensions
	rm -rf $(INSTALL_DIR)
	cp -a $(BUILD) $(INSTALL_DIR)
	-gnome-extensions enable $(UUID) 2>/dev/null
	@echo ""
	@echo "CopyNinja installed."
	@echo "  X11:     Alt+F2, type r, press Enter"
	@echo "  Wayland: log out and back in"
	@echo "  Shortcut: Super+Shift+V"

uninstall:
	-gnome-extensions disable $(UUID) 2>/dev/null
	rm -rf $(INSTALL_DIR)
	@echo "CopyNinja uninstalled. History was kept in ~/.local/share/copyninja."

pack: stage
	gnome-extensions pack --force --out-dir build $(BUILD)

reload:
	-gnome-extensions disable $(UUID) 2>/dev/null
	sleep 0.3
	-gnome-extensions enable $(UUID) 2>/dev/null

clean:
	rm -rf build

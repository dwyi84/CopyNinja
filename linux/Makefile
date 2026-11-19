UUID := copyninja@melissasoft
SRC := extension/$(UUID)
BUILD := build/$(UUID)

.PHONY: all check stage install uninstall pack reload clean

all: check pack

check:
	gjs -m tests/run.js
	glib-compile-schemas --strict --dry-run $(SRC)/schemas

stage:
	rm -rf $(BUILD)
	mkdir -p $(BUILD)
	cp -a $(SRC)/. $(BUILD)/
	install -m 0755 remote-install.sh $(BUILD)/remote-install.sh
	glib-compile-schemas $(BUILD)/schemas

install:
	./install.sh install

uninstall:
	./install.sh uninstall

pack: stage
	gnome-extensions pack --force --out-dir build \
		--schema=schemas/org.gnome.shell.extensions.copyninja.gschema.xml \
		--extra-source=capture.js \
		--extra-source=format.js \
		--extra-source=i18n.js \
		--extra-source=icons \
		--extra-source=image.js \
		--extra-source=indicator.js \
		--extra-source=model.js \
		--extra-source=remote-install.sh \
		--extra-source=storage.js \
		--extra-source=store.js \
		--extra-source=updater.js \
		--extra-source=version.js \
		$(BUILD)

reload:
	./install.sh reload

clean:
	rm -rf build

.DEFAULT_GOAL := all
.ONESHELL:
.SHELLFLAGS := -ec

ROOT := $(abspath $(CURDIR)/..)
CACHE := $(CURDIR)/.cache
SOURCES := $(CACHE)/sources
BUILDS := $(CACHE)/build
PREFIX := $(CACHE)/prefix
OUT := $(ROOT)/public/wasm

EMXX ?= em++
EMCONFIGURE ?= emconfigure
EMMAKE ?= emmake
CC_FOR_BUILD ?= cc
CXX_FOR_BUILD ?= c++
JOBS ?= 2

QALCULATE_VERSION ?= 5.12.0
GMP_VERSION ?= 6.3.0
MPFR_VERSION ?= 4.2.1
LIBXML_VERSION ?= 2.13.8

QALCULATE_URL := https://github.com/Qalculate/libqalculate/releases/download/v$(QALCULATE_VERSION)/libqalculate-$(QALCULATE_VERSION).tar.gz
GMP_URL := https://ftp.gnu.org/gnu/gmp/gmp-$(GMP_VERSION).tar.xz
MPFR_URL := https://ftp.gnu.org/gnu/mpfr/mpfr-$(MPFR_VERSION).tar.xz
LIBXML_URL := https://download.gnome.org/sources/libxml2/$(word 1,$(subst ., ,$(LIBXML_VERSION))).$(word 2,$(subst ., ,$(LIBXML_VERSION)))/libxml2-$(LIBXML_VERSION).tar.xz

QALCULATE_SOURCE := $(SOURCES)/libqalculate-$(QALCULATE_VERSION)
GMP_SOURCE := $(SOURCES)/gmp-$(GMP_VERSION)
MPFR_SOURCE := $(SOURCES)/mpfr-$(MPFR_VERSION)
LIBXML_SOURCE := $(SOURCES)/libxml2-$(LIBXML_VERSION)

EMFLAGS := -O2 --bind -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=QaltionModule \
	-s ENVIRONMENT=web,worker -s FILESYSTEM=1 -s ASSERTIONS=1 -s ALLOW_MEMORY_GROWTH=1

.PHONY: all check-toolchain fetch-source build-dependencies build-libqalculate clean

all: check-toolchain $(OUT)/qaltion.js $(OUT)/qaltion.wasm

check-toolchain:
	command -v curl >/dev/null || (echo "curl is required" >&2; exit 1)
	command -v "$(EMXX)" >/dev/null || (echo "Emscripten compiler not found: $(EMXX)" >&2; exit 1)
	command -v "$(EMCONFIGURE)" >/dev/null || (echo "Emscripten configure wrapper not found: $(EMCONFIGURE)" >&2; exit 1)
	command -v "$(EMMAKE)" >/dev/null || (echo "Emscripten make wrapper not found: $(EMMAKE)" >&2; exit 1)
	command -v "$(CC_FOR_BUILD)" >/dev/null || (echo "Build C compiler not found: $(CC_FOR_BUILD)" >&2; exit 1)
	command -v "$(CXX_FOR_BUILD)" >/dev/null || (echo "Build C++ compiler not found: $(CXX_FOR_BUILD)" >&2; exit 1)

$(SOURCES):
	mkdir -p "$@"

$(CACHE)/qalculate.tar.gz: | $(SOURCES)
	curl --fail --location "$(QALCULATE_URL)" -o "$@"
$(CACHE)/gmp.tar.xz: | $(SOURCES)
	curl --fail --location "$(GMP_URL)" -o "$@"
$(CACHE)/mpfr.tar.xz: | $(SOURCES)
	curl --fail --location "$(MPFR_URL)" -o "$@"
$(CACHE)/libxml2.tar.xz: | $(SOURCES)
	curl --fail --location "$(LIBXML_URL)" -o "$@"

$(QALCULATE_SOURCE): $(CACHE)/qalculate.tar.gz
	tar -xzf "$<" -C "$(SOURCES)"

$(GMP_SOURCE): $(CACHE)/gmp.tar.xz
	tar -xJf "$<" -C "$(SOURCES)"

$(MPFR_SOURCE): $(CACHE)/mpfr.tar.xz
	tar -xJf "$<" -C "$(SOURCES)"

$(LIBXML_SOURCE): $(CACHE)/libxml2.tar.xz
	tar -xJf "$<" -C "$(SOURCES)"

fetch-source: $(QALCULATE_SOURCE) $(GMP_SOURCE) $(MPFR_SOURCE) $(LIBXML_SOURCE)

$(PREFIX)/lib/libgmp.a: $(GMP_SOURCE)
	mkdir -p "$(BUILDS)/gmp"
	cd "$(BUILDS)/gmp"
	CC_FOR_BUILD="$(CC_FOR_BUILD)" CXX_FOR_BUILD="$(CXX_FOR_BUILD)" HOST_CC="$(CC_FOR_BUILD)" \
	"$(EMCONFIGURE)" "$(GMP_SOURCE)/configure" --host wasm32-unknown-emscripten --prefix="$(PREFIX)" \
	--disable-assembly --disable-cxx --disable-fft --enable-alloca=notreentrant
	"$(EMMAKE)" make -j$(JOBS)
	"$(EMMAKE)" make install

$(PREFIX)/lib/libmpfr.a: $(MPFR_SOURCE) $(PREFIX)/lib/libgmp.a
	mkdir -p "$(BUILDS)/mpfr"
	cd "$(BUILDS)/mpfr"
	"$(EMCONFIGURE)" "$(MPFR_SOURCE)/configure" --host wasm32-unknown-emscripten --prefix="$(PREFIX)" \
	--disable-thread-safe --enable-decimal-float=no --with-gmp="$(PREFIX)"
	"$(EMMAKE)" make -j$(JOBS)
	"$(EMMAKE)" make install

$(PREFIX)/lib/libxml2.a: $(LIBXML_SOURCE)
	mkdir -p "$(BUILDS)/libxml2"
	cd "$(BUILDS)/libxml2"
	"$(EMCONFIGURE)" "$(LIBXML_SOURCE)/configure" --host wasm32-unknown-emscripten --prefix="$(PREFIX)" \
	--with-minimum --with-sax1 --with-tree --with-output --without-python --without-lzma \
	--without-http --without-iconv --without-threads
	"$(EMMAKE)" make -j$(JOBS)
	"$(EMMAKE)" make install

$(PREFIX)/lib/libqalculate.a: $(QALCULATE_SOURCE) $(PREFIX)/lib/libgmp.a $(PREFIX)/lib/libmpfr.a $(PREFIX)/lib/libxml2.a
	mkdir -p "$(BUILDS)/libqalculate"
	cd "$(BUILDS)/libqalculate"
	# libqalculate 5.12.0 reuses this Autoconf cache value for the native build compiler.
	CPPFLAGS="-I$(PREFIX)/include -I$(PREFIX)/include/libxml2" \
	LDFLAGS="-L$(PREFIX)/lib" \
	LIBXML_CFLAGS="-I$(PREFIX)/include/libxml2" \
	LIBXML_LIBS="-L$(PREFIX)/lib -lxml2" \
	ac_cv_prog_cc_c23=-std=gnu2x \
	"$(EMCONFIGURE)" "$(QALCULATE_SOURCE)/configure" --host wasm32-unknown-emscripten --prefix="$(PREFIX)" \
	--without-libcurl --without-icu --disable-textport --disable-nls \
	--without-gnuplot-call --enable-compiled-definitions
	"$(EMMAKE)" make -j$(JOBS)
	"$(EMMAKE)" make install

build-dependencies: $(PREFIX)/lib/libgmp.a $(PREFIX)/lib/libmpfr.a $(PREFIX)/lib/libxml2.a
build-libqalculate: $(PREFIX)/lib/libqalculate.a

$(OUT)/qaltion.js $(OUT)/qaltion.wasm &: wrapper/qaltion.cpp $(PREFIX)/lib/libqalculate.a $(PREFIX)/lib/libmpfr.a $(PREFIX)/lib/libgmp.a $(PREFIX)/lib/libxml2.a
	mkdir -p "$(OUT)"
	"$(EMXX)" $(EMFLAGS) -I"$(PREFIX)/include" "$<" -L"$(PREFIX)/lib" \
	-lqalculate -lxml2 -lmpfr -lgmp -o "$(OUT)/qaltion.js"

clean:
	rm -rf "$(OUT)" "$(CACHE)"

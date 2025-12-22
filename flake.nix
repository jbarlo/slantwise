{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        buildTools = with pkgs; [
          # Build tools needed for native Node modules
          gcc
          gnumake
          # electron deps
          electron_37
        ];
        # Linux-specific Electron runtime dependencies
        # TODO confirm what is necessary
        linuxElectronLibs = with pkgs; [
          glib # libglib-2.0.so.0
          gtk3
          nss
          nspr
          xorg.libX11
          xorg.libXext
          xorg.libXrandr
          xorg.libXdamage
          xorg.libXfixes
          xorg.libXcomposite
          xorg.libXrender
          xorg.libXcursor
          xorg.libxkbfile
          xorg.libxcb
          libxkbcommon
          alsa-lib
          atk
          pango
          libdrm
          libgbm
          dbus
          cups
          cairo
          expat
          libGL
        ];
        # Linux-only packages
        linuxPackages = with pkgs;
          [
            wine # For cross-platform Windows builds
          ] ++ linuxElectronLibs;
        # macOS-specific packages
        darwinPackages = with pkgs; [ ];
        ciLintPackages = with pkgs; [ nodejs_24 pnpm just ];
        ciTestPackages = with pkgs;
          [
            gcc
            gnumake
            sqlite # For the `sqlite3` CLI tool
            # For electron-builder
            python311 # specifically 3.11 or node-gyp will fail on lack of distutils
          ] ++ ciLintPackages;
      in {
        # Development environment
        devShells.default = pkgs.mkShell {
          packages = with pkgs;
            [
              nodejs_24
              pnpm
              sqlite # For the `sqlite3` CLI tool
              # Add operation-specific tools here if they should be globally available
              dasel # For parsing XML/YAML/JSON etc.
              jq # For processing JSON
              gh
              just
              # python-with-deps
              pv
              # For electron-builder
              python311 # specifically 3.11 or node-gyp will fail on lack of distutils
            ] ++ buildTools
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux linuxPackages
            ++ pkgs.lib.optionals pkgs.stdenv.isDarwin darwinPackages;

          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
          '' + pkgs.lib.optionalString pkgs.stdenv.isLinux ''
            # Make Electron runtime libraries visible to the dynamic linker (Linux only)
            export LD_LIBRARY_PATH="${
              pkgs.lib.makeLibraryPath linuxElectronLibs
            }:$LD_LIBRARY_PATH"
          '';
          ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron_37}/bin/";
        };

        # Lightweight shell for CI linting/typechecking
        devShells.ci-lint = pkgs.mkShell {
          packages = ciLintPackages;
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };

        # Shell for CI tests
        devShells.ci-test = pkgs.mkShell {
          packages = ciTestPackages;
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };

        # --- Nix Apps for Operations (Optional) ---
        # Define apps if you want `nix run .#operation-name` syntax
        # apps.ingest-example = {
        #   type = "app";
        #   program = "${pkgs.writeScriptBin "ingest-example-runner" ''
        #     #!${pkgs.bash}/bin/bash
        #     set -euo pipefail
        #     # Example: Run a python script with its dependencies
        #     exec ${python-with-deps}/bin/python ${self}/operations/ingest_example/ingest.py "$@"
        #   ''}/bin/ingest-example-runner";
        # };

      });
}

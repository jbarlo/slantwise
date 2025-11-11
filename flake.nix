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
          # Build tools needed for native Node modules like better-sqlite3
          gcc
          gnumake
          # electron deps
          electron_37
        ];
      in {
        # Development environment
        devShells.default = pkgs.mkShell {
          packages = with pkgs;
            [
              nodejs_22
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

              # Electron runtime deps
              # TODO confirm what is necessary
              glib # libglib-2.0.so.0
              gtk3
              nss
              pkgs.nspr
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
              pkgs.cups
              pkgs.cairo
              pkgs.expat
              pkgs.libGL
            ] ++ buildTools; # Add build tools to the shell environment

          # Optional: Set environment variables or run commands on shell entry
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            # Make Electron runtime libraries visible to the dynamic linker
            export LD_LIBRARY_PATH="${
              pkgs.lib.makeLibraryPath [
                # Electron runtime deps
                # TODO confirm what is necessary
                pkgs.glib
                pkgs.gtk3
                pkgs.nss
                pkgs.libxkbcommon
                pkgs.alsa-lib
                pkgs.atk
                pkgs.pango
                pkgs.libdrm
                pkgs.libgbm
                pkgs.xorg.libX11
                pkgs.xorg.libXext
                pkgs.xorg.libXrandr
                pkgs.xorg.libXdamage
                pkgs.xorg.libXfixes
                pkgs.xorg.libXcomposite
                pkgs.xorg.libXrender
                pkgs.xorg.libXcursor
                pkgs.xorg.libxkbfile
                pkgs.xorg.libxcb
                pkgs.nspr
                pkgs.dbus
                pkgs.cups
                pkgs.cairo
                pkgs.expat
                pkgs.libGL
              ]
            }:$LD_LIBRARY_PATH"
          '';
          ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron_37}/bin/";
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

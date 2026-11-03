# Canary on Nix

Canary is a fork of [Muriel](https://github.com/cloverscripts/riff-muriel), which is based on
[Riff](https://github.com/rootscripts/riff) by rootscripts (MIT).

The `flake.nix` exposes three things:

- `packages.canary` (also `packages.default`) — the installable app
- `overlays.default` — an overlay for nixpkgs
- `devShells.default` — a shell for hacking on Canary

## Install into your system config (Flakes)

Add the input:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    canary.url = "github:takt1232/riff-muriel";
  };

  outputs = { self, nixpkgs, canary, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ({ pkgs, ... }: {
          environment.systemPackages = [ canary.packages.x86_64-linux.default ];
        })
      ];
    };
  };
}
```

For home-manager, inside your home config:

```nix
{
  inputs.canary.url = "github:takt1232/riff-muriel";

  outputs = { nixpkgs, home-manager, canary, ... }: {
    homeConfigurations.you = home-manager.lib.homeManagerConfiguration {
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      modules = [
        ({ pkgs, ... }: {
          home.packages = [ canary.packages.x86_64-linux.default ];
        })
      ];
    };
  };
}
```

## Install via an overlay

Useful when you want `pkgs.canary` available everywhere rather than referencing `canary.packages...` directly:

```nix
{
  inputs.canary.url = "github:takt1232/riff-muriel";

  outputs = { nixpkgs, canary, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        overlays = [ canary.overlays.default ];
      };
    in {
      nixosConfigurations.myhost = pkgs.lib.nixosSystem {
        inherit system;
        modules = [{ environment.systemPackages = [ pkgs.canary ]; }];
      };
    };
}
```

## One-off / user installs (no config change)

```bash
# install into your profile
nix profile install github:takt1232/riff-muriel

# or just run it once
nix run github:takt1232/riff-muriel

# from a local checkout
nix profile install .
nix run .
```

After installing, `canary` is on your `PATH` and a `Canary` desktop entry + icon are registered.

## Development shell

```bash
git clone https://github.com/takt1232/riff-muriel
cd riff-muriel
nix develop          # nodejs, python3, yt-dlp, ffmpeg
npm install
npm start
```

## Notes

- The package wraps the nixpkgs `electron` with the app directory and puts `yt-dlp` and `ffmpeg` on `PATH`, so Canary finds them instead of self-downloading.
- `npmDepsHash` in `flake.nix` must be updated whenever `package.json`/`package-lock.json` change. Rebuild with a wrong/placeholder hash and copy the reported `got:` value, or regenerate it with `nix-prefetch-npm-deps` / `prefetch-npm-deps`.

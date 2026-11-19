# O2 BOM desktop

Source and installers for the O2 BOM desktop app.

- `app/` is the app's source (Electron + the supplier automation and Buy lab).
- Every release in this repository carries the installers and is the update
  feed the installed app checks.

Download the newest version from [Releases](../../releases/latest):

| File | For |
|---|---|
| `O2-BOM-<version>-arm64.dmg` | Mac with Apple silicon (M1 or later) |
| `O2-BOM-<version>-x64.dmg` | Mac with an Intel processor |
| `O2-BOM-Setup-<version>.exe` | Windows 10/11, 64-bit |

Once installed (0.0.2 or later), the app looks here for new versions. Windows
updates itself and installs on the next restart; on a Mac the app offers the new
installer to download.

## Working on the app

```bash
cd app
npm ci
npm test        # unit tests
npm start       # run the app (electron .)
npm run dist    # build installers into app/release (unsigned without signing secrets)
```

The app's own pages share the BOM tokens, the O2 mark and the Geist font;
`app/shared/` holds the first two and `npm run assets` (part of `npm start` and
`npm run dist`) copies them into `app/static/vendor/`.

## Releasing

1. Bump `version` in `app/package.json` (npm version <x.y.z> --no-git-tag-version).
2. Commit and push to `main`.
3. Run the **Desktop** workflow on `main` with `publish: true`.
   It builds macOS and Windows installers and creates the `v<version>` release
   here; installed apps pick it up from that release.

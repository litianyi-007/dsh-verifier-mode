# dsh-verifier-mode

P1 verifier-mode plugin for DeepSeek Harness, plus the P0 spikes that proved the extension points. The plugin switches per session, picks one of three read-only strategies, audits the turn once, yields to plan mode, and pauses at a per-model CNY cap.

Tests run against a local checkout of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). They use DSH's mock model adapter and a local HTTP mock. They do not call DeepSeek, TypeSafe, Jev, or any other hosted model, and they do not need an API key.

## Run the tests

Node must satisfy DSH's engines field (`^22.19` or `>=24`). On a machine whose default Node is older, put a matching Node on `PATH` first.

```bash
# one-time: clone DSH next to this repo, or anywhere, and install it
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout 5badb15009ae1756c3afe0ae0cef1faafc290ccc
pnpm install

cd /path/to/dsh-verifier-mode
npm install
DSH_ROOT=/absolute/path/to/deepseek-harness npm test
```

`DSH_ROOT` defaults to `/home/ubuntu/deepseek-harness` in this environment. Files under `spikes/` are the P0 items. Files under `tests/` are the P1 MVP. P0 verdicts are in [docs/P0-REPORT.md](docs/P0-REPORT.md). CLI and SDK turn the mode on by patching `enabledByDefault` through `cordis.patch.yml`; there is no Verifier preset.

## Install

This section is separate from the offline mock suite above. The suite does not install the plugin into a DeepSeek Harness profile and does not call TypeSafe.

Peer ranges target DeepSeek Harness Desktop `0.2.0-rc.2` and later `0.2.x` hosts, including `0.2.1-alpha.1`. Every `@deepseek-ai/dsh-*` peer is `^0.2.0-rc.2 || ^0.2.1-alpha.1`. `@deepseek-ai/schemastery` is `3.18.4 || >=3.18.5-alpha.1 <4` and `@deepseek-ai/cordis` is `4.0.4 || >=4.0.5-alpha.1 <5`, so the copies Desktop `0.2.0-rc.2` ships (`schemastery@3.18.4`, `cordis@4.0.4`) satisfy the declaration along with the `0.2.1-alpha.1` line.

Desktop's packaged host runs compiled JavaScript. It does not compile a TypeScript plugin. `main` and `exports` point at `lib/index.js` (host) and `lib/client.js` (the browser factory `window.__ModuleLoader__.load` expects). Those files are committed, so `dsh plugin add` of a local path or a `github:` URL can load them without pnpm's `allowBuilds` permission. `prepare` runs `node build.mjs` when a local install is allowed to build. The build does not need a deepseek-harness checkout.

After you pull source changes, rebuild before installing again. `npm install` runs `prepare`. If dependencies are already installed:

```bash
npm run build
```

Prefer a local directory over a `github:` URL. This repository is private.

### Desktop

Use the `dsh` that ships with Desktop. That binary is `resources/runtime/cli/bin/dsh` (`dsh.cmd` on Windows); Desktop can also register it with **Manage dsh Command…**. Quit Desktop first. An npm-installed `dsh` cannot change this profile. It exits with `profile "desktop" is managed exclusively by the Electron application`.

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-verifier-mode
```

From inside the checkout, the same command is `dsh plugin --profile desktop add .` Then reopen Desktop.

### If startup still says failed to import

`1 entry did not activate` / `dsh-verifier-mode failed to import` means the host import threw before a plugin fiber existed. With `lib/index.js` in place, the remaining Desktop `0.2.0-rc.2` case is a `link:` install ([deepseek-ai/deepseek-harness#9494](https://github.com/deepseek-ai/deepseek-harness/discussions/9494)). The Plugins page and `dsh plugin add <path>` record a `link:` dependency and a symlink at `~/.dsh/profiles/desktop/node_modules/dsh-verifier-mode`. Node realpaths that symlink out of the profile, so the plugin's host peer imports are not routed to the copies inside the Desktop app. The same files load when the directory is real.

Quit Desktop, then:

1. Copy this checkout — the directory that contains `package.json` and `lib/` — onto `~/.dsh/profiles/desktop/node_modules/dsh-verifier-mode`. Copy the files. Do not use `ln`, `mklink`, or a `link:` dependency. If `DSH_HOME` is set, replace `~/.dsh` with that directory.
2. In `~/.dsh/profiles/desktop/package.json`, make sure `dsh.profile.bundles` includes `dsh-verifier-mode`. Remove this package's `link:` entry from `dependencies`. Leave every other dependency as it is.
3. Remove the link leftovers for this package if they are present: `node_modules/dsh-verifier-mode` when it is still a symlink, and `node_modules/.ignored_dsh-verifier-mode`. Discussion #9494 also removes the profile's `pnpm-lock.yaml`, `node_modules/.pnpm`, `node_modules/.modules.yaml`, and `.pnpm-workspace-state-v1.json` when the profile was assembled only for this plugin. If other out-of-tree plugins are installed, leave those shared pnpm files in place.
4. Reopen Desktop.

### Web UI

For the Web UI, from any directory:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-verifier-mode
```

From inside the checkout, that is `dsh plugin --profile web add .`

That command is the profile install in the DeepSeek Harness guide, [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/develop/basic/publish.md#install-into-a-profile). The guide's example is `dsh plugin --profile demo add ./hello-plugin`. Then start the Web UI with `dsh web`.

The DeepSeek key is set on Settings → Models. The TypeSafe key is set on Plugins → dsh-verifier-mode → Configure. That Configure control is there only after this plugin is installed.

This document does not claim that a live TypeSafe call has been verified against a real account.

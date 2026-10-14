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

Prefer an install that materializes a real directory in the profile and does not nest host packages under this plugin. This repository is private, so a `github:` URL needs access to the repository. `lib/` is already committed, so that install does not need `allowBuilds`.

### Desktop

Use the `dsh` that ships with Desktop. That binary is `resources/runtime/cli/bin/dsh` (`dsh.cmd` on Windows); Desktop can also register it with **Manage dsh Command…**. Quit Desktop first. An npm-installed `dsh` cannot change this profile. It exits with `profile "desktop" is managed exclusively by the Electron application`.

```bash
dsh plugin --profile desktop add github:litianyi-007/dsh-verifier-mode
```

A packed tarball is the same kind of install. `npm pack` follows the `files` list and leaves out `node_modules`:

```bash
npm pack
dsh plugin --profile desktop add ./dsh-verifier-mode-0.0.0.tgz
```

Reopen Desktop after either command.

A directory path (`dsh plugin --profile desktop add .`, or the Plugins page given a local path) records a `link:` dependency. Desktop already routes that linked package's `peerDependencies` to the host copies in the app. That is `routeLinked` in [deepseek-ai/deepseek-harness#9494](https://github.com/deepseek-ai/deepseek-harness/discussions/9494): it reads the peer declarations on this package. Keep `@deepseek-ai/*` and `zod` as peers. `npm install` in this checkout is for tests and `npm run build`; it can place those peers in the checkout's `node_modules`, and a nearer copy then loads instead of the host.

### Real directory

Assemble a real directory only from package sources. Copy `package.json`, `lib/`, `cordis.patch.yml`, and `README.md` to `~/.dsh/profiles/desktop/node_modules/dsh-verifier-mode` (use `$DSH_HOME` when that variable is set). Leave `node_modules` out of the copy. Do not install this plugin's `peerDependencies` into that directory, and do not move them from `peerDependencies` into `dependencies`. Add `dsh-verifier-mode` to `dsh.profile.bundles` in the profile `package.json`. Reopen Desktop.

Leave the profile's pnpm files in place. `routeLinked` is the linked-package path, and the `routeLocalPackage` guard stays limited to profile layers. [#9494](https://github.com/deepseek-ai/deepseek-harness/discussions/9494) asks maintainers to keep that guard.

### Web UI

For the Web UI, from any directory:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-verifier-mode
```

From inside the checkout, that is `dsh plugin --profile web add .`

That command is the profile install in the DeepSeek Harness guide, [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/develop/basic/publish.md#install-into-a-profile). The guide's example is `dsh plugin --profile demo add ./hello-plugin`. Then start the Web UI with `dsh web`.

The DeepSeek key is set on Settings → Models. The TypeSafe key is set on Plugins → dsh-verifier-mode → Configure. That Configure control is there only after this plugin is installed.

This document does not claim that a live TypeSafe call has been verified against a real account.

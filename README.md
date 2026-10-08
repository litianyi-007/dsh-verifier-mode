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

## Web trial

This section is separate from the offline mock suite above. The suite does not install the plugin into a DeepSeek Harness profile and does not call TypeSafe.

Install from a local checkout. Do not use a `github:` URL. This repository is private, its `package.json` exports point at `src/*.ts`, it has no `prepare` or `build` script, and a DeepSeek Harness git install does not run a build.

From any directory, pass the checkout path:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-verifier-mode
```

From inside the checkout, the same command is `dsh plugin --profile web add .`

That command is the profile install in the DeepSeek Harness guide, [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/develop/basic/publish.md#install-into-a-profile). The guide's example is `dsh plugin --profile demo add ./hello-plugin`. Here the profile is `web` and the package is this checkout. Then start the Web UI with `dsh web`.

The DeepSeek key is set on Settings → Models. The TypeSafe key is set on Plugins → dsh-verifier-mode → Configure. That Configure control is there only after this plugin is installed.

This document does not claim that a live TypeSafe call has been verified against a real account.

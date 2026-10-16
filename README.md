# dsh-verifier-mode

P1 verifier-mode plugin for DeepSeek Harness, plus the P0 spikes that proved the extension points. The plugin switches per session. When the mode is on, a non-trivial multi-step request gets several read-only plans from the current model, and the highest-scoring plan becomes the next execution strategy. It audits the turn once, yields to plan mode, and pauses at a per-model CNY cap.

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

A stable local directory is the other install that Desktop can reload from. Quit Desktop first, then:

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-verifier-mode
```

Do not pin the profile to a tarball under `/tmp` (for example `file:/tmp/dsh-verifier-mode-pack.tgz`). That path disappears when `/tmp` is cleaned, and the profile can no longer reinstall. If `dependencies["dsh-verifier-mode"]` already points at a missing `/tmp` file, quit Desktop, delete that dependency and the matching `pnpm-lock.yaml` importer entry, then run the `github:` command or the local-directory command above.

A packed tarball is the same kind of install when the file lives in a stable directory. `npm pack` follows the `files` list and leaves out `node_modules`:

```bash
npm pack
dsh plugin --profile desktop add ./dsh-verifier-mode-0.0.0.tgz
```

Reopen Desktop after either command.

A directory path (`dsh plugin --profile desktop add .`, or the Plugins page given a local path) records a `link:` dependency. For that external link, `routeLinked` occupies each declared peer with Desktop's host copy ([deepseek-ai/deepseek-harness#9494](https://github.com/deepseek-ai/deepseek-harness/discussions/9494)). A `node_modules` inside the checkout does not take those peers. Keep `@deepseek-ai/*` and `zod` declared as `peerDependencies`.

### Real directory

Quit Desktop. Remove `~/.dsh/profiles/desktop/node_modules/dsh-verifier-mode` first when that path is a symlink or an older copy (use `$DSH_HOME` when that variable is set). Copying onto a symlink writes through to the checkout. In the profile `package.json`, clear `dependencies["dsh-verifier-mode"]` when the specifier is `link:`, or rewrite that specifier so it is not `link:`. Remove the same `link:` importer entry from the profile `pnpm-lock.yaml`. The next install recreates the symlink while that record remains.

Then copy package sources only — `package.json`, `lib/`, `cordis.patch.yml`, and `README.md` — to `~/.dsh/profiles/desktop/node_modules/dsh-verifier-mode`. Leave the checkout's `node_modules` out of the copy. Do not install this plugin's `peerDependencies` into that directory, and leave them as `peerDependencies`. Add `dsh-verifier-mode` to `dsh.profile.bundles` in the profile `package.json`. Reopen Desktop.

`routeLinked` is the linked-package path, and the `routeLocalPackage` guard stays limited to profile layers. [#9494](https://github.com/deepseek-ai/deepseek-harness/discussions/9494) asks maintainers to keep that guard.

### Web UI

For the Web UI, from any directory:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-verifier-mode
```

From inside the checkout, that is `dsh plugin --profile web add .`

That command is the profile install in the DeepSeek Harness guide, [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/develop/basic/publish.md#install-into-a-profile). The guide's example is `dsh plugin --profile demo add ./hello-plugin`. Then start the Web UI with `dsh web`.

The DeepSeek key is set on Settings → Models. Plugins → dsh-verifier-mode → Configure sets the TypeSafe key and the live knobs: candidate count K (2–5, default 3), the CNY per-session caps (flash default ¥1, pro default ¥4; `tokenbox/deepseek-flash` and the old `deepseek-v4-flash` name use the flash tier), which sources count toward that cap (design A by default: candidates, every Jev call, and main steps after a D4 steer; ordinary main-loop usage does not), the intake gate (automatic by default, or always-on for debugging), the D4 audit switch, and the early-release feedback switches. That page is there only after this plugin is installed.

Decision traces and the cost ledger share the `verifier_trace` storage-domain sidecar (`usage` and `traces` tables). The process Map is a cache of that sidecar. With the JSON backend the file is the unit document, typically `verifier_trace.json` under the profile storage root.

## 发布初期反馈

回合里的问题写进会话通知，正文可以复制：有影响的入口判断失败、Jev 报错、费用暂停、没有合格候选，以及运行中抛出的错误。安装失败和能识别的 Desktop 导入问题发生在 `apply()` 里，这时还没有会话。那份草稿写到 stderr，前缀是 `dsh: verifier feedback`，然后原来的错误继续抛出。

草稿包含插件版本、平台、决策点、结果、原因代码、丢弃原因代码、分数摘要、费用范围、计入来源，以及人民币已用和上限。原因和丢弃原因只保留已知代码，不保留模型或提供者返回的自由文本。它不包含 API key、用户原文、候选标题和完整会话记录。同一会话里相同指纹在成功写出之后只保留一次。指纹在进程内存里：追加或返回通知成功后才记下，失败可以再试。同一进程里两起失败如果重叠，可能各写一次。

`feedback.enabled` 默认开启。通知里是可复制的正文。`feedback.autoOpenGithub` 默认关闭。打开后，通知里多一条预填链接（`litianyi-007/dsh-verifier-mode` 的新建页面，带标题和正文）。请复制正文，或只打开这条链接。默认路径不需要 GitHub token。

这个功能的 MVP 不包含静默执行 `gh issue create`，也不包含用 token 调用 GitHub API 自动建 issue。

This document does not claim that a live TypeSafe call has been verified against a real account.

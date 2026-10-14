window.__ModuleLoader__.load({ id: "dsh-verifier-mode", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  VERIFIER_CHIP_ID: () => VERIFIER_CHIP_ID,
  VERIFIER_LOCALE_NS: () => VERIFIER_LOCALE_NS,
  VerifierChip: () => VerifierChip,
  apply: () => apply,
  executeVerifierMode: () => executeVerifierMode,
  inject: () => inject,
  registerTypeSafeKey: () => registerTypeSafeKey,
  registerVerifierChip: () => registerVerifierChip
});
module.exports = __toCommonJS(index_exports);
var import_react2 = require("react");

// src/credential-ref.ts
var TYPESAFE_API_KEY_REF = "TYPESAFE_API_KEY";
var TYPESAFE_ROW_CONFIG_KEY = "dsh-verifier-mode#dsh-verifier-mode";

// src/client/key-form.ts
var import_react = require("react");
var EMPTY_STATE = {
  text: "",
  configured: false,
  writable: true,
  saving: false,
  error: null
};
function projectCredentialView(raw) {
  const record = raw !== null && typeof raw === "object" ? raw : {};
  const view = {
    configured: record.configured === true,
    writable: record.writable !== false
  };
  if (typeof record.source === "string") view.source = record.source;
  return view;
}
var TypeSafeKeyController = class {
  /**
   * @param credentials - `remote.credentials`.
   * @param ref - credential reference. Defaults to `TYPESAFE_API_KEY`.
   */
  constructor(credentials, ref = TYPESAFE_API_KEY_REF) {
    this.credentials = credentials;
    this.ref = ref;
  }
  text = "";
  configured = false;
  writable = true;
  saving = false;
  error = null;
  source;
  snapshot = EMPTY_STATE;
  listeners = /* @__PURE__ */ new Set();
  /** Current page state. The snapshot object is stable until the next edit. */
  getSnapshot = () => this.snapshot;
  /** @param listener - called after each state change. */
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** @param text - the password draft. It is not a stored credential. */
  edit = (text) => {
    this.text = text;
    this.error = null;
    this.publish();
  };
  /**
   * Re-read after the host reports a change to this reference.
   * @param ref - the reference the host names.
   */
  refreshReference(ref) {
    if (ref !== this.ref) return;
    void this.refresh();
  }
  /** Ask the credentials domain whether the reference is configured. */
  refresh = async () => {
    const response = await this.credentials.describe([this.ref]);
    if (!response.ok) {
      this.error = response.error?.message ?? "describe failed";
      this.publish();
      return;
    }
    const view = projectCredentialView(response.value[this.ref]);
    this.configured = view.configured;
    this.writable = view.writable;
    this.source = view.source;
    this.publish();
  };
  /**
   * Store a non-empty draft. A blank draft keeps the saved key.
   * The draft is cleared after a successful write so the page cannot echo it.
   */
  save = async () => {
    const draft = this.text;
    if (draft.length === 0) return;
    const value = draft.trim();
    if (value.length === 0) {
      this.error = "blank";
      this.publish();
      return;
    }
    this.saving = true;
    this.error = null;
    this.publish();
    const response = await this.credentials.set(this.ref, value);
    this.saving = false;
    if (!response.ok) {
      this.error = response.error?.message ?? "save failed";
      this.publish();
      return;
    }
    this.text = "";
    await this.refresh();
  };
  /** Remove the stored key. The next Jev decision fail-opens when nothing else supplies one. */
  clear = async () => {
    this.saving = true;
    this.error = null;
    this.publish();
    const response = await this.credentials.unset(this.ref);
    this.saving = false;
    this.text = "";
    if (!response.ok) {
      this.error = response.error?.message ?? "clear failed";
      this.publish();
      return;
    }
    await this.refresh();
  };
  /** Face registered on `plugins.row.config`. */
  face() {
    return {
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
      edit: this.edit,
      save: this.save,
      clear: this.clear,
      refresh: this.refresh
    };
  }
  publish() {
    this.snapshot = {
      text: this.text,
      configured: this.configured,
      writable: this.writable,
      saving: this.saving,
      error: this.error,
      ...this.source === void 0 ? {} : { source: this.source }
    };
    for (const listener of this.listeners) listener();
  }
};
function renderKeyForm(props) {
  const disabled = !props.state.writable || props.state.saving;
  return (0, import_react.createElement)(
    "form",
    {
      "aria-label": props.t("key.label"),
      onSubmit: (event) => {
        event.preventDefault();
        props.onSave();
      }
    },
    (0, import_react.createElement)("label", { htmlFor: "dsh-verifier-typesafe-key" }, props.t("key.label")),
    (0, import_react.createElement)("p", null, props.state.configured ? props.t("key.set") : props.t("key.unset")),
    (0, import_react.createElement)("input", {
      id: "dsh-verifier-typesafe-key",
      type: "password",
      autoComplete: "new-password",
      value: props.state.text,
      disabled,
      onChange: (event) => {
        props.onEdit(event.target.value);
      }
    }),
    (0, import_react.createElement)("p", null, props.t("key.hint")),
    (0, import_react.createElement)("button", { type: "submit", disabled }, props.t("key.save")),
    (0, import_react.createElement)("button", {
      type: "button",
      disabled: disabled || !props.state.configured,
      onClick: () => {
        props.onClear();
      }
    }, props.t("key.clear")),
    props.state.error === null ? null : (0, import_react.createElement)("p", { role: "alert" }, props.state.error === "blank" ? props.t("key.blank") : props.state.error)
  );
}
function VerifierKeyPage(props) {
  const state = (0, import_react.useSyncExternalStore)(props.subscribe, props.getSnapshot, props.getSnapshot);
  (0, import_react.useEffect)(() => {
    void props.refresh();
  }, [props.refresh]);
  if (props.view === "summary") return props.t("key.summary");
  return renderKeyForm({
    t: props.t,
    state,
    onEdit: props.edit,
    onSave: () => {
      void props.save();
    },
    onClear: () => {
      void props.clear();
    }
  });
}

// src/client/locales.ts
var en = {
  "chip.label": "Verifier",
  "chip.on.aria": "Turn verifier mode off",
  "chip.off.aria": "Turn verifier mode on",
  "chip.title": "Verifier mode",
  "chip.paused": "Paused",
  "key.summary": "TypeSafe API key",
  "key.label": "TypeSafe API key",
  "key.hint": "Saved in the credentials file. Leave this blank to keep the saved key.",
  "key.set": "Key saved",
  "key.unset": "No key saved",
  "key.save": "Save",
  "key.clear": "Clear key",
  "key.blank": "Enter a key, or clear the saved one."
};
var zh = {
  "chip.label": "\u6821\u9A8C",
  "chip.on.aria": "\u5173\u95ED\u6821\u9A8C\u6A21\u5F0F",
  "chip.off.aria": "\u5F00\u542F\u6821\u9A8C\u6A21\u5F0F",
  "chip.title": "\u6821\u9A8C\u6A21\u5F0F",
  "chip.paused": "\u5DF2\u6682\u505C",
  "key.summary": "TypeSafe API \u5BC6\u94A5",
  "key.label": "TypeSafe API \u5BC6\u94A5",
  "key.hint": "\u4FDD\u5B58\u5728\u51ED\u8BC1\u6587\u4EF6\u4E2D\u3002\u7559\u7A7A\u5219\u4FDD\u7559\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5\u3002",
  "key.set": "\u5DF2\u4FDD\u5B58\u5BC6\u94A5",
  "key.unset": "\u672A\u4FDD\u5B58\u5BC6\u94A5",
  "key.save": "\u4FDD\u5B58",
  "key.clear": "\u6E05\u9664\u5BC6\u94A5",
  "key.blank": "\u8BF7\u8F93\u5165\u5BC6\u94A5\uFF0C\u6216\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5\u3002"
};

// src/client/index.ts
var inject = ["slots", "locale", "remote", "remote.commands", "remote.credentials"];
var VERIFIER_LOCALE_NS = "verifier";
var VERIFIER_CHIP_ID = "dsh-verifier-mode";
async function executeVerifierMode(execute, sessionId, active) {
  const line = active ? "/verifier on" : "/verifier off";
  const result = await execute(sessionId, line, []);
  if (!result.ok) {
    const code = result.error?.code === void 0 ? "" : ` (${result.error.code})`;
    return `${result.error?.message ?? "command failed"}${code}`;
  }
  if (result.value === void 0) return `unknown command: ${line}`;
  return null;
}
function VerifierChip(props) {
  const projected = props.useProjection?.("verifier");
  const active = projected?.active ?? props.active ?? false;
  const paused = projected?.paused ?? props.paused ?? false;
  const label = paused ? `${props.t("chip.label")} \xB7 ${props.t("chip.paused")}` : props.t("chip.label");
  return (0, import_react2.createElement)(
    "button",
    {
      type: "button",
      "aria-label": props.t(active ? "chip.on.aria" : "chip.off.aria"),
      title: props.t(paused ? "chip.paused" : "chip.title"),
      onClick: () => {
        void props.toggle(!active);
      }
    },
    label
  );
}
function registerVerifierChip(slots, locale, execute) {
  const t = locale.bind(VERIFIER_LOCALE_NS);
  return slots.register({
    name: "conversation.input.left",
    id: VERIFIER_CHIP_ID,
    locale: VERIFIER_LOCALE_NS,
    label: () => t("chip.label"),
    inject: (sessionId) => ({
      toggle: (active) => executeVerifierMode(execute, sessionId, active)
    })
  }, VerifierChip);
}
function registerTypeSafeKey(ctx) {
  const controller = new TypeSafeKeyController(ctx.remote.credentials);
  const disposeWatch = ctx.remote.$on?.("credentials/reference-updated", (ref) => {
    controller.refreshReference(ref);
  });
  const disposeSlot = ctx.slots.register({
    name: "plugins.row.config",
    key: TYPESAFE_ROW_CONFIG_KEY,
    locale: VERIFIER_LOCALE_NS,
    inject: () => controller.face()
  }, VerifierKeyPage);
  return () => {
    disposeWatch?.();
    disposeSlot();
  };
}
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(VERIFIER_LOCALE_NS, { zh, en }), "dsh-verifier-mode: dictionaries");
  ctx.slots.inject("conversation.input.left", () => registerVerifierChip(
    ctx.slots,
    ctx.locale,
    (sessionId, line, attachments) => ctx.remote.commands.execute(sessionId, line, attachments)
  ));
  ctx.slots.inject("plugins.row.config", () => registerTypeSafeKey(ctx));
}
return module.exports;
} });

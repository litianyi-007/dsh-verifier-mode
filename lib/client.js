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
var import_react3 = require("react");

// src/credential-ref.ts
var TYPESAFE_API_KEY_REF = "TYPESAFE_API_KEY";
var TYPESAFE_ROW_CONFIG_KEY = "dsh-verifier-mode#dsh-verifier-mode";

// src/client/key-form.ts
var import_react2 = require("react");

// src/client/settings-form.ts
var import_react = require("react");

// src/configure-help.ts
var CANDIDATE_PRESETS = [2, 3, 4, 5];
var FLASH_CAP_PRESETS = [0.5, 1, 2, 4];
var PRO_CAP_PRESETS = [1, 2, 4, 8];

// src/pricing.ts
var FLASH_ROUTE = "deepseek/deepseek-flash";
var PRO_ROUTE = "deepseek/deepseek-v4-pro";
var DEFAULT_PRICING = {
  aliases: {
    "deepseek/deepseek-v4-flash": FLASH_ROUTE,
    "deepseek/deepseek-v4-flash-vision-exp": FLASH_ROUTE,
    // Model-id keys apply to any provider. Desktop's tokenbox gateway
    // reports `tokenbox/deepseek-flash`, which otherwise misses the flash cap.
    "deepseek-flash": FLASH_ROUTE,
    "deepseek-v4-flash": FLASH_ROUTE,
    "deepseek-v4-flash-vision-exp": FLASH_ROUTE,
    "deepseek-v4-pro": PRO_ROUTE,
    "tokenbox/deepseek-flash": FLASH_ROUTE,
    "tokenbox/deepseek-v4-flash": FLASH_ROUTE,
    "tokenbox/deepseek-v4-flash-vision-exp": FLASH_ROUTE,
    "tokenbox/deepseek-v4-pro": PRO_ROUTE
  },
  models: {
    [FLASH_ROUTE]: {
      currency: "CNY",
      inputHitPerM: 0.04,
      inputMissPerM: 2,
      outputPerM: 8,
      peakSchedule: true
    },
    [PRO_ROUTE]: {
      currency: "CNY",
      inputHitPerM: 0.3,
      inputMissPerM: 9,
      outputPerM: 27,
      peakSchedule: true
    }
  },
  offPeakFactor: 0.5,
  peakWindows: {
    timeZone: "Asia/Shanghai",
    weekdays: [1, 2, 3, 4, 5],
    windows: ["09:00-12:00", "14:00-18:00"],
    holidays: []
  },
  jev: { currency: "USD", inputPerM: 0.042, outputPerM: 0 },
  fx: { usdToCny: 6.7367, margin: 0.02 },
  ledgerCurrency: "CNY"
};

// src/client/settings-form.ts
function asRecord(value) {
  return value !== null && typeof value === "object" ? value : {};
}
function readBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function readNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function withCurrent(presets, current) {
  const values = [...presets];
  if (!values.some((item) => item === current)) values.push(current);
  return values;
}
function field(label, help, control) {
  return (0, import_react.createElement)(
    "div",
    null,
    (0, import_react.createElement)("label", null, label),
    (0, import_react.createElement)("p", null, help),
    control
  );
}
function presetSelect(label, value, disabled, options, onChange) {
  return (0, import_react.createElement)(
    "select",
    {
      "aria-label": label,
      value,
      disabled,
      onChange: (event) => {
        onChange(event.target.value);
      }
    },
    options.map((option) => (0, import_react.createElement)("option", { key: option.value, value: option.value }, option.label))
  );
}
function renderSettingsForm(props) {
  const value = asRecord(props.form?.state.value);
  const cost = asRecord(value.cost);
  const byModel = asRecord(cost.maxPerSessionByModel);
  const candidates = readNumber(value.candidates, 3);
  const intake = readBoolean(value.intake, true);
  const gate = value.intakeGate === "always" ? "always" : "gated";
  const audit = readBoolean(value.audit, true);
  const scope = cost.scope === "generator_jev_only" ? "generator_jev_only" : "design";
  const flash = readNumber(byModel[FLASH_ROUTE], 1);
  const pro = readNumber(byModel[PRO_ROUTE], 4);
  const unknown = readNumber(cost.maxPerSession, 1);
  const writable = props.form?.state.writable === true && props.form.state.revision !== void 0;
  const write = (path, next) => {
    const form = props.form;
    if (form === void 0 || form.state.revision === void 0 || !form.state.writable) return;
    void form.mutate([{ op: "set", path, value: next }], form.state.revision);
  };
  return (0, import_react.createElement)(
    "section",
    { "aria-label": props.t("cfg.candidates.label") },
    field(
      props.t("cfg.candidates.label"),
      props.t("cfg.candidates.help"),
      presetSelect(props.t("cfg.candidates.label"), String(candidates), !writable, CANDIDATE_PRESETS.map((item) => ({
        value: String(item),
        label: String(item)
      })), (next) => {
        write(["candidates"], Number(next));
      })
    ),
    field(
      props.t("cfg.intake.label"),
      props.t("cfg.intake.help"),
      (0, import_react.createElement)("input", {
        type: "checkbox",
        "aria-label": props.t("cfg.intake.label"),
        checked: intake,
        disabled: !writable,
        onChange: (event) => {
          write(["intake"], event.target.checked);
        }
      })
    ),
    field(
      props.t("cfg.gate.label"),
      props.t("cfg.gate.help"),
      presetSelect(props.t("cfg.gate.label"), gate, !writable, [
        { value: "gated", label: props.t("cfg.gate.gated") },
        { value: "always", label: props.t("cfg.gate.always") }
      ], (next) => {
        write(["intakeGate"], next);
      })
    ),
    field(
      props.t("cfg.audit.label"),
      props.t("cfg.audit.help"),
      (0, import_react.createElement)("input", {
        type: "checkbox",
        "aria-label": props.t("cfg.audit.label"),
        checked: audit,
        disabled: !writable,
        onChange: (event) => {
          write(["audit"], event.target.checked);
        }
      })
    ),
    (0, import_react.createElement)(
      "details",
      null,
      (0, import_react.createElement)("summary", null, props.t("cfg.cost.summary")),
      (0, import_react.createElement)("p", null, props.t("cfg.cost.currency")),
      field(
        props.t("cfg.scope.label"),
        props.t("cfg.scope.help"),
        presetSelect(props.t("cfg.scope.label"), scope, !writable, [
          { value: "design", label: props.t("cfg.scope.design") },
          { value: "generator_jev_only", label: props.t("cfg.scope.tight") }
        ], (next) => {
          write(["cost", "scope"], next);
        })
      ),
      field(
        props.t("cfg.flash.label"),
        props.t("cfg.flash.help"),
        presetSelect(
          props.t("cfg.flash.label"),
          String(flash),
          !writable,
          withCurrent(FLASH_CAP_PRESETS, flash).map((item) => ({ value: String(item), label: `\xA5${item}` })),
          (next) => {
            write(["cost", "maxPerSessionByModel", FLASH_ROUTE], Number(next));
          }
        )
      ),
      field(
        props.t("cfg.pro.label"),
        props.t("cfg.pro.help"),
        presetSelect(
          props.t("cfg.pro.label"),
          String(pro),
          !writable,
          withCurrent(PRO_CAP_PRESETS, pro).map((item) => ({ value: String(item), label: `\xA5${item}` })),
          (next) => {
            write(["cost", "maxPerSessionByModel", PRO_ROUTE], Number(next));
          }
        )
      ),
      field(
        props.t("cfg.unknown.label"),
        props.t("cfg.unknown.help"),
        presetSelect(
          props.t("cfg.unknown.label"),
          String(unknown),
          !writable,
          withCurrent(FLASH_CAP_PRESETS, unknown).map((item) => ({ value: String(item), label: `\xA5${item}` })),
          (next) => {
            write(["cost", "maxPerSession"], Number(next));
          }
        )
      )
    )
  );
}

// src/client/key-form.ts
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
  return (0, import_react2.createElement)(
    "form",
    {
      "aria-label": props.t("key.label"),
      onSubmit: (event) => {
        event.preventDefault();
        props.onSave();
      }
    },
    (0, import_react2.createElement)("label", { htmlFor: "dsh-verifier-typesafe-key" }, props.t("key.label")),
    (0, import_react2.createElement)("p", null, props.state.configured ? props.t("key.set") : props.t("key.unset")),
    (0, import_react2.createElement)("input", {
      id: "dsh-verifier-typesafe-key",
      type: "password",
      autoComplete: "new-password",
      value: props.state.text,
      disabled,
      onChange: (event) => {
        props.onEdit(event.target.value);
      }
    }),
    (0, import_react2.createElement)("p", null, props.t("key.hint")),
    (0, import_react2.createElement)("button", { type: "submit", disabled }, props.t("key.save")),
    (0, import_react2.createElement)("button", {
      type: "button",
      disabled: disabled || !props.state.configured,
      onClick: () => {
        props.onClear();
      }
    }, props.t("key.clear")),
    props.state.error === null ? null : (0, import_react2.createElement)("p", { role: "alert" }, props.state.error === "blank" ? props.t("key.blank") : props.state.error)
  );
}
function VerifierKeyPage(props) {
  const state = (0, import_react2.useSyncExternalStore)(props.subscribe, props.getSnapshot, props.getSnapshot);
  (0, import_react2.useEffect)(() => {
    void props.refresh();
  }, [props.refresh]);
  if (props.view === "summary") return props.t("key.summary");
  return (0, import_react2.createElement)(
    "div",
    null,
    renderSettingsForm({ t: props.t, form: props.form }),
    renderKeyForm({
      t: props.t,
      state,
      onEdit: props.edit,
      onSave: () => {
        void props.save();
      },
      onClear: () => {
        void props.clear();
      }
    })
  );
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
  "key.blank": "Enter a key, or clear the saved one.",
  "cfg.candidates.label": "Candidates K",
  "cfg.candidates.help": "How many plans to generate. Default 3. Choose 2\u20135. Each one uses the current model and a different strategy.",
  "cfg.intake.label": "Intake",
  "cfg.intake.help": "Multi-plan intake (D1). On by default. Off skips plan generation for the turn.",
  "cfg.gate.label": "Intake gate",
  "cfg.gate.help": "Default: decide automatically. Chit-chat and slash commands are skipped, then one cheap needs_multi_step_work check (0.5 or higher generates). Always is for debugging. Reviews stay on the completion audit and plan score.",
  "cfg.gate.gated": "Decide automatically",
  "cfg.gate.always": "Always generate",
  "cfg.audit.label": "Completion audit",
  "cfg.audit.help": "D4 audit. On by default. At the end of the turn, unmet acceptance gets at most one more pass.",
  "cfg.cost.summary": "Session budget",
  "cfg.cost.currency": "Caps and the running total are CNY, not USD. Jev\u2019s dollar price is converted into this total.",
  "cfg.scope.label": "What counts toward the cap",
  "cfg.scope.help": "Default is design A: candidate generation, every Jev call (including plan scoring), and main-model steps after a D4 steer. Ordinary main-loop usage does not count. Generator and Jev only is the tighter scope.",
  "cfg.scope.design": "Design A (generation, Jev, post-steer)",
  "cfg.scope.tight": "Generator and Jev only",
  "cfg.flash.label": "deepseek-flash cap",
  "cfg.flash.help": "Per-session cap in CNY. Default \xA51. Choices: 0.5, 1, 2, 4. tokenbox/deepseek-flash, any provider\u2019s deepseek-flash, and the old deepseek-v4-flash name use this tier.",
  "cfg.pro.label": "deepseek-v4-pro cap",
  "cfg.pro.help": "Per-session cap in CNY. Default \xA54. Choices: 1, 2, 4, 8.",
  "cfg.unknown.label": "Unknown model cap",
  "cfg.unknown.help": "Per-session cap in CNY for a model that is not flash or pro. Default \xA51, the lowest known tier. Choices: 0.5, 1, 2, 4."
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
  "key.blank": "\u8BF7\u8F93\u5165\u5BC6\u94A5\uFF0C\u6216\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684\u5BC6\u94A5\u3002",
  "cfg.candidates.label": "\u5019\u9009\u6570\u91CF K",
  "cfg.candidates.help": "\u751F\u6210\u51E0\u4EFD\u65B9\u6848\u3002\u9ED8\u8BA4 3\uFF0C\u53EF\u9009 2\u20135\u3002\u6BCF\u4E2A\u5019\u9009\u4F7F\u7528\u5F53\u524D\u6A21\u578B\uFF0C\u9760\u4E0D\u540C\u7B56\u7565\u533A\u5206\u3002",
  "cfg.intake.label": "\u5165\u53E3\u591A\u65B9\u6848",
  "cfg.intake.help": "\u56DE\u5408\u5165\u53E3\u591A\u65B9\u6848\uFF08D1\uFF09\u3002\u9ED8\u8BA4\u5F00\u542F\u3002\u5173\u95ED\u540E\u8FD9\u4E00\u8F6E\u4E0D\u751F\u6210\u65B9\u6848\u3002",
  "cfg.gate.label": "\u5165\u53E3\u95E8\u63A7",
  "cfg.gate.help": "\u9ED8\u8BA4\u81EA\u52A8\u5224\u65AD\uFF1A\u5148\u8DF3\u8FC7\u95F2\u804A\u548C\u659C\u6760\u547D\u4EE4\uFF0C\u518D\u7528\u4E00\u6B21\u4FBF\u5B9C\u7684 needs_multi_step_work \u5224\u65AD\uFF08\u4E0D\u4F4E\u4E8E 0.5 \u624D\u751F\u6210\uFF09\u3002\u59CB\u7EC8\u751F\u6210\u4E3A\u8C03\u8BD5\u7528\u3002\u5BA1\u6838\u4ECD\u8D70\u5B8C\u6210\u5BA1\u8BA1\u548C\u8BA1\u5212\u8BC4\u5206\uFF0C\u4E0D\u53E6\u8BBE\u5206\u7C7B\u3002",
  "cfg.gate.gated": "\u81EA\u52A8\u5224\u65AD",
  "cfg.gate.always": "\u59CB\u7EC8\u751F\u6210",
  "cfg.audit.label": "\u5B8C\u6210\u5BA1\u8BA1",
  "cfg.audit.help": "\u5B8C\u6210\u5BA1\u8BA1\uFF08D4\uFF09\u3002\u9ED8\u8BA4\u5F00\u542F\u3002\u56DE\u5408\u7ED3\u675F\u65F6\u68C0\u67E5\u9A8C\u6536\uFF0C\u672A\u901A\u8FC7\u6700\u591A\u518D\u6267\u884C\u4E00\u8F6E\u3002",
  "cfg.cost.summary": "\u4F1A\u8BDD\u9884\u7B97",
  "cfg.cost.currency": "\u4E0A\u9650\u548C\u7D2F\u8BA1\u90FD\u662F\u4EBA\u6C11\u5E01 CNY\uFF0C\u4E0D\u662F\u7F8E\u5143\u3002Jev \u7684\u7F8E\u5143\u6807\u4EF7\u4F1A\u6309\u6C47\u7387\u6298\u8FDB\u8FD9\u7B14\u8D26\u3002",
  "cfg.scope.label": "\u8BA1\u5165\u4E0A\u9650\u7684\u6765\u6E90",
  "cfg.scope.help": "\u9ED8\u8BA4\u65B9\u6848 A\uFF1A\u5019\u9009\u751F\u6210\u3001\u5168\u90E8 Jev\uFF08\u542B\u8BA1\u5212\u8BC4\u5206\uFF09\u3001D4 \u8F6C\u5411\u4E4B\u540E\u7684\u4E3B\u6A21\u578B\u6B65\u9AA4\u3002\u666E\u901A\u4E3B\u5FAA\u73AF\u4E0D\u8BA1\u3002\u4EC5\u751F\u6210\u548C Jev \u662F\u66F4\u7D27\u7684\u8303\u56F4\u3002",
  "cfg.scope.design": "\u65B9\u6848 A\uFF08\u751F\u6210\u3001Jev\u3001\u8F6C\u5411\u540E\u6B65\u9AA4\uFF09",
  "cfg.scope.tight": "\u4EC5\u751F\u6210\u548C Jev",
  "cfg.flash.label": "deepseek-flash \u4E0A\u9650",
  "cfg.flash.help": "\u6BCF\u4F1A\u8BDD\u4E0A\u9650\uFF0C\u5355\u4F4D\u4EBA\u6C11\u5E01 CNY\u3002\u9ED8\u8BA4 1\u3002\u53EF\u9009 0.5\u30011\u30012\u30014\u3002tokenbox/deepseek-flash\u3001\u4EFB\u610F provider \u7684 deepseek-flash\uFF0C\u4EE5\u53CA\u65E7\u540D deepseek-v4-flash\uFF0C\u90FD\u5F52\u5165\u8FD9\u4E00\u6863\u3002",
  "cfg.pro.label": "deepseek-v4-pro \u4E0A\u9650",
  "cfg.pro.help": "\u6BCF\u4F1A\u8BDD\u4E0A\u9650\uFF0C\u5355\u4F4D\u4EBA\u6C11\u5E01 CNY\u3002\u9ED8\u8BA4 4\u3002\u53EF\u9009 1\u30012\u30014\u30018\u3002",
  "cfg.unknown.label": "\u672A\u767B\u8BB0\u6A21\u578B\u4E0A\u9650",
  "cfg.unknown.help": "\u672A\u767B\u8BB0\u6A21\u578B\u7684\u4F1A\u8BDD\u4E0A\u9650\uFF0C\u5355\u4F4D\u4EBA\u6C11\u5E01 CNY\u3002\u9ED8\u8BA4 1\uFF0C\u53D6\u5DF2\u77E5\u6A21\u578B\u91CC\u6700\u4F4E\u7684\u4E00\u6863\u3002\u53EF\u9009 0.5\u30011\u30012\u30014\u3002"
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
  return (0, import_react3.createElement)(
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

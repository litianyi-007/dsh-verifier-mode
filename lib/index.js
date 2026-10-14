// node_modules/@deepseek-ai/cosmokit/lib/index.js
var write = Symbol.for("cosmokit.volatile.write");
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
    if (typeof date === "number") date = new Date(date);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit2) => `(${numeric}${unit2})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date) {
    const parsed = parseTime(date);
    if (parsed) date = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
    return date ? new Date(date) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// src/config.ts
import z from "@deepseek-ai/schemastery";

// src/credential-ref.ts
var TYPESAFE_API_KEY_REF = "TYPESAFE_API_KEY";

// src/pricing.ts
var FLASH_ROUTE = "deepseek/deepseek-flash";
var PRO_ROUTE = "deepseek/deepseek-v4-pro";
var DEFAULT_PRICING = {
  aliases: {
    "deepseek/deepseek-v4-flash": FLASH_ROUTE,
    "deepseek/deepseek-v4-flash-vision-exp": FLASH_ROUTE
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
function routeOf(provider, model) {
  return `${provider}/${model}`;
}
function canonicalRoute(route, aliases) {
  const seen = /* @__PURE__ */ new Set();
  let current = route;
  while (aliases[current] !== void 0 && !seen.has(current)) {
    seen.add(current);
    current = aliases[current];
  }
  return current;
}
var WEEKDAY = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};
function zonedParts(at, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(at);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(pick("hour"));
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    weekday: WEEKDAY[pick("weekday")] ?? 0,
    minutes: (Number.isFinite(hour) ? hour % 24 : 0) * 60 + Number(pick("minute") || 0)
  };
}
function windowStart(window) {
  const [from, to] = window.split("-");
  const minutes = (text) => {
    const [hour, minute] = (text ?? "0:0").split(":");
    return Number(hour) * 60 + Number(minute);
  };
  return { start: minutes(from), end: minutes(to) };
}
function isPeak(at, windows = DEFAULT_PRICING.peakWindows) {
  const zoned = zonedParts(at, windows.timeZone);
  if (windows.holidays.includes(zoned.date)) return false;
  if (!windows.weekdays.includes(zoned.weekday)) return false;
  return windows.windows.some((window) => {
    const { start, end } = windowStart(window);
    return zoned.minutes >= start && zoned.minutes < end;
  });
}
function toLedgerCny(amount, currency, fx = DEFAULT_PRICING.fx) {
  if (currency === "CNY") return amount;
  return amount * fx.usdToCny * (1 + fx.margin);
}
function mostExpensiveModel(table = DEFAULT_PRICING) {
  let bestRoute = "";
  let best;
  let bestMiss = -1;
  for (const [route, rates] of Object.entries(table.models)) {
    if (rates.inputMissPerM > bestMiss) {
      bestMiss = rates.inputMissPerM;
      best = rates;
      bestRoute = route;
    }
  }
  if (best === void 0) throw new Error("pricing table has no models");
  return { route: bestRoute, rates: best };
}
function priceUsage(route, usage, at, table = DEFAULT_PRICING) {
  const canonical = canonicalRoute(route, table.aliases);
  const known = table.models[canonical];
  const standIn = known === void 0 ? mostExpensiveModel(table) : void 0;
  const rates = known ?? standIn.rates;
  const pricedAs = known === void 0 ? standIn.route : canonical;
  const factor = rates.peakSchedule && !isPeak(at, table.peakWindows) && known !== void 0 ? table.offPeakFactor : 1;
  const hit = (usage.cacheReadTokens ?? 0) * rates.inputHitPerM;
  const miss = (usage.inputTokens + (usage.cacheWriteTokens ?? 0)) * rates.inputMissPerM;
  const output = (usage.outputTokens + (usage.reasoningTokens ?? 0)) * rates.outputPerM;
  const nativeAmount = (hit + miss + output) * factor / 1e6;
  return {
    nativeAmount,
    nativeCurrency: rates.currency,
    amountCny: toLedgerCny(nativeAmount, rates.currency, table.fx),
    pricedAs
  };
}
function priceJev(inputTokens, outputTokens, table = DEFAULT_PRICING) {
  const nativeAmount = (inputTokens * table.jev.inputPerM + outputTokens * table.jev.outputPerM) / 1e6;
  return {
    nativeAmount,
    nativeCurrency: table.jev.currency,
    amountCny: toLedgerCny(nativeAmount, table.jev.currency, table.fx),
    pricedAs: "jev"
  };
}
function resolveCap(route, caps, aliases = DEFAULT_PRICING.aliases) {
  const model = canonicalRoute(route, aliases);
  const listed = caps.maxPerSessionByModel[model];
  if (listed !== void 0) return { amount: listed, model, source: "byModel" };
  return { amount: caps.maxPerSession, model, source: "default" };
}
function estimateIntakeCny(candidates, candidateMaxTokens, generatorRoute, at, table = DEFAULT_PRICING) {
  const model = priceUsage(generatorRoute, { inputTokens: 1e3, outputTokens: candidateMaxTokens }, at, table).amountCny;
  const jev = priceJev(1e3, 0, table).amountCny;
  return candidates * (model + jev);
}

// src/config.ts
var Config = z.object({
  enabledByDefault: z.boolean().default(false).volatile(),
  candidates: z.number().default(3).volatile(),
  candidateEffort: z.string().default("low").volatile(),
  candidateMaxTokens: z.number().default(1500).volatile(),
  intake: z.boolean().default(true).volatile(),
  audit: z.boolean().default(true).volatile(),
  maxAuditRounds: z.number().default(1).volatile(),
  planReview: z.union([z.const("advise"), z.const("off")]).default("advise").volatile(),
  generatorRoute: z.object({
    provider: z.string().default(""),
    model: z.string().default("")
  }).default({ provider: "", model: "" }),
  jev: z.object({
    baseUrl: z.string().default("https://api.typesafe.ai"),
    /**
     * In-memory fallback for tests and an explicit process config.
     * The Web UI does not write this leaf. `role('secret')` only redacts a
     * settings response; it does not keep a value out of a profile patch,
     * so the page stores the key through the credentials domain instead.
     */
    apiKey: z.string().role("secret").default("").volatile(),
    apiKeyEnv: z.string().role("credential-ref").default(TYPESAFE_API_KEY_REF).volatile(),
    timeoutMs: z.number().default(1e4)
  }).default({
    baseUrl: "https://api.typesafe.ai",
    apiKey: "",
    apiKeyEnv: TYPESAFE_API_KEY_REF,
    timeoutMs: 1e4
  }),
  thresholds: z.object({
    violation: z.number().default(0.5),
    confidenceFloor: z.number().default(0.6),
    tieGap: z.number().default(0.05)
  }).default({ violation: 0.5, confidenceFloor: 0.6, tieGap: 0.05 }),
  weights: z.object({
    addresses: z.number().default(0.35),
    grounded: z.number().default(0.25),
    verifiable: z.number().default(0.25),
    scope: z.number().default(0.15)
  }).default({ addresses: 0.35, grounded: 0.25, verifiable: 0.25, scope: 0.15 }),
  cost: z.object({
    maxPerSession: z.number().default(1).volatile(),
    maxPerSessionByModel: z.dict(z.number()).default({
      [FLASH_ROUTE]: 1,
      [PRO_ROUTE]: 4
    }).volatile()
  }).default({
    maxPerSession: 1,
    maxPerSessionByModel: { [FLASH_ROUTE]: 1, [PRO_ROUTE]: 4 }
  }),
  pricing: z.object({
    offPeakFactor: z.number().default(0.5),
    holidays: z.array(z.string()).default([]),
    usdToCny: z.number().default(6.7367),
    margin: z.number().default(0.02)
  }).default({ offPeakFactor: 0.5, holidays: [], usdToCny: 6.7367, margin: 0.02 })
});
function unwrap(value) {
  if (isVolatile(value)) return unwrap(value.get());
  if (Array.isArray(value)) return value.map((item) => unwrap(item));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = unwrap(item);
    return out;
  }
  return value;
}
function resolveConfig(input) {
  const raw = unwrap(input ?? {});
  const holidays = raw.pricing?.holidays ?? [];
  return {
    enabledByDefault: raw.enabledByDefault === true,
    candidates: raw.candidates === void 0 ? 3 : Number(raw.candidates),
    candidateEffort: typeof raw.candidateEffort === "string" ? raw.candidateEffort : "low",
    candidateMaxTokens: raw.candidateMaxTokens === void 0 ? 1500 : Number(raw.candidateMaxTokens),
    intake: raw.intake !== false,
    audit: raw.audit !== false,
    maxAuditRounds: raw.maxAuditRounds === void 0 ? 1 : Number(raw.maxAuditRounds),
    planReview: raw.planReview === "off" ? "off" : "advise",
    generatorRoute: raw.generatorRoute?.provider && raw.generatorRoute.model ? { provider: raw.generatorRoute.provider, model: raw.generatorRoute.model } : void 0,
    jev: {
      baseUrl: raw.jev?.baseUrl || "https://api.typesafe.ai",
      apiKey: raw.jev?.apiKey ?? "",
      apiKeyEnv: typeof raw.jev?.apiKeyEnv === "string" && raw.jev.apiKeyEnv !== "" ? raw.jev.apiKeyEnv : TYPESAFE_API_KEY_REF,
      timeoutMs: raw.jev?.timeoutMs ?? 1e4
    },
    thresholds: {
      violation: raw.thresholds?.violation ?? 0.5,
      confidenceFloor: raw.thresholds?.confidenceFloor ?? 0.6,
      tieGap: raw.thresholds?.tieGap ?? 0.05
    },
    weights: {
      addresses: raw.weights?.addresses ?? 0.35,
      grounded: raw.weights?.grounded ?? 0.25,
      verifiable: raw.weights?.verifiable ?? 0.25,
      scope: raw.weights?.scope ?? 0.15
    },
    cost: {
      maxPerSession: raw.cost?.maxPerSession ?? 1,
      maxPerSessionByModel: {
        [FLASH_ROUTE]: 1,
        [PRO_ROUTE]: 4,
        ...raw.cost?.maxPerSessionByModel
      }
    },
    pricing: {
      ...DEFAULT_PRICING,
      offPeakFactor: raw.pricing?.offPeakFactor ?? DEFAULT_PRICING.offPeakFactor,
      peakWindows: { ...DEFAULT_PRICING.peakWindows, holidays: [...holidays] },
      fx: {
        usdToCny: raw.pricing?.usdToCny ?? DEFAULT_PRICING.fx.usdToCny,
        margin: raw.pricing?.margin ?? DEFAULT_PRICING.fx.margin
      }
    }
  };
}

// src/ledger.ts
import { z as z2 } from "zod";
var billSchema = z2.object({
  inputTokens: z2.number(),
  outputTokens: z2.number(),
  cacheReadTokens: z2.number(),
  cacheWriteTokens: z2.number(),
  reasoningTokens: z2.number()
}).strict();
var ledgerStateSchema = z2.object({
  byRoute: z2.record(z2.string(), billSchema)
}).strict();
function routeKey(provider, model) {
  return `${provider}\0${model}`;
}
function billOf(usage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0
  };
}
function addBill(left, right) {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens
  };
}
function applyLedger(state, event) {
  if (event.type !== "assistant/message" || event.data.usage === void 0) return state;
  const source = event.data.message.source;
  const key = routeKey(source.provider, source.model);
  const bill = billOf(event.data.usage);
  const previous = state.byRoute[key];
  return {
    byRoute: {
      ...state.byRoute,
      [key]: previous === void 0 ? bill : addBill(previous, bill)
    }
  };
}
var ledgerProjectionDefinition = {
  key: "verifierLedger",
  stateVersion: 1,
  stateSchema: ledgerStateSchema,
  init: () => ({ byRoute: {} }),
  apply: applyLedger
};
function readLedger(projections, session) {
  return projections.stateOf(session, "verifierLedger") ?? { byRoute: {} };
}

// src/notices.ts
import { boundContextSummary, createUserMessage } from "@deepseek-ai/dsh-llm";
var COST_CAP_MARK = "[verifier cost-cap]";
var COST_RESUME_MARK = "[verifier cost-resume]";
function verifierNotice(text, summary) {
  return createUserMessage({
    content: [{ type: "text", text }],
    source: {
      kind: "verifier-mode",
      form: "notice",
      summary: boundContextSummary(summary)
    }
  });
}
function verifierModeNotice(active) {
  return verifierNotice(
    active ? "[verifier mode on] Candidate generation and scoring apply to later steps." : "[verifier mode off] Candidate generation and scoring are off.",
    active ? "verifier mode on" : "verifier mode off"
  );
}
function decisionNotice(candidate, composite, confidence) {
  const acceptance = candidate.acceptance.map((item) => `- ${item}`).join("\n");
  return verifierNotice(
    [
      `[verifier decision] selected ${candidate.title} (composite ${composite.toFixed(2)}, confidence ${confidence.toFixed(2)})`,
      "acceptance:",
      acceptance
    ].join("\n"),
    `selected ${candidate.title}`
  );
}
function fallbackNotice(reason) {
  return verifierNotice(
    `[verifier fallback] Verifier could not decide: ${reason}`,
    "verifier could not decide"
  );
}
function costCapNotice(spent, cap, model) {
  return verifierNotice(
    `${COST_CAP_MARK} spent ${spent.toFixed(2)} cap ${cap.toFixed(2)} CNY model ${model}. Verifier is paused; continue on the normal path.`,
    "verifier paused cost cap"
  );
}
function costResumeNotice(spent, cap, model) {
  return verifierNotice(
    `${COST_RESUME_MARK} spent ${spent.toFixed(2)} cap ${cap.toFixed(2)} CNY model ${model}. Verifier is running again.`,
    "verifier cost resume"
  );
}
function planScoreNotice(summary) {
  return verifierNotice(`[verifier plan-score] ${summary}`, "verifier plan score");
}
function steerNotice(failed) {
  return verifierNotice(
    `[verifier audit] unmet: ${failed.join(", ")}. Fix those items and finish.`,
    "verifier audit failed"
  );
}
function incompleteNotice(failed) {
  return verifierNotice(
    `[verifier incomplete] still unmet after one steer: ${failed.join(", ")}`,
    "verifier audit incomplete"
  );
}

// src/projection.ts
import { z as z3 } from "zod";
var stateSchema = z3.object({
  active: z3.boolean(),
  running: z3.object({
    commandId: z3.string(),
    wanted: z3.enum(["on", "off", "once"])
  }).strict().nullable(),
  onceArmed: z3.boolean(),
  paused: z3.boolean(),
  pendingPlan: z3.object({
    callId: z3.string(),
    text: z3.string()
  }).strict().nullable(),
  approvedPlan: z3.string().nullable()
}).strict();
var viewSchema = z3.object({
  active: z3.boolean(),
  paused: z3.boolean()
}).strict();
function wantedFromArgs(args) {
  const trimmed = args?.trim() ?? "";
  if (trimmed === "on") return "on";
  if (trimmed === "off") return "off";
  if (trimmed === "once" || trimmed.startsWith("once ")) return "once";
  return void 0;
}
function messageText(blocks) {
  return blocks.flatMap((block) => block.type === "text" && block.text !== void 0 ? [block.text] : []).join("");
}
function createVerifierProjection(readEnabled) {
  return {
    key: "verifier",
    stateVersion: 3,
    stateSchema,
    init: () => ({
      active: readEnabled(),
      running: null,
      onceArmed: false,
      paused: false,
      pendingPlan: null,
      approvedPlan: null
    }),
    apply: (state, event) => {
      if (event.type === "command/run" && event.data.name === "verifier") {
        const wanted = wantedFromArgs(event.data.args);
        if (wanted === void 0) return state;
        return { ...state, running: { commandId: event.data.commandId, wanted } };
      }
      if (event.type === "command/done" && state.running !== null && event.data.commandId === state.running.commandId) {
        if (event.data.kind !== "success") return { ...state, running: null };
        if (state.running.wanted === "once") return { ...state, onceArmed: true, running: null };
        if (state.running.wanted === "on") return { ...state, active: true, running: null };
        return {
          ...state,
          active: false,
          onceArmed: false,
          paused: false,
          pendingPlan: null,
          approvedPlan: null,
          running: null
        };
      }
      if (event.type === "turn/end" && state.onceArmed) return { ...state, onceArmed: false };
      if (event.type === "user/message") {
        const text = messageText(event.data.content);
        if (text.includes(COST_CAP_MARK)) return state.paused ? state : { ...state, paused: true };
        if (text.includes(COST_RESUME_MARK)) return state.paused ? { ...state, paused: false } : state;
        return state;
      }
      if (event.type === "tool/call" && event.data.name === "exit_plan_mode") {
        let text = "";
        try {
          const parsed = JSON.parse(event.data.arguments);
          if (typeof parsed.plan === "string") text = parsed.plan;
        } catch {
          text = "";
        }
        return { ...state, pendingPlan: { callId: String(event.data.callId), text } };
      }
      if (event.type === "tool/result" && state.pendingPlan !== null && String(event.data.message.toolCallId) === state.pendingPlan.callId) {
        if (event.data.message.isError === true) return { ...state, pendingPlan: null };
        return { ...state, approvedPlan: state.pendingPlan.text, pendingPlan: null };
      }
      return state;
    },
    wire: {
      viewSchema,
      view: (state) => ({ active: state.active, paused: state.paused })
    }
  };
}

// src/route.ts
import { z as z4 } from "zod";
var routeFieldsSchema = z4.object({
  provider: z4.string(),
  model: z4.string()
}).strict();
var routeStateSchema = z4.object({
  pending: routeFieldsSchema.nullable(),
  lastUsed: routeFieldsSchema.nullable()
}).strict();
function sameRoute(left, right) {
  return left.provider === right.provider && left.model === right.model;
}
function selectionOf(event) {
  return { provider: event.data.provider, model: event.data.model };
}
function headerOf(event) {
  return {
    provider: event.data.header.config.provider,
    model: event.data.header.config.model
  };
}
function applyRoute(state, event) {
  if (event.type === "model/selection") {
    const next = selectionOf(event);
    const current = state.pending ?? state.lastUsed;
    if (current !== null && sameRoute(current, next)) return state;
    return { pending: next, lastUsed: state.lastUsed };
  }
  if (event.type !== "request/header") return state;
  const used = headerOf(event);
  const pending2 = state.pending !== null && sameRoute(state.pending, used) ? null : state.pending;
  if (pending2 === state.pending && state.lastUsed !== null && sameRoute(state.lastUsed, used)) return state;
  return { pending: pending2, lastUsed: used };
}
function currentRouteFromEvents(events, options = {}) {
  let state = { pending: null, lastUsed: null };
  for (const event of events) state = applyRoute(state, event);
  return routeFromState(state, options);
}
function routeFromState(state, options) {
  if (state?.pending) return { ...state.pending, source: "model/selection" };
  if (state?.lastUsed) return { ...state.lastUsed, source: "request/header" };
  return {
    provider: options.provider ?? "",
    model: options.model ?? "",
    source: "agent.options"
  };
}
var routeProjectionDefinition = {
  key: "verifierRoute",
  stateVersion: 1,
  stateSchema: routeStateSchema,
  init: () => ({ pending: null, lastUsed: null }),
  apply: applyRoute
};
function readCurrentRoute(projections, session, options = {}) {
  return routeFromState(projections.stateOf(session, "verifierRoute"), options);
}

// src/runtime.ts
import { createUserMessage as createUserMessage2, ReasoningEffortId } from "@deepseek-ai/dsh-llm";

// src/clock.ts
var costClock = {
  now() {
    return /* @__PURE__ */ new Date();
  }
};

// src/candidates.ts
var STRATEGIES = [
  "minimal-change",
  "test-first",
  "investigate-first",
  "alternative-approach"
];
function candidatePrompt(strategy, task) {
  return [
    `Strategy: ${strategy}.`,
    "You are proposing a plan, not executing it. Do not call tools.",
    "Reply with one JSON object only, no markdown:",
    '{"title":"...","steps":["..."],"acceptance":["..."],"risks":["..."]}',
    "Task:",
    task
  ].join("\n");
}
function stringList(value) {
  if (!Array.isArray(value)) return void 0;
  if (!value.every((item) => typeof item === "string")) return void 0;
  return value;
}
function parseCandidate(text, id) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return void 0;
  }
  if (parsed === null || typeof parsed !== "object") return void 0;
  const record = parsed;
  const steps = stringList(record.steps);
  const acceptance = stringList(record.acceptance);
  if (typeof record.title !== "string" || record.title.trim() === "" || steps === void 0 || acceptance === void 0) {
    return void 0;
  }
  return {
    id,
    title: record.title,
    steps,
    acceptance,
    risks: stringList(record.risks) ?? []
  };
}

// src/cost-book.ts
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import { z as z5 } from "zod";
var usageSchema = z5.object({
  sessionId: z5.string(),
  seq: z5.number(),
  source: z5.enum(["main", "generator", "jev"]),
  model: z5.string(),
  amountCny: z5.number(),
  nativeAmount: z5.number(),
  nativeCurrency: z5.enum(["CNY", "USD"])
});
var verifierTraceDomain = storageDomain.defineDomain({
  name: "verifier_trace",
  version: 1,
  tables: {
    usage: storageDomain.domainTable(usageSchema)
  }
});
var lines = /* @__PURE__ */ new Map();
var hydratedEpoch = /* @__PURE__ */ new Map();
var epoch = 0;
var usageTable;
var closeStore;
var opening;
var pending = Promise.resolve();
function sessionKey(id) {
  return String(id);
}
function readDisk(sessionId) {
  if (usageTable === void 0) return [];
  const rows = [];
  for (const [, record] of usageTable.entries()) {
    if (record.sessionId === sessionId) rows.push(record);
  }
  rows.sort((left, right) => left.seq - right.seq);
  return rows.map((record) => ({
    source: record.source,
    model: record.model,
    amountCny: record.amountCny,
    nativeAmount: record.nativeAmount,
    nativeCurrency: record.nativeCurrency
  }));
}
function ensureHydrated(sessionId) {
  if (hydratedEpoch.get(sessionId) === epoch) return;
  if (usageTable !== void 0) {
    const memory = lines.get(sessionId);
    if (memory === void 0 || memory.length === 0) lines.set(sessionId, readDisk(sessionId));
  }
  hydratedEpoch.set(sessionId, epoch);
}
function bindUsageStore(table, close) {
  usageTable = table;
  closeStore = close;
  epoch += 1;
}
function ensureUsageStore(ctx) {
  if (usageTable !== void 0) return Promise.resolve();
  if (opening !== void 0) return opening;
  const facility = ctx.get("storageDomain");
  if (facility === void 0) return Promise.resolve();
  opening = facility.open(verifierTraceDomain).then((domain) => {
    bindUsageStore(domain.table("usage"), () => domain.close());
  }).catch((error) => {
    opening = void 0;
    throw error;
  });
  return opening;
}
async function addCostLine(sessionId, line) {
  ensureHydrated(sessionId);
  const list = lines.get(sessionId) ?? [];
  const seq = list.length;
  list.push(line);
  lines.set(sessionId, list);
  hydratedEpoch.set(sessionId, epoch);
  if (usageTable === void 0) return;
  const write2 = usageTable.put(`${sessionId}#${seq}`, { sessionId, seq, ...line });
  pending = pending.then(() => write2.then(() => void 0), () => write2.then(() => void 0));
  await write2;
}
function sessionSpendCny(sessionId) {
  ensureHydrated(sessionId);
  return (lines.get(sessionId) ?? []).reduce((sum, line) => sum + line.amountCny, 0);
}
function watchUsageStore(ctx) {
  void ensureUsageStore(ctx).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown";
    process.stderr.write(`dsh: verifier cost ledger open failed: ${message}
`);
  });
  ctx.on("internal/service", (name2) => {
    if (name2 !== "storageDomain") return;
    void ensureUsageStore(ctx).catch((error) => {
      const message = error instanceof Error ? error.message : "unknown";
      process.stderr.write(`dsh: verifier cost ledger open failed: ${message}
`);
    });
  });
}

// src/jev-key.ts
import { credentialRef, isCredentialRefName } from "@deepseek-ai/dsh-credentials";
async function resolveJevApiKey(ctx, config) {
  const name2 = config.jev.apiKeyEnv || TYPESAFE_API_KEY_REF;
  const credentials = ctx.get("credentials");
  if (credentials !== void 0 && isCredentialRefName(name2)) {
    const resolved = await credentials.resolve(credentialRef(name2));
    if (resolved !== void 0 && resolved.value !== "") return resolved.value;
  }
  return config.jev.apiKey;
}

// src/jev.ts
import { randomBytes } from "node:crypto";
var JEV_MODEL = "jev-1.13.0";
var EVIDENCE_CHARS = 8e3;
function freshNonce() {
  return randomBytes(8).toString("hex");
}
function delimitEvidence(text, nonce) {
  const clipped = text.length <= EVIDENCE_CHARS ? text : text.slice(0, EVIDENCE_CHARS);
  return `<evidence nonce="${nonce}">
${clipped}
</evidence nonce="${nonce}">`;
}
function clipTask(text) {
  return text.length <= EVIDENCE_CHARS ? text : text.slice(0, EVIDENCE_CHARS);
}
var GROUNDED_RUBRIC = [
  "Contradicts the evidence",
  "Mostly unsupported by the evidence",
  "Mostly grounded in the evidence",
  "Grounded in the evidence"
];
var VERIFIABLE_RUBRIC = [
  "Cannot be checked",
  "Hard to check",
  "Mostly checkable",
  "Directly verifiable"
];
var SCOPE_RUBRIC = [
  "Much larger than the request",
  "Broader than the request",
  "Close to the requested scope",
  "Smallest change that does the job"
];
var INTAKE_QUESTIONS = [
  {
    key: "violates_constraint_0",
    kind: "noul",
    instructions: "Does the candidate violate the constraint at index 0 of `constraints`?",
    yes: "It violates that constraint.",
    no: "It does not violate that constraint."
  },
  {
    key: "irreversible_without_approval",
    kind: "noul",
    instructions: "Is the candidate irreversible without explicit approval?",
    yes: "It is irreversible without approval.",
    no: "It is reversible, or approval is already present."
  },
  {
    key: "addresses_request",
    kind: "score",
    levels: 5,
    instructions: "How completely does the candidate address the request in `task`?",
    rubric: [
      "Does not address the request",
      "Mentions the request and misses the main ask",
      "Addresses part of the request",
      "Addresses the request with a small gap",
      "Addresses the request"
    ]
  },
  {
    key: "grounded_in_evidence",
    kind: "score",
    levels: 4,
    instructions: "How grounded is the candidate in `evidence`?",
    rubric: GROUNDED_RUBRIC
  },
  {
    key: "verifiable",
    kind: "score",
    levels: 4,
    instructions: "How verifiable is the candidate?",
    rubric: VERIFIABLE_RUBRIC
  },
  {
    key: "scope_risk",
    kind: "score",
    levels: 4,
    instructions: "How close is the candidate to the smallest change that does the job? Higher means a smaller change.",
    rubric: SCOPE_RUBRIC
  }
];
function auditQuestions(acceptance) {
  const criteria = acceptance.slice(0, 5).map((text, index) => ({
    key: `criterion_met_${index}`,
    kind: "noul",
    // A high noul is an audit failure. Ask whether the criterion is unmet.
    instructions: `Is acceptance criterion ${index} unmet? Its text is: ${text}`,
    yes: "That criterion is unmet.",
    no: "That criterion is met."
  }));
  return [
    ...criteria,
    {
      key: "unverified_claims",
      kind: "noul",
      instructions: "Does the work make a claim that `evidence` does not support?",
      yes: "It makes an unsupported claim.",
      no: "Its claims are supported, or it makes none."
    },
    {
      key: "claims_supported_by_evidence",
      kind: "score",
      levels: 4,
      instructions: "How well does `evidence` support the claims in the work?",
      rubric: [
        "Claims contradict the evidence",
        "Claims are mostly unsupported",
        "Claims are mostly supported",
        "Claims are supported by the evidence"
      ]
    }
  ];
}
function systemOneBody(body) {
  const questions = {};
  for (const question of body.questions) {
    if (question.kind === "score") {
      const criteria2 = [...question.rubric ?? []];
      if (criteria2.length < 2 || question.levels !== void 0 && criteria2.length !== question.levels) {
        throw new Error(`jev score ${question.key} needs one criterion per level`);
      }
      questions[question.key] = {
        type: "score",
        instructions: question.instructions,
        criteria: criteria2
      };
      continue;
    }
    const criteria = {};
    if (question.yes !== void 0) criteria.true = question.yes;
    if (question.no !== void 0) criteria.false = question.no;
    questions[question.key] = {
      type: "noul",
      instructions: question.instructions,
      ...Object.keys(criteria).length === 0 ? {} : { criteria }
    };
  }
  return { state: body.state, model: JEV_MODEL, questions };
}
function numberField(record, ...keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  return void 0;
}
function parseAnswer(raw) {
  if (raw === null || typeof raw !== "object") return void 0;
  const record = raw;
  if (record.type === "noul" && typeof record.noul === "number") {
    return { value: record.noul, confidence: typeof record.confidence === "number" ? record.confidence : 0 };
  }
  if (record.type === "score" && typeof record.score === "number") {
    return { value: record.score, confidence: typeof record.confidence === "number" ? record.confidence : 0 };
  }
  if (typeof record.value === "number") {
    const confidence = typeof record.confidence === "number" ? record.confidence : 0;
    return typeof record.levels === "number" ? { value: record.value, confidence, levels: record.levels } : { value: record.value, confidence };
  }
  return void 0;
}
function parseJevResponse(payload) {
  const record = payload !== null && typeof payload === "object" ? payload : {};
  const usageRecord = record.usage !== null && typeof record.usage === "object" ? record.usage : void 0;
  const inputTokens = usageRecord === void 0 ? void 0 : numberField(usageRecord, "inputTokens", "input_tokens");
  const outputTokens = usageRecord === void 0 ? void 0 : numberField(usageRecord, "outputTokens", "output_tokens");
  const answers = {};
  if (record.answers !== null && typeof record.answers === "object") {
    for (const [key, value] of Object.entries(record.answers)) {
      const parsed = parseAnswer(value);
      if (parsed !== void 0) answers[key] = parsed;
    }
  }
  return {
    ...inputTokens === void 0 && outputTokens === void 0 ? {} : { usage: { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 } },
    answers
  };
}
async function postJev(baseUrl, apiKey, body, signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(new URL("/v1/systemone", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...apiKey === "" ? {} : { authorization: `Bearer ${apiKey}` }
    },
    body: JSON.stringify(systemOneBody(body)),
    signal: AbortSignal.any([signal, timeout])
  });
  if (!response.ok) throw new Error(`jev ${response.status}`);
  return parseJevResponse(await response.json());
}

// src/selector.ts
var SCORE_WEIGHT = {
  addresses_request: "addresses",
  grounded_in_evidence: "grounded",
  verifiable: "verifiable",
  scope_risk: "scope"
};
function unit(value, levels) {
  if (levels !== void 0 && levels > 1) return value / (levels - 1);
  return value;
}
function scoreCandidate(scored, rules) {
  for (const key of rules.noulKeys) {
    const answer = scored.answers[key];
    if (answer === void 0) return { eligible: false, composite: 0, confidence: 0, scope: 0, reason: `missing ${key}` };
    if (answer.value >= rules.violation) {
      return { eligible: false, composite: 0, confidence: 0, scope: 0, reason: `${key} ${answer.value}` };
    }
  }
  let composite = 0;
  let confidence = 1;
  let scope = 0;
  for (const key of rules.scoreKeys) {
    const answer = scored.answers[key];
    if (answer === void 0) return { eligible: false, composite: 0, confidence: 0, scope: 0, reason: `missing ${key}` };
    const weightKey = SCORE_WEIGHT[key];
    const weight = weightKey === void 0 ? 0 : rules.weights[weightKey];
    const normalized = unit(answer.value, rules.scoreLevels[key]);
    composite += weight * normalized;
    confidence = Math.min(confidence, answer.confidence);
    if (key === "scope_risk") scope = normalized;
  }
  if (confidence < rules.confidenceFloor) {
    return { eligible: false, composite, confidence, scope, reason: `confidence ${confidence}` };
  }
  return { eligible: true, composite, confidence, scope };
}
function selectWinner(scored, rules) {
  const ranked = scored.flatMap((item) => {
    const score = scoreCandidate(item, rules);
    return score.eligible ? [{ item, score }] : [];
  });
  if (ranked.length === 0) return { kind: "fallback", reason: "no eligible candidate" };
  ranked.sort((left, right) => right.score.composite - left.score.composite || right.score.scope - left.score.scope);
  const [first, second] = ranked;
  let chosen = first;
  if (second !== void 0 && chosen.score.composite - second.score.composite < rules.tieGap) {
    chosen = chosen.score.scope >= second.score.scope ? chosen : second;
  }
  return {
    kind: "winner",
    candidate: chosen.item.candidate,
    composite: chosen.score.composite,
    confidence: chosen.score.confidence
  };
}

// src/summary.ts
import { z as z6 } from "zod";
var judgeStateSchema = z6.object({
  lines: z6.array(z6.string()),
  names: z6.record(z6.string(), z6.string())
}).strict();
function textOf(blocks) {
  return blocks.flatMap((block) => block.type === "text" && block.text !== void 0 ? [block.text] : []).join("");
}
function initJudge() {
  return { lines: [], names: {} };
}
function applyJudge(state, event) {
  if (event.type === "user/message") {
    return { ...state, lines: [...state.lines, `user: ${textOf(event.data.content)}`] };
  }
  if (event.type === "assistant/message") {
    const text = textOf(event.data.message.content);
    if (text === "") return state;
    return { ...state, lines: [...state.lines, `assistant: ${text}`] };
  }
  if (event.type === "tool/call") {
    return {
      ...state,
      names: { ...state.names, [String(event.data.callId)]: event.data.name }
    };
  }
  if (event.type === "tool/result") {
    const flag = event.data.message.isError === true ? "error" : "ok";
    const name2 = state.names[String(event.data.message.toolCallId)] ?? "unknown";
    return {
      ...state,
      lines: [...state.lines, `tool ${name2} ${flag}: ${textOf(event.data.message.content)}`]
    };
  }
  return state;
}
function summarizeSession(events) {
  let state = initJudge();
  for (const event of events) state = applyJudge(state, event);
  return state.lines.join("\n");
}
var judgeProjectionDefinition = {
  key: "verifierJudge",
  stateVersion: 1,
  stateSchema: judgeStateSchema,
  init: initJudge,
  apply: applyJudge
};
function readJudgeDigest(projections, session) {
  return projections.stateOf(session, "verifierJudge")?.lines.join("\n") ?? "";
}

// src/trace.ts
var traces = /* @__PURE__ */ new Map();
function pushTrace(sessionId, record) {
  const list = traces.get(sessionId) ?? [];
  list.push(record);
  traces.set(sessionId, list);
}
function readVerifierTraces(sessionId) {
  return traces.get(sessionId) ?? [];
}

// src/runtime.ts
var steers = /* @__PURE__ */ new Map();
var planNotes = /* @__PURE__ */ new Map();
var turnStrategy = /* @__PURE__ */ new Map();
var DEFAULT_JEV_URL = "https://api.typesafe.ai";
async function judgeReady(ctx, config) {
  const key = await resolveJevApiKey(ctx, config);
  if (key !== "") return true;
  return config.jev.baseUrl !== DEFAULT_JEV_URL;
}
function planActive(ctx, agent) {
  const plan = ctx.get("planMode");
  return plan?.get(agent).active === true;
}
function textOf2(messages) {
  return messages.flatMap((message) => message.content ?? []).flatMap((block) => block.type === "text" && block.text ? [block.text] : []).join("\n");
}
function intakeRules(config) {
  return {
    violation: config.thresholds.violation,
    confidenceFloor: config.thresholds.confidenceFloor,
    tieGap: config.thresholds.tieGap,
    weights: config.weights,
    noulKeys: INTAKE_QUESTIONS.filter((question) => question.kind === "noul").map((question) => question.key),
    scoreKeys: INTAKE_QUESTIONS.filter((question) => question.kind === "score").map((question) => question.key),
    scoreLevels: Object.fromEntries(INTAKE_QUESTIONS.flatMap((question) => question.kind === "score" && question.levels !== void 0 ? [[question.key, question.levels]] : []))
  };
}
async function billJev(sessionId, response) {
  const inputTokens = response.usage?.inputTokens ?? 0;
  const outputTokens = response.usage?.outputTokens ?? 0;
  const priced = priceJev(inputTokens, outputTokens);
  await addCostLine(sessionId, {
    source: "jev",
    model: "jev",
    amountCny: priced.amountCny,
    nativeAmount: priced.nativeAmount,
    nativeCurrency: priced.nativeCurrency
  });
}
async function generateOne(ctx, config, sessionId, provider, model, strategy, task, signal, cap) {
  const llm = ctx.get("llm");
  if (llm === void 0) throw new Error("llm service is unavailable");
  const chunks = [];
  const stream = llm.stream({
    provider,
    model,
    reasoningEffort: ReasoningEffortId(config.candidateEffort),
    maxTokens: config.candidateMaxTokens,
    messages: [createUserMessage2({
      content: [{ type: "text", text: candidatePrompt(strategy, task) }],
      source: { kind: "user" }
    })],
    signal
  });
  let overCap = false;
  let billed = false;
  for await (const chunk of stream) {
    if (chunk.type === "finish" && chunk.reason?.kind === "error") {
      throw new Error(chunk.reason.failure?.message ?? "generator failed");
    }
    chunks.push(chunk);
    if (chunk.type === "usage" && chunk.usage && !billed) {
      billed = true;
      const priced = priceUsage(routeOf(provider, model), chunk.usage, costClock.now(), config.pricing);
      await addCostLine(sessionId, {
        source: "generator",
        model: routeOf(provider, model),
        amountCny: priced.amountCny,
        nativeAmount: priced.nativeAmount,
        nativeCurrency: priced.nativeCurrency
      });
      if (sessionSpendCny(sessionId) >= cap) overCap = true;
    }
    if (overCap) break;
  }
  const text = chunks.flatMap((chunk) => chunk.type === "text-delta" && chunk.text ? [chunk.text] : []).join("");
  return { candidate: parseCandidate(text, strategy), overCap };
}
function pause(sessionId, spent, cap, messages, alreadyPaused) {
  if (alreadyPaused) return messages;
  pushTrace(sessionId, {
    point: "intake",
    outcome: "cost-cap",
    spentCny: spent,
    cap: cap.amount,
    capModel: cap.model
  });
  process.stderr.write(`dsh: verifier paused cost-cap spent=${spent.toFixed(2)} cap=${cap.amount.toFixed(2)} model=${cap.model}
`);
  return [...messages, costCapNotice(spent, cap.amount, cap.model)];
}
async function runIntake(ctx, config, agent, turn, signal, decision) {
  await ensureUsageStore(ctx);
  const state = ctx.sessionProjections.stateOf(agent.session, "verifier");
  const effective = state?.active === true || state?.onceArmed === true;
  if (!effective || !config.intake) return decision;
  if (planActive(ctx, agent)) return decision;
  const sessionId = sessionKey(agent.session.id);
  const current = readCurrentRoute(ctx.sessionProjections, agent.session, agent.options);
  const mainRoute = routeOf(current.provider, current.model);
  const generator = config.generatorRoute ?? { provider: current.provider, model: current.model };
  const generatorRoute = routeOf(generator.provider, generator.model);
  const cap = resolveCap(mainRoute, config.cost, config.pricing.aliases);
  const spent = sessionSpendCny(sessionId);
  const estimate = estimateIntakeCny(config.candidates, config.candidateMaxTokens, generatorRoute, costClock.now(), config.pricing);
  const over = spent >= cap.amount || spent + estimate > cap.amount;
  if (over) {
    return { ...decision, messages: pause(sessionId, spent, cap, decision.messages, state?.paused === true) };
  }
  let messages = decision.messages;
  if (state?.paused === true) {
    messages = [...messages, costResumeNotice(spent, cap.amount, cap.model)];
  }
  if (state?.approvedPlan) return { ...decision, messages };
  if (!await judgeReady(ctx, config)) {
    pushTrace(sessionId, { point: "intake", outcome: "fallback", reason: "jev is not configured" });
    return { ...decision, messages: [...messages, fallbackNotice("jev is not configured")] };
  }
  const task = clipTask(textOf2(messages));
  const evidence = delimitEvidence(readJudgeDigest(ctx.sessionProjections, agent.session), freshNonce());
  const strategies = STRATEGIES.slice(0, config.candidates);
  const parsed = [];
  for (const strategy of strategies) {
    if (signal.aborted || sessionSpendCny(sessionId) >= cap.amount) {
      return { ...decision, messages: pause(sessionId, sessionSpendCny(sessionId), cap, messages, false) };
    }
    const generated = await generateOne(ctx, config, sessionId, generator.provider, generator.model, strategy, task, signal, cap.amount);
    if (generated.candidate) parsed.push(generated.candidate);
    if (generated.overCap || sessionSpendCny(sessionId) >= cap.amount) {
      return { ...decision, messages: pause(sessionId, sessionSpendCny(sessionId), cap, messages, false) };
    }
  }
  if (parsed.length < 2) {
    pushTrace(sessionId, { point: "intake", outcome: "fallback", reason: "fewer than 2 candidates" });
    return { ...decision, messages: [...messages, fallbackNotice("fewer than 2 candidates")] };
  }
  let scored;
  try {
    scored = [];
    for (const candidate of parsed) {
      const response = await postJev(config.jev.baseUrl, await resolveJevApiKey(ctx, config), {
        point: "intake",
        state: { task, constraints: [], evidence, candidate },
        questions: INTAKE_QUESTIONS
      }, signal, config.jev.timeoutMs);
      await billJev(sessionId, response);
      if (sessionSpendCny(sessionId) >= cap.amount) {
        return { ...decision, messages: pause(sessionId, sessionSpendCny(sessionId), cap, messages, false) };
      }
      scored.push({ candidate, answers: response.answers });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "jev failed";
    pushTrace(sessionId, { point: "intake", outcome: "fallback", reason });
    return { ...decision, messages: [...messages, fallbackNotice(reason)] };
  }
  const selected = selectWinner(scored, intakeRules(config));
  if (selected.kind === "fallback") {
    pushTrace(sessionId, { point: "intake", outcome: "fallback", reason: selected.reason });
    return { ...decision, messages: [...messages, fallbackNotice(selected.reason)] };
  }
  turnStrategy.set(`${sessionId}:${turn}`, selected.candidate.acceptance);
  pushTrace(sessionId, { point: "intake", outcome: "committed", winner: selected.candidate.title, spentCny: sessionSpendCny(sessionId), cap: cap.amount, capModel: cap.model });
  return {
    ...decision,
    messages: [...messages, decisionNotice(selected.candidate, selected.composite, selected.confidence)]
  };
}
async function runAudit(ctx, config, agent, turn, signal) {
  await ensureUsageStore(ctx);
  const state = ctx.sessionProjections.stateOf(agent.session, "verifier");
  const effective = state?.active === true || state?.onceArmed === true;
  if (!effective || !config.audit || state?.paused === true || planActive(ctx, agent) || !await judgeReady(ctx, config)) return;
  const sessionId = sessionKey(agent.session.id);
  const current = readCurrentRoute(ctx.sessionProjections, agent.session, agent.options);
  const cap = resolveCap(routeOf(current.provider, current.model), config.cost, config.pricing.aliases);
  if (sessionSpendCny(sessionId) >= cap.amount) {
    if (state?.paused !== true) {
      agent.session.append("user/message", costCapNotice(sessionSpendCny(sessionId), cap.amount, cap.model), { surfaceOp: "append" });
      process.stderr.write(`dsh: verifier paused cost-cap spent=${sessionSpendCny(sessionId).toFixed(2)} cap=${cap.amount.toFixed(2)} model=${cap.model}
`);
      pushTrace(sessionId, { point: "audit", outcome: "cost-cap", spentCny: sessionSpendCny(sessionId), cap: cap.amount, capModel: cap.model });
    }
    return;
  }
  const acceptance = state?.approvedPlan ? [state.approvedPlan] : turnStrategy.get(`${sessionId}:${turn}`) ?? [];
  const task = clipTask(readJudgeDigest(ctx.sessionProjections, agent.session));
  const evidence = delimitEvidence(task, freshNonce());
  let failed = [];
  try {
    const response = await postJev(config.jev.baseUrl, await resolveJevApiKey(ctx, config), {
      point: "audit",
      state: {
        task,
        constraints: [],
        evidence,
        acceptance,
        plan: state?.approvedPlan ?? void 0
      },
      questions: auditQuestions(acceptance)
    }, signal, config.jev.timeoutMs);
    await billJev(sessionId, response);
    failed = auditQuestions(acceptance).flatMap((question) => {
      if (question.kind !== "noul") return [];
      const answer = response.answers[question.key];
      return answer !== void 0 && answer.value >= config.thresholds.violation ? [question.key] : [];
    });
  } catch (error) {
    pushTrace(sessionId, { point: "audit", outcome: "fallback", reason: error instanceof Error ? error.message : "jev failed" });
    return;
  }
  if (failed.length === 0) {
    pushTrace(sessionId, { point: "audit", outcome: "passed" });
    return;
  }
  const used = steers.get(`${sessionId}:${turn}`) ?? 0;
  if (used < config.maxAuditRounds) {
    steers.set(`${sessionId}:${turn}`, used + 1);
    pushTrace(sessionId, { point: "audit", outcome: "steered", reason: failed.join(",") });
    agent.steer(steerNotice(failed));
    return;
  }
  pushTrace(sessionId, { point: "audit", outcome: "incomplete", reason: failed.join(",") });
  agent.session.append("user/message", incompleteNotice(failed), { surfaceOp: "append" });
}
async function scorePlan(ctx, config, agent, callId, plan, signal) {
  await ensureUsageStore(ctx);
  const state = ctx.sessionProjections.stateOf(agent.session, "verifier");
  const armed = state?.active === true || state?.onceArmed === true;
  if (!armed || config.planReview !== "advise" || state?.paused === true || !await judgeReady(ctx, config)) return;
  const sessionId = sessionKey(agent.session.id);
  const task = clipTask(plan);
  const evidence = delimitEvidence(plan, freshNonce());
  try {
    const response = await postJev(config.jev.baseUrl, await resolveJevApiKey(ctx, config), {
      point: "plan",
      state: { task, constraints: [], evidence, plan, candidate: { id: "plan", title: "submitted plan", steps: [plan], acceptance: [plan], risks: [] } },
      questions: INTAKE_QUESTIONS
    }, signal, config.jev.timeoutMs);
    await billJev(sessionId, response);
    const selected = selectWinner([{
      candidate: { id: "plan", title: "submitted plan", steps: [plan], acceptance: [plan], risks: [] },
      answers: response.answers
    }], intakeRules(config));
    const summary = selected.kind === "winner" ? `composite ${selected.composite.toFixed(2)}, confidence ${selected.confidence.toFixed(2)}` : selected.reason;
    planNotes.set(callId, planScoreNotice(summary));
    pushTrace(sessionId, { point: "plan", outcome: "plan-score", reason: summary });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "jev failed";
    planNotes.set(callId, planScoreNotice(reason));
    pushTrace(sessionId, { point: "plan", outcome: "fallback", reason });
  }
}
function takePlanNote(callId) {
  const note = planNotes.get(callId);
  if (note !== void 0) planNotes.delete(callId);
  return note;
}
async function billAssistantUsage(sessionId, provider, model, usage, table) {
  const priced = priceUsage(routeOf(provider, model), usage, costClock.now(), table);
  await addCostLine(sessionId, {
    source: "main",
    model: routeOf(provider, model),
    amountCny: priced.amountCny,
    nativeAmount: priced.nativeAmount,
    nativeCurrency: priced.nativeCurrency
  });
}

// src/index.ts
var name = "dsh-verifier-mode";
var inject = ["commands", "sessionProjections", "llm"];
function parseMode(rawInput) {
  const arg = rawInput.trim();
  if (arg === "" || arg === "status") return "status";
  if (arg === "on" || arg === "off") return arg;
  if (arg === "once" || arg.startsWith("once ")) return "once";
  return "invalid";
}
async function apply(ctx, config = { enabledByDefault: false }) {
  const readConfig = () => resolveConfig(config);
  await ensureUsageStore(ctx);
  watchUsageStore(ctx);
  ctx.sessionProjections.register(createVerifierProjection(() => readConfig().enabledByDefault));
  ctx.sessionProjections.register(routeProjectionDefinition);
  ctx.sessionProjections.register(ledgerProjectionDefinition);
  ctx.sessionProjections.register(judgeProjectionDefinition);
  ctx.on("session/event", (session, event) => {
    if (event.type !== "assistant/message" || event.data.usage === void 0) return;
    const usage = event.data.usage;
    const source = event.data.message.source;
    void billAssistantUsage(sessionKey(session.id), source.provider, source.model, usage, readConfig().pricing).catch((error) => {
      const message = error instanceof Error ? error.message : "unknown";
      process.stderr.write(`dsh: verifier cost ledger write failed: ${message}
`);
    });
  });
  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = await next();
    if (decision.kind !== "enter" || payload.step !== 1) return decision;
    try {
      return await runIntake(ctx, readConfig(), payload.agent, payload.turn, payload.signal, decision);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "intake failed";
      return { ...decision, messages: [...decision.messages, fallbackNotice(reason)] };
    }
  });
  ctx.on("agent/turn-stopping", async (payload) => {
    try {
      await runAudit(ctx, readConfig(), payload.agent, payload.turn, payload.signal);
    } catch {
    }
  });
  ctx.on("tools/pre-execute", async (exec, next) => {
    const decision = await next();
    if (exec.name !== "exit_plan_mode" || exec.agent === void 0) return decision;
    const plan = typeof exec.arguments === "object" && exec.arguments !== null && "plan" in exec.arguments && typeof exec.arguments.plan === "string" ? exec.arguments.plan : "";
    try {
      await scorePlan(ctx, readConfig(), exec.agent, String(exec.callId), plan, exec.signal);
    } catch {
    }
    return decision;
  });
  ctx.on("tools/post-execute", async (exec, _result, next) => {
    const decision = await next();
    if (exec.name !== "exit_plan_mode") return decision;
    const note = takePlanNote(String(exec.callId));
    if (note === void 0 || decision.kind !== "accept" && decision.kind !== "block") return decision;
    return { ...decision, additionalContexts: [...decision.additionalContexts ?? [], note] };
  });
  ctx.commands.register({
    name: "verifier",
    description: "Turn verifier mode on or off for this session, or arm it for one turn",
    input: { hint: "on|off|status|once" },
    handler: ({ agent, rawInput }) => {
      const state = ctx.sessionProjections.stateOf(agent.session, "verifier");
      const mode = parseMode(rawInput);
      if (mode === "invalid") {
        return { kind: "error", text: `unknown /verifier argument "${rawInput.trim()}" (expected on, off, status, or once)` };
      }
      if (mode === "status") {
        const bits = [
          state?.active ? "Verifier mode is on." : "Verifier mode is off.",
          state?.onceArmed ? "Armed for the next turn." : "",
          state?.paused ? "Paused at the cost cap." : ""
        ].filter((bit) => bit !== "");
        return { kind: "success", text: bits.join(" ") };
      }
      if (mode === "once") {
        return { kind: "success", text: "Verifier will run for the next turn." };
      }
      const active = mode === "on";
      const event = agent.session.append("user/message", verifierModeNotice(active), { surfaceOp: "append" });
      return {
        kind: "success",
        text: active ? "Verifier mode on." : "Verifier mode off.",
        sourceEventSeq: event.seq
      };
    }
  });
}
export {
  Config,
  DEFAULT_PRICING,
  FLASH_ROUTE,
  PRO_ROUTE,
  apply,
  costClock,
  createVerifierProjection,
  currentRouteFromEvents,
  inject,
  isPeak,
  name,
  priceJev,
  priceUsage,
  readCurrentRoute,
  readJudgeDigest,
  readLedger,
  readVerifierTraces,
  resolveCap,
  resolveConfig,
  routeKey,
  sessionSpendCny,
  summarizeSession,
  verifierModeNotice,
  verifierNotice
};

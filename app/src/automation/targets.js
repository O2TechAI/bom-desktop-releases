"use strict";

/* Targets: how a step names the thing it acts on.
 *
 * Steps never carry selectors. They name a target ("search.input",
 * "product.addToCart"), and each site's profile says how to find it on that
 * site's DOM. A target lists strategies in order, the most specific first;
 * the first one that finds something wins:
 *
 *   { any: [
 *       { css: "#qty-input" },                        // this site's markup
 *       { label: /^quantity/i },                      // what a person reads
 *       { role: "spinbutton" },
 *     ],
 *     within: { any: [{ css: ".product-details" }] }, // optional scope
 *     hasText: "In stock",                            // optional filter
 *     nth: 0,
 *     hidden: true }                                  // counts when not shown
 *
 * `hidden` is for telling pages apart only (a page's own script or form
 * field): such a target is "on the page" without being seen. Steps still need
 * a visible element to act on.
 *
 * Strategies: css (pierces open shadow roots), role + name, label, text,
 * placeholder, testId, attr + value. Names and texts are compared after
 * collapsing whitespace, case-insensitively; a RegExp matches anywhere.
 * Strings may use {{param}} from the task ("{{part}}", "{{quantity}}");
 * {{param|url}} encodes the value for an address. */

const STRATEGY_KEYS = ["css", "testId", "role", "label", "placeholder", "text", "attr"];
const MATCH_KEYS = ["name", "label", "placeholder", "text", "value", "hasText"];


function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


/* {{name}} takes a task value; {{name|url}} encodes it for an address. */
function fill(template, params, { regex = false } = {}) {
  return String(template).replace(/\{\{\s*(\w+)\s*(?:\|\s*(url)\s*)?\}\}/g, (_match, key, filter) => {
    if (!Object.hasOwn(params, key)) throw new Error(`The task has no value for {{${key}}}`);
    const value = filter === "url" ? encodeURIComponent(String(params[key])) : String(params[key]);
    return regex ? escapeRegExp(value) : value;
  });
}


/* A RegExp cannot cross into the page; send its source and flags. */
function matchValue(value, params) {
  if (value instanceof RegExp) return { regex: fill(value.source, params, { regex: true }), flags: value.flags.replace("g", "") };
  if (value && typeof value === "object" && "regex" in value) return { regex: fill(value.regex, params, { regex: true }), flags: value.flags || "" };
  if (value == null) return value;
  return fill(value, params);
}


function normalizeStrategy(part, params) {
  if (!part || typeof part !== "object") throw new Error("A target strategy must be an object");
  const kinds = STRATEGY_KEYS.filter((key) => key in part);
  if (kinds.length !== 1) throw new Error(`A target strategy needs exactly one of ${STRATEGY_KEYS.join(", ")}`);
  const out = {};
  for (const [key, value] of Object.entries(part)) {
    if (key === "css" || key === "testId" || key === "role" || key === "attr") out[key] = fill(value, params);
    else if (MATCH_KEYS.includes(key)) out[key] = matchValue(value, params);
    else throw new Error(`Unknown target strategy key "${key}"`);
  }
  return out;
}


/** A target as the page runtime reads it: plain JSON, templates filled in. */
function normalizeTarget(target, params = {}) {
  if (!target || !Array.isArray(target.any) || !target.any.length) {
    throw new Error("A target needs a non-empty `any` list");
  }
  const out = { any: target.any.map((part) => normalizeStrategy(part, params)) };
  if (target.within) out.within = normalizeTarget(target.within, params);
  if (target.hasText != null) out.hasText = matchValue(target.hasText, params);
  if (target.nth != null) out.nth = Number(target.nth);
  if (target.hidden) out.hidden = true;
  return out;
}


module.exports = { escapeRegExp, fill, normalizeTarget };

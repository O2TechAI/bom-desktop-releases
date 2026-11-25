"use strict";

/* The part of the browser automation that runs inside a supplier's page.
 *
 * The driver (driver.js) evaluates `installSource` in an isolated world: the
 * page's own scripts share the DOM with it but cannot see or change these
 * functions, and it cannot be fooled by a page that redefines DOM methods.
 * It finds elements, reports where they are and whether they can be used,
 * and draws the visible pointer and highlight. It never clicks or types:
 * those go through the browser's input pipeline (Input.* over the DevTools
 * protocol), so the page sees the same events a person makes. */


/* eslint-disable no-undef -- this function runs in the page, not in Node. */
function install(theme) {
  if (globalThis.__o2a) return globalThis.__o2a.version;

  const handles = new Map();
  let nextHandle = 1;

  // ---- reading the page --------------------------------------------------

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function matcher(spec) {
    if (spec == null) return () => true;
    if (typeof spec === "object" && "regex" in spec) {
      const pattern = new RegExp(spec.regex, spec.flags || "");
      return (value) => pattern.test(normalize(value));
    }
    const wanted = normalize(spec).toLowerCase();
    return (value) => normalize(value).toLowerCase() === wanted;
  }

  /* For hasText: a pattern, or words that appear anywhere in the text. */
  function containing(spec) {
    if (typeof spec === "object" && "regex" in spec) return matcher(spec);
    const wanted = normalize(spec).toLowerCase();
    return (value) => normalize(value).toLowerCase().includes(wanted);
  }

  /* Every element under root, through open shadow roots, in document order. */
  function* walk(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (node.nodeType === 1) yield node;
      if (node.shadowRoot) stack.push(node.shadowRoot);
      const children = node.children || [];
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    }
  }

  function querySelectorAllDeep(root, selector) {
    const found = [];
    for (const element of walk(root)) {
      try {
        if (element.matches(selector)) found.push(element);
      } catch {
        return [];
      }
    }
    return found;
  }

  function implicitRole(element) {
    const tag = element.localName;
    const type = (element.getAttribute("type") || "").toLowerCase();
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "select") return element.multiple || element.size > 1 ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "number") return "spinbutton";
      if (type === "range") return "slider";
      if (type === "search") return element.hasAttribute("list") ? "combobox" : "searchbox";
      if (["", "text", "email", "tel", "url", "password"].includes(type)) {
        return element.hasAttribute("list") ? "combobox" : "textbox";
      }
      return null;
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return "img";
    if (tag === "table") return "table";
    if (tag === "tr") return "row";
    if (tag === "td") return "cell";
    if (tag === "th") return "columnheader";
    if (tag === "li") return "listitem";
    if (tag === "ul" || tag === "ol") return "list";
    if (tag === "dialog") return "dialog";
    if (tag === "nav") return "navigation";
    if (tag === "form") return "form";
    return null;
  }

  function roleOf(element) {
    const explicit = (element.getAttribute("role") || "").trim().split(/\s+/)[0];
    return explicit || implicitRole(element);
  }

  function textOf(element) {
    return normalize(element.innerText ?? element.textContent);
  }

  function labelsOf(element) {
    const names = [];
    if (element.labels) for (const label of element.labels) names.push(textOf(label));
    return names.filter(Boolean);
  }

  /* A close enough accessible name: aria-labelledby, aria-label, <label>,
   * alt, then the text inside, then title and placeholder. */
  function nameOf(element) {
    const root = element.getRootNode();
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/)
        .map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id)))
        .filter(Boolean)
        .map(textOf)
        .join(" ");
      if (normalize(text)) return normalize(text);
    }
    const label = element.getAttribute("aria-label");
    if (normalize(label)) return normalize(label);
    const labels = labelsOf(element);
    if (labels.length) return labels.join(" ");
    if (element.localName === "img" || (element.localName === "input" && element.type === "image")) {
      if (element.getAttribute("alt")) return normalize(element.getAttribute("alt"));
    }
    if (element.localName === "input" && ["button", "submit", "reset"].includes(element.type)) {
      return normalize(element.value);
    }
    if (!["input", "textarea", "select"].includes(element.localName)) {
      const text = textOf(element);
      if (text) return text;
      const image = element.querySelector("img[alt]");
      if (image) return normalize(image.getAttribute("alt"));
    }
    return normalize(element.getAttribute("title") || element.getAttribute("placeholder") || "");
  }

  function insideFrame(element) {
    if (element.localName !== "iframe") return element;
    try { return element.contentDocument || element; } catch { return element; }
  }

  function isVisible(element) {
    if (!element.isConnected) return false;
    if (typeof element.checkVisibility === "function" &&
        !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isDisabled(element) {
    if (element.disabled) return true;
    if (element.getAttribute("aria-disabled") === "true") return true;
    return Boolean(element.closest("fieldset[disabled]"));
  }

  const INTERACTIVE = "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=searchbox],[role=textbox],[role=spinbutton],[contenteditable=''],[contenteditable=true],[tabindex]";

  function byText(root, test) {
    const found = [];
    for (const element of walk(root)) {
      if (["script", "style", "noscript", "template"].includes(element.localName)) continue;
      if (!test(textOf(element))) continue;
      // The innermost element carrying the text, then what a person would click.
      let hasMatchingChild = false;
      for (const child of element.children) {
        if (test(textOf(child))) { hasMatchingChild = true; break; }
      }
      if (hasMatchingChild) continue;
      found.push(element.closest(INTERACTIVE) || element);
    }
    return found;
  }

  function byLabel(root, test) {
    const found = [];
    for (const element of walk(root)) {
      if (!["input", "select", "textarea"].includes(element.localName) &&
          !["textbox", "combobox", "searchbox", "spinbutton", "checkbox", "radio"].includes(element.getAttribute("role"))) continue;
      const candidates = [...labelsOf(element), element.getAttribute("aria-label")];
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) candidates.push(nameOf(element));
      if (candidates.some((value) => value && test(value))) found.push(element);
    }
    return found;
  }

  function strategy(root, part) {
    // ":scope" is the row itself, for a field that reads the row (a link row).
    if (part.css === ":scope") return root.nodeType === 1 ? [root] : [];
    if (part.css) return querySelectorAllDeep(root, part.css);
    if (part.testId) {
      const id = CSS.escape(part.testId);
      return querySelectorAllDeep(root, `[data-testid="${id}"],[data-test-id="${id}"],[data-test="${id}"],[data-qa="${id}"]`);
    }
    if (part.role) {
      const test = matcher(part.name);
      return [...walk(root)].filter((element) => roleOf(element) === part.role && (part.name == null || test(nameOf(element))));
    }
    if (part.label) return byLabel(root, matcher(part.label));
    if (part.placeholder) {
      const test = matcher(part.placeholder);
      return [...walk(root)].filter((element) => element.hasAttribute("placeholder") && test(element.getAttribute("placeholder")));
    }
    if (part.text) return byText(root, matcher(part.text));
    if (part.attr) {
      const test = matcher(part.value);
      return [...walk(root)].filter((element) => element.hasAttribute(part.attr) && test(element.getAttribute(part.attr)));
    }
    return [];
  }

  function unique(elements) {
    return [...new Set(elements)];
  }

  /* Every element a target spec matches, in the order its strategies are
   * listed: the first strategy that finds something wins. */
  function candidates(spec, root = document) {
    // A same-origin iframe found by `within` is searched inside (2026-11-24:
    // Mouser's Packaging Choice is a page in a dialog's iframe).
    const roots = spec.within ? candidates(spec.within, root).filter(isVisible).map(insideFrame) : [root];
    // The first strategy that finds something visible; else the first that
    // finds anything (2026-11-24: Mouser's hidden "See Shipping Options" was
    // taken over the Continue under it).
    let hidden = null;
    for (const part of spec.any) {
      let found = [];
      for (const scope of roots) found.push(...strategy(scope, part));
      found = unique(found);
      if (spec.hasText != null) {
        const test = containing(spec.hasText);
        found = found.filter((element) => test(textOf(element)));
      }
      if (!found.length) continue;
      if (spec.hidden || found.some(isVisible)) return found;
      hidden ||= found;
    }
    return hidden || [];
  }

  function remember(element) {
    for (const [id, known] of handles) if (known === element) return id;
    const id = nextHandle++;
    handles.set(id, element);
    return id;
  }

  function rectOf(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function describe(element) {
    const id = element.id ? `#${element.id}` : "";
    const classes = typeof element.className === "string" && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    return `${element.localName}${id}${classes}`;
  }

  /* Find a target. `state` is what the caller waits for: "visible" (default),
   * "attached", or "hidden". */
  function find(spec, state = "visible") {
    let found = candidates(spec);
    const attached = found.length;
    if (state !== "attached") found = found.filter(isVisible);
    if (state === "hidden") return { status: found.length ? "visible" : "hidden" };
    const element = found[spec.nth ?? 0];
    if (!element) return { status: attached ? "hidden" : "missing" };
    return {
      status: "found",
      handle: remember(element),
      count: found.length,
      element: describe(element),
      disabled: isDisabled(element),
      rect: rectOf(element),
    };
  }

  function element(handle) {
    const found = handles.get(handle);
    if (!found || !found.isConnected) throw new Error("detached");
    return found;
  }

  /* Bring the element to the middle of the window and say where it is. */
  function reveal(handle, toCentre = false) {
    const target = element(handle);
    const rect = target.getBoundingClientRect();
    const fits = rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth;
    if (!fits || toCentre) target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    return rectOf(target);
  }

  function deepElementFromPoint(x, y) {
    let found = document.elementFromPoint(x, y);
    while (found?.shadowRoot) {
      const inner = found.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === found) break;
      found = inner;
    }
    return found;
  }

  function composedContains(outer, inner) {
    for (let node = inner; node; node = node.parentNode || node.host) {
      if (node === outer) return true;
    }
    return false;
  }

  /* What a click at (x, y) would land on: the target, or whatever covers it. */
  function hit(handle, x, y) {
    const target = element(handle);
    host?.style.setProperty("display", "none");
    const top = deepElementFromPoint(x, y);
    host?.style.removeProperty("display");
    if (!top) return { ok: false, cover: "nothing" };
    // A click on the target, inside it, or on the <label> wrapping it reaches it.
    if (composedContains(target, top) || (top.localName === "label" && composedContains(top, target))) return { ok: true };
    return { ok: false, cover: describe(top) };
  }

  function info(handle) {
    const target = element(handle);
    return {
      tag: target.localName,
      type: target.type || null,
      visible: isVisible(target),
      disabled: isDisabled(target),
      editable: target.isContentEditable || (["input", "textarea"].includes(target.localName) && !target.readOnly),
      checked: "checked" in target ? Boolean(target.checked) : target.getAttribute("aria-checked") === "true",
      rect: rectOf(target),
    };
  }

  function focusAndSelect(handle) {
    const target = element(handle);
    target.focus({ preventScroll: true });
    if (typeof target.select === "function") target.select();
    else if (target.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return document.activeElement === target || composedContains(target, document.activeElement);
  }

  function valueOf(handle) {
    const target = element(handle);
    if ("value" in target && target.localName !== "button") return String(target.value ?? "");
    return textOf(target);
  }

  /* Set a value the way a framework notices it: through the prototype's
   * setter, then input and change events. For fields that ignore typing. */
  function setValue(handle, value) {
    const target = element(handle);
    const prototype = Object.getPrototypeOf(target);
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(target, value);
    else target.value = value;
    target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return valueOf(handle);
  }

  function selectOption(handle, wanted) {
    const target = element(handle);
    if (target.localName !== "select") throw new Error("not a select");
    const test = matcher(wanted);
    const option = [...target.options].find((entry) => test(entry.label) || test(entry.value));
    if (!option) return { ok: false, options: [...target.options].map((entry) => normalize(entry.label)) };
    setValue(handle, option.value);
    return { ok: true, label: normalize(option.label) };
  }

  function read(handle, what = "text") {
    const target = element(handle);
    if (what === "text") return textOf(target);
    if (what === "value") return valueOf(handle);
    if (what === "html") return target.outerHTML.slice(0, 20000);
    if (what === "href" && target.href) return String(target.href);
    return target.getAttribute(what);
  }

  /* Which of these targets are on the page and visible: one answer each, so
   * a state machine can recognise the page in one round trip. */
  function present(specs) {
    return specs.map((spec) => {
      if (!spec) return false;
      try {
        return candidates(spec).some(spec.hidden ? (element) => element.isConnected : isVisible);
      } catch {
        return false;
      }
    });
  }

  /* Rows of a list or table: one object per row, each field a target spec
   * looked up inside that row. */
  function extract(rowSpec, fields) {
    return candidates(rowSpec).filter(isVisible).map((row) => {
      const record = {};
      for (const [name, field] of Object.entries(fields)) {
        const match = candidates(field.target, row).find(isVisible);
        if (!match) { record[name] = null; continue; }
        const what = field.read || "text";
        record[name] = what === "text" ? textOf(match)
          : what === "value" ? String(match.value ?? textOf(match))
            : what === "href" ? (match.href ? String(match.href) : match.getAttribute("href"))
              : match.getAttribute(what);
      }
      return record;
    });
  }

  /* The operable parts of the page, for writing a site's target map. */
  function outline(limit = 400) {
    const rows = [];
    for (const element of walk(document)) {
      if (rows.length >= limit) break;
      if (!element.matches(INTERACTIVE) && !/^h[1-3]$/.test(element.localName)) continue;
      if (!isVisible(element)) continue;
      rows.push({
        role: roleOf(element),
        name: nameOf(element).slice(0, 120),
        element: describe(element),
        testId: element.getAttribute("data-testid") || undefined,
        placeholder: element.getAttribute("placeholder") || undefined,
        disabled: isDisabled(element) || undefined,
      });
    }
    return rows;
  }

  // ---- the visible pointer and highlight ---------------------------------

  let host = null;
  let parts = null;
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function overlay() {
    if (host?.isConnected) return parts;
    host = document.createElement("o2-automation-overlay");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;";
    const shadow = host.attachShadow({ mode: "closed" });
    const css = `
        :host { ${theme.variables} }
        .ring {
          position: fixed; left: 0; top: 0; width: 0; height: 0;
          border-radius: var(--radius-sm);
          background: var(--focus-ring-soft);
          box-shadow: 0 0 0 3px var(--focus-ring);
          opacity: 0;
          transition: opacity var(--duration-fast) var(--ease-out),
            transform var(--spring-glide-duration) var(--spring-glide),
            width var(--spring-glide-duration) var(--spring-glide),
            height var(--spring-glide-duration) var(--spring-glide);
        }
        .ring[data-on] { opacity: 1; }
        .pointer {
          position: fixed; left: 0; top: 0; width: 22px; height: 22px;
          opacity: 0;
          transform-origin: 3px 2px;
          transition: opacity var(--duration-fast) var(--ease-out);
        }
        .pointer[data-on] { opacity: 1; }
        .pointer svg { display: block; width: 100%; height: 100%; transition: transform var(--duration-press) var(--ease-out); transform-origin: 3px 2px; }
        .pointer[data-down] svg { transform: scale(.86); }
        .pulse {
          position: fixed; left: 0; top: 0; width: 28px; height: 28px; margin: -14px 0 0 -14px;
          border-radius: var(--radius-pill);
          background: var(--focus-ring);
          opacity: 0; transform: scale(.4);
        }
        .pulse[data-go] { animation: pulse var(--spring-pop-duration) var(--ease-out) 1; }
        @keyframes pulse { 0% { opacity: 1; transform: scale(.4); } 100% { opacity: 0; transform: scale(1.4); } }
        @media (prefers-reduced-motion: reduce) {
          .ring, .pointer, .pointer svg { transition: none; }
          .pulse[data-go] { animation: none; }
        }`;
    // A constructed sheet is not an inline <style>, so a strict page CSP
    // (style-src without 'unsafe-inline') still lets it apply.
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement("style");
      style.textContent = css;
      shadow.appendChild(style);
    }
    // Built with DOM calls, not innerHTML: some pages enforce Trusted Types.
    const div = (name) => {
      const node = document.createElement("div");
      node.className = name;
      return node;
    };
    const ring = div("ring");
    const pulse = div("pulse");
    const pointer = div("pointer");
    const SVG = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 22 22");
    const arrow = document.createElementNS(SVG, "path");
    arrow.setAttribute("d", "M3 2 L3 17 L7.2 13.2 L10 19.5 L12.8 18.3 L10.1 12.1 L15.6 12.1 Z");
    arrow.setAttribute("fill", "var(--primary)");
    arrow.setAttribute("stroke", "var(--primary-foreground)");
    arrow.setAttribute("stroke-width", "1.5");
    arrow.setAttribute("stroke-linejoin", "round");
    svg.appendChild(arrow);
    pointer.appendChild(svg);
    shadow.append(ring, pulse, pointer);
    (document.documentElement || document.body).appendChild(host);
    parts = {
      ring,
      pointer,
      pulse,
      x: innerWidth / 2,
      y: innerHeight / 2,
    };
    parts.pointer.style.transform = `translate(${parts.x}px, ${parts.y}px)`;
    return parts;
  }

  /* Glide the pointer to (x, y) over `ms`. The driver moves the real mouse
   * along the same path at the same time. Returns where it started. */
  function pointTo(x, y, ms) {
    const view = overlay();
    const from = { x: view.x, y: view.y };
    view.pointer.setAttribute("data-on", "");
    const duration = reduced() ? 0 : ms;
    view.pointer.style.transition = `opacity var(--duration-fast) var(--ease-out), transform ${duration}ms var(--spring-glide)`;
    view.pointer.style.transform = `translate(${x}px, ${y}px)`;
    view.x = x;
    view.y = y;
    return from;
  }

  function highlight(handle) {
    const view = overlay();
    if (handle == null) { view.ring.removeAttribute("data-on"); return null; }
    const rect = rectOf(element(handle));
    const pad = 4;
    view.ring.style.transform = `translate(${rect.x - pad}px, ${rect.y - pad}px)`;
    view.ring.style.width = `${rect.width + pad * 2}px`;
    view.ring.style.height = `${rect.height + pad * 2}px`;
    view.ring.setAttribute("data-on", "");
    return rect;
  }

  function press(down) {
    const view = overlay();
    if (down) {
      view.pointer.setAttribute("data-down", "");
      view.pulse.style.left = `${view.x + 3}px`;
      view.pulse.style.top = `${view.y + 2}px`;
      view.pulse.removeAttribute("data-go");
      void view.pulse.offsetWidth;
      view.pulse.setAttribute("data-go", "");
    } else {
      view.pointer.removeAttribute("data-down");
    }
  }

  function hide() {
    if (!parts) return;
    parts.ring.removeAttribute("data-on");
    parts.pointer.removeAttribute("data-on");
  }

  /* A last-resort activation: the page's own click. For a button a sticky
   * header covers, the protocol click would land on the header instead. */
  function activate(handle) {
    const target = element(handle);
    if (!target) return false;
    target.click();
    return true;
  }

  function readyState() {
    return { readyState: document.readyState, url: location.href, title: document.title };
  }

  const api = Object.freeze({
    version: 1,
    find, reveal, hit, info, focusAndSelect, valueOf, setValue, selectOption, read, extract, outline, present,
    pointTo, highlight, press, activate, hide, readyState, element,
  });
  Object.defineProperty(globalThis, "__o2a", { value: api });
  return api.version;
}
/* eslint-enable no-undef */


module.exports = { install, installSource: install.toString() };

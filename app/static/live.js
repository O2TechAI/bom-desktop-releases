/* Draw the frames Chrome sends and forward the person's input to it.
 *
 * Frames arrive as base64 JPEG; they are decoded with createImageBitmap
 * (a Blob, not an <img>, so the page's strict CSP needs no data: allowance). */

const canvas = document.querySelector("[data-screen]");
const stage = document.querySelector("[data-stage]");
const status = document.querySelector("[data-stage] [data-status]");
const context = canvas.getContext("2d", { alpha: false });

let page = { width: 1280, height: 900 };
let drawn = 0;
let decoding = false;
let pending = null;

function fit() {
  const box = stage.getBoundingClientRect();
  const scale = Math.min(box.width / page.width, box.height / page.height);
  canvas.style.width = `${Math.max(1, Math.floor(page.width * scale))}px`;
  canvas.style.height = `${Math.max(1, Math.floor(page.height * scale))}px`;
}

function point(event) {
  const box = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - box.left) / box.width,
    y: (event.clientY - box.top) / box.height,
  };
}

async function draw(frame) {
  const bytes = Uint8Array.from(atob(frame.data), (character) => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  if (frame.width && frame.height && (frame.width !== page.width || frame.height !== page.height)) {
    page = { width: frame.width, height: frame.height };
    canvas.width = page.width;
    canvas.height = page.height;
    fit();
  }
  context.drawImage(bitmap, 0, 0, page.width, page.height);
  bitmap.close();
  drawn += 1;
  if (drawn === 1) status.hidden = true;
}

function pump() {
  if (decoding || !pending) return;
  const frame = pending;
  pending = null;
  decoding = true;
  draw(frame)
    .catch(() => { /* a frame can be truncated during a navigation */ })
    .finally(() => {
      decoding = false;
      pump();
    });
}

window.liveBridge.onFrame((frame) => {
  if (!frame || !frame.data) return;
  pending = frame;
  pump();
});

let pendingMove = null;
canvas.addEventListener("pointermove", (event) => {
  const at = point(event);
  if (pendingMove) return;
  pendingMove = requestAnimationFrame(() => {
    pendingMove = null;
    void window.liveBridge.input({ kind: "move", ...at });
  });
});

canvas.addEventListener("pointerdown", (event) => {
  canvas.focus();
  const at = point(event);
  void window.liveBridge.input({ kind: "click", ...at, button: event.button });
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const at = point(event);
  void window.liveBridge.input({ kind: "wheel", ...at, deltaX: event.deltaX, deltaY: event.deltaY });
}, { passive: false });

canvas.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      void window.liveBridge.reload();
    }
    return;
  }
  if (event.altKey) return;
  event.preventDefault();
  if (event.key.length === 1) void window.liveBridge.input({ kind: "text", text: event.key });
  else void window.liveBridge.input({ kind: "key", key: event.key });
});

canvas.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text");
  if (!text) return;
  event.preventDefault();
  void window.liveBridge.input({ kind: "text", text });
});

window.addEventListener("resize", fit);
canvas.focus();
fit();


const back = document.querySelector("[data-back]");
const BACK = { en: "\u2190 Back to the list", zh: "\u2190 \u8fd4\u56de\u6e05\u5355", es: "\u2190 Volver a la lista" };
const language = new URLSearchParams(window.location.search).get("lang") || "en";
back.textContent = BACK[language] || BACK.en;
back.addEventListener("click", () => { void window.liveBridge.back(); });
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") void window.liveBridge.back();
});


/* The tab bar: one tab per supplier (DigiKey, LCSC), each its own Chrome, so
 * their pages never cover each other; a supplier waiting for the person is
 * marked. After them, the shown supplier's own tabs when it has more than one
 * (its main page, and e.g. a sign-in with Google), which can be closed. */
const tabsBar = document.querySelector("[data-tabs]");
const MAIN = { en: "Page", zh: "主页面", es: "Página" };
const CLOSE = { en: "Close tab", zh: "关闭标签页", es: "Cerrar pestaña" };
const WAITING = { en: "waiting for you", zh: "等你操作", es: "esperándote" };

let flow = null; // { sites, flows, active, view }
let pageTabs = null; // { viewing, tabs }

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function tabButton({ label, current, onPick, onClose, kind, attention }) {
  const item = document.createElement("div");
  item.className = `tab tab-${kind}`;
  item.setAttribute("role", "tab");
  item.tabIndex = 0;
  item.setAttribute("aria-selected", String(current));
  item.setAttribute("aria-current", String(current));
  if (attention) {
    const dot = document.createElement("span");
    dot.className = "tab-dot";
    dot.title = WAITING[language] || WAITING.en;
    item.append(dot);
  }
  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = label;
  item.append(title);
  if (onClose) {
    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", CLOSE[language] || CLOSE.en);
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose();
    });
    item.append(close);
  }
  const pick = () => { onPick(); canvas.focus(); };
  item.addEventListener("click", pick);
  item.addEventListener("keydown", (event) => { if (event.key === "Enter") pick(); });
  return item;
}

function renderTabs() {
  const items = [];
  const sites = Array.isArray(flow?.sites) ? flow.sites : [];
  for (const site of sites) {
    const state = flow.flows?.[site.id];
    items.push(tabButton({
      kind: "supplier",
      label: site.name,
      current: site.id === flow.active,
      attention: Boolean(state && (state.status === "waiting" || state.confirm)),
      onPick: () => { void window.buyLab.showLive(site.id); },
    }));
  }
  const tabs = Array.isArray(pageTabs?.tabs) ? pageTabs.tabs : [];
  if (tabs.length > 1) {
    const divider = document.createElement("span");
    divider.className = "tab-divider";
    items.push(divider);
    for (const tab of tabs) {
      items.push(tabButton({
        kind: "page",
        label: tab.main ? `${MAIN[language] || MAIN.en} · ${tab.title || hostOf(tab.url)}` : (tab.title || hostOf(tab.url) || "…"),
        current: tab.id === pageTabs.viewing,
        onPick: () => { void window.liveBridge.selectTab(tab.id); },
        onClose: tab.main ? null : () => { void window.liveBridge.closeTab(tab.id); },
      }));
    }
  }
  tabsBar.hidden = items.length < 2;
  tabsBar.replaceChildren(...items);
}

tabsBar.hidden = true;
tabsBar.setAttribute("role", "tablist");
window.liveBridge.onTabs?.((state) => { pageTabs = state; renderTabs(); });
window.buyLab?.onFlow?.((state) => { flow = state; renderTabs(); });
window.buyLab?.state?.().then((state) => { flow = state; renderTabs(); }).catch(() => {});

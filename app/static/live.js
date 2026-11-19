/* Draw the frames Chrome sends and forward the person's input to it.
 *
 * Frames arrive as base64 JPEG; they are decoded with createImageBitmap
 * (a Blob, not an <img>, so the page's strict CSP needs no data: allowance). */

const canvas = document.querySelector("[data-screen]");
const stage = document.querySelector("[data-stage]");
const status = document.querySelector("[data-status]");
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

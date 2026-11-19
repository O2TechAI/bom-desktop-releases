/* Copy and behaviour of the app's own pages. The main process passes the
 * language (the computer's), and the page fills every [data-copy] element. */

const COPY = {
  en: {
    offline_title: "Can't reach BOM",
    offline_body: "Check your internet connection. BOM opens again as soon as you're back online.",
    try_again: "Try again",
    signin_title: "Continue in your browser",
    signin_body: "Sign in with {provider} in the browser window that just opened. BOM opens here when you're done.",
    open_again: "Open the browser again",
    back_to_sign_in: "Back to sign-in",
  },
  zh: {
    offline_title: "无法连接 BOM",
    offline_body: "请检查网络连接。恢复联网后会自动重新打开 BOM。",
    try_again: "重试",
    signin_title: "请在浏览器中继续",
    signin_body: "请在刚打开的浏览器窗口中用 {provider} 登录，完成后这里会自动打开 BOM。",
    open_again: "重新打开浏览器",
    back_to_sign_in: "返回登录",
  },
  es: {
    offline_title: "No se puede conectar con BOM",
    offline_body: "Comprueba tu conexión a internet. BOM se abrirá de nuevo en cuanto vuelvas a estar en línea.",
    try_again: "Reintentar",
    signin_title: "Continúa en el navegador",
    signin_body: "Inicia sesión con {provider} en la ventana del navegador que se acaba de abrir. BOM se abrirá aquí cuando termines.",
    open_again: "Abrir el navegador de nuevo",
    back_to_sign_in: "Volver al inicio de sesión",
  },
};
const PROVIDERS = { google: "Google", microsoft: "Microsoft" };
const LOCALES = { en: "en", zh: "zh-CN", es: "es" };

const params = new URLSearchParams(window.location.search);
const language = Object.hasOwn(COPY, params.get("lang")) ? params.get("lang") : "en";
const provider = Object.hasOwn(PROVIDERS, params.get("provider")) ? params.get("provider") : "google";
document.documentElement.lang = LOCALES[language];

for (const element of document.querySelectorAll("[data-copy]")) {
  const text = COPY[language][element.dataset.copy] ?? COPY.en[element.dataset.copy];
  element.textContent = text.replace("{provider}", PROVIDERS[provider]);
}
document.title = document.querySelector("h1").textContent;


function siteUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}


if (document.body.dataset.page === "offline") {
  const retry = siteUrl(params.get("retry"));
  const button = document.querySelector("[data-action=retry]");
  // The window's navigation policy still decides whether this address may open.
  const reopen = () => { if (retry) window.location.replace(retry); };
  button.addEventListener("click", reopen);
  window.addEventListener("online", reopen);
}

if (document.body.dataset.page === "signin") {
  const again = new URL(window.location.href);
  again.searchParams.set("restart", "1");
  document.querySelector("[data-action=again]").href = again.toString();
  const home = siteUrl(params.get("home"));
  const back = document.querySelector("[data-action=back]");
  if (home) back.href = home;
  else back.hidden = true;
}

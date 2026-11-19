"use strict";

/* Copy the app shows outside the BOM site: menus and dialogs. The site's own
 * pages follow the account language; these follow the computer's. English is
 * the source; zh and es say the same thing. */

const MESSAGES = {
  en: {
    open_in_browser: "Open BOM in browser",
    link_title: "Add sign-in methods on the web",
    link_body: "To add Google or Microsoft sign-in to your account, use BOM in your browser.",
    ok: "OK",
    sign_in_failed: "Sign-in didn't finish. Try again.",
    supplier_browser_missing: "Supplier windows open in your own Google Chrome or Microsoft Edge. Install one of them, then try again.",
    buy_lab: "Buy lab",
    suppliers: "Suppliers",
    update_available_title: "O2 BOM {version} is available",
    update_available_body: "Download the new installer, then open it and drag O2 BOM to Applications to replace this version.",
    update_download: "Download",
    update_ready_title: "O2 BOM {version} is ready",
    update_ready_body: "It installs the next time O2 BOM quits. Restart now to use it.",
    update_restart: "Restart now",
    update_later: "Later",
  },
  zh: {
    open_in_browser: "在浏览器中打开 BOM",
    link_title: "请在网页版添加登录方式",
    link_body: "要给账号添加 Google 或 Microsoft 登录，请在浏览器中使用 BOM。",
    ok: "好",
    sign_in_failed: "登录没有完成，请重试。",
    supplier_browser_missing: "供应商窗口使用本机的 Google Chrome 或 Microsoft Edge 打开。请先安装其中一个，再重试。",
    buy_lab: "采购实验室",
    suppliers: "供应商",
    update_available_title: "O2 BOM {version} 已发布",
    update_available_body: "下载新的安装包，打开后把 O2 BOM 拖进“应用程序”，替换当前版本。",
    update_download: "下载",
    update_ready_title: "O2 BOM {version} 已准备好",
    update_ready_body: "下次退出 O2 BOM 时会自动安装。现在重启即可使用新版本。",
    update_restart: "现在重启",
    update_later: "以后再说",
  },
  es: {
    open_in_browser: "Abrir BOM en el navegador",
    link_title: "Añade métodos de inicio de sesión en la web",
    link_body: "Para añadir el inicio de sesión con Google o Microsoft a tu cuenta, usa BOM en el navegador.",
    ok: "Aceptar",
    sign_in_failed: "No se completó el inicio de sesión. Inténtalo de nuevo.",
    supplier_browser_missing: "Las ventanas de proveedor se abren en tu propio Google Chrome o Microsoft Edge. Instala uno y vuelve a intentarlo.",
    buy_lab: "Laboratorio de compras",
    suppliers: "Proveedores",
    update_available_title: "O2 BOM {version} está disponible",
    update_available_body: "Descarga el nuevo instalador, ábrelo y arrastra O2 BOM a Aplicaciones para reemplazar esta versión.",
    update_download: "Descargar",
    update_ready_title: "O2 BOM {version} está listo",
    update_ready_body: "Se instala la próxima vez que cierres O2 BOM. Reinicia ahora para usarlo.",
    update_restart: "Reiniciar ahora",
    update_later: "Más tarde",
  },
};


function languageFor(locale) {
  const tag = String(locale || "").toLowerCase();
  if (tag.startsWith("zh")) return "zh";
  if (tag.startsWith("es")) return "es";
  return "en";
}


function translator(locale) {
  const language = languageFor(locale);
  return (key) => MESSAGES[language][key] ?? MESSAGES.en[key] ?? key;
}


module.exports = { MESSAGES, languageFor, translator };

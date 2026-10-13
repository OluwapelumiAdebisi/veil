(function () {
  function ignore(ev) {
    var msg = String((ev && ev.message) || (ev && ev.reason && (ev.reason.message || ev.reason)) || "");
    var src = String((ev && ev.filename) || (ev && ev.reason && ev.reason.stack) || "");
    if (
      msg.indexOf("Cannot redefine property: ethereum") !== -1 ||
      src.indexOf("evmAsk.js") !== -1 ||
      src.indexOf("chrome-extension://") !== -1
    ) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }
  window.addEventListener("error", ignore, true);
  window.addEventListener("unhandledrejection", ignore, true);
})();

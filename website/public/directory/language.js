// Also shipped as a classic script on generated pages without an application bundle.
(() => {
  const select = document.querySelector(".directory-footer select");
  if (!select) return;
  // Let the connector change its language in place, keeping its pending authorization request.
  if (document.querySelector("template[data-connect-directory]")) {
    const sync = () => {
      const language = document.documentElement.lang;
      const template = document.querySelector('template[data-connect-directory="' + language + '"]');
      if (!template) return;
      const footer = template.content.firstElementChild.cloneNode(true);
      const picker = footer.querySelector("select");
      picker.disabled = false;
      picker.onchange = () => document.querySelector('[data-lang="' + picker.value + '"]').click();
      document.querySelector(".directory-footer").replaceWith(footer);
    };
    sync();
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return;
  }
  select.disabled = false;
  select.onchange = () => {
    const option = select.selectedOptions[0];
    if (!option?.dataset.href) return;
    const target = new URL(option.dataset.href, document.baseURI);
    if (!target.hash && document.getElementById(location.hash.slice(1))) target.hash = location.hash;
    try { localStorage.setItem("ai-fighter.creator.locale.v1", option.value); } catch { /* URL selects the page. */ }
    location.assign(target);
  };
  window.addEventListener("pageshow", () => { select.selectedIndex = Array.from(select.options).findIndex(option => option.defaultSelected); });
})();

const button = document.querySelector("[data-copy]");
const command = document.querySelector("#command");
const status = document.querySelector("#copy-status");
if (button && command && status) {
  const label = button.textContent;
  let reset;
  button.hidden = false;
  button.addEventListener("click", async () => {
    clearTimeout(reset);
    try {
      await navigator.clipboard.writeText(command.textContent);
      button.textContent = status.textContent = button.dataset.copied;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(command);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.className = "copy-help";
      status.textContent = button.dataset.fallback;
    }
    reset = setTimeout(() => {
      button.textContent = label;
      status.textContent = "";
      status.className = "sr-only";
    }, 3500);
  });
}

/**
 * Show/hide password toggles for CreatorRadar forms.
 * Auto-enhances existing type=password inputs; call enhancePasswordFields(root)
 * after dynamically inserting fields (e.g. account change-password modal).
 */
(function initPasswordToggle(global) {
  const EYE_SHOW =
    '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 5c-5.4 0-9.8 3.5-11.5 7 1.7 3.5 6.1 7 11.5 7s9.8-3.5 11.5-7C21.8 8.5 17.4 5 12 5Zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9Zm0-7.2a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4Z"/></svg>';
  const EYE_HIDE =
    '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3.3 2.2 2.2 3.3l3.1 3.1C3.4 8 1.9 9.9 1 12c1.7 3.5 6.1 7 11.5 7 2.1 0 4.1-.5 5.8-1.3l2.9 2.9 1.1-1.1L3.3 2.2Zm8.7 14.3c-3.3 0-6.2-1.8-8-4.5.7-1.1 1.8-2.3 3.1-3.2l1.8 1.8a4.5 4.5 0 0 0 5.5 5.5l1.5 1.5c-1.2.6-2.5.9-3.9.9Zm10.5-4.5c-.5 1-1.3 2.1-2.3 3l-2.4-2.4a4.5 4.5 0 0 0-5.6-5.6L9.8 4.6C10.5 4.4 11.2 4.3 12 4.3c5.4 0 9.8 3.5 11.5 7-.3.7-.8 1.5-1.3 2.2Z"/></svg>';

  function setToggleState(input, btn, visible) {
    input.type = visible ? "text" : "password";
    btn.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    btn.setAttribute("aria-pressed", visible ? "true" : "false");
    btn.innerHTML = visible ? EYE_HIDE : EYE_SHOW;
  }

  function enhanceInput(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.passwordToggle === "1") return;
    if (input.closest(".password-field")) {
      input.dataset.passwordToggle = "1";
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "password-field";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "password-toggle";
    setToggleState(input, btn, false);
    btn.addEventListener("click", () => {
      const visible = input.type !== "text";
      setToggleState(input, btn, visible);
    });
    wrap.appendChild(btn);

    input.form?.addEventListener("reset", () => {
      setToggleState(input, btn, false);
    });

    input.dataset.passwordToggle = "1";
  }

  function enhancePasswordFields(root = document) {
    const scope = root && root.querySelectorAll ? root : document;
    if (scope instanceof HTMLInputElement) {
      if (scope.type === "password" || scope.dataset.passwordToggle === "1") {
        enhanceInput(scope);
      }
      return;
    }
    scope.querySelectorAll('input[type="password"]').forEach(enhanceInput);
  }

  global.enhancePasswordFields = enhancePasswordFields;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => enhancePasswordFields());
  } else {
    enhancePasswordFields();
  }
})(window);

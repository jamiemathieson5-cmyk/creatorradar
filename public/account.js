/**
 * Shared account menu for /admin and /app.
 * Expects markup with #account-wrap, #account-trigger, #account-panel,
 * #account-label, #account-avatar, #logout-btn, and #account-modal-root.
 */
(function initAccountMenu(global) {
  const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

  function el(id) {
    return document.getElementById(id);
  }

  function accountApi(path, options = {}) {
    return fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = new Error(data.error || `Request failed (${response.status})`);
        err.status = response.status;
        throw err;
      }
      return data;
    });
  }

  function escapeAttr(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function displayLabel(user, { isAdmin } = {}) {
    if (!user) return isAdmin ? "Admin" : "Account";
    const name = (user.displayName || "").trim() || user.username || "Account";
    if (isAdmin || user.role === "admin") {
      return `Admin · ${name}`;
    }
    return name.startsWith("@") ? name : `@${name}`;
  }

  function renderAccountChip(user, { isAdmin } = {}) {
    const label = el("account-label");
    const avatar = el("account-avatar");
    const trigger = el("account-trigger");
    if (label) label.textContent = displayLabel(user, { isAdmin });
    if (avatar) {
      if (user?.avatarUrl) {
        avatar.src = user.avatarUrl;
        avatar.hidden = false;
        avatar.classList.remove("hidden");
      } else {
        avatar.removeAttribute("src");
        avatar.hidden = true;
        avatar.classList.add("hidden");
      }
    }
    if (trigger) {
      trigger.setAttribute(
        "aria-label",
        `Account menu for ${displayLabel(user, { isAdmin })}`
      );
    }
  }

  function setMenuOpen(open) {
    const panel = el("account-panel");
    const trigger = el("account-trigger");
    if (!panel || !trigger) return;
    const next = Boolean(open);
    trigger.setAttribute("aria-expanded", next ? "true" : "false");
    if (next) {
      panel.classList.remove("hidden");
      panel.hidden = false;
    } else {
      panel.classList.add("hidden");
      panel.hidden = true;
    }
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  function closeModal() {
    const root = el("account-modal-root");
    if (!root) return;
    root.classList.add("hidden");
    root.innerHTML = "";
    root.hidden = true;
  }

  function openModal({ title, bodyHtml, onSubmit, submitLabel = "Save" }) {
    const root = el("account-modal-root");
    if (!root) return;
    root.hidden = false;
    root.classList.remove("hidden");
    root.innerHTML = `
      <div class="account-modal-backdrop" data-account-dismiss></div>
      <div class="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
        <button type="button" class="account-modal-close" data-account-dismiss aria-label="Close">&times;</button>
        <h2 id="account-modal-title">${title}</h2>
        <form id="account-modal-form" class="account-modal-form">
          ${bodyHtml}
          <p class="account-modal-error hidden" id="account-modal-error" role="alert"></p>
          <div class="account-modal-actions">
            <button type="button" class="btn btn-ghost" data-account-dismiss>Cancel</button>
            <button type="submit" class="btn btn-primary" id="account-modal-submit">${submitLabel}</button>
          </div>
        </form>
      </div>
    `;

    const form = el("account-modal-form");
    const errorEl = el("account-modal-error");
    const submitBtn = el("account-modal-submit");

    root.querySelectorAll("[data-account-dismiss]").forEach((node) => {
      node.addEventListener("click", () => closeModal());
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!onSubmit) return;
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.classList.add("hidden");
      }
      if (submitBtn) submitBtn.disabled = true;
      try {
        await onSubmit(form);
        closeModal();
      } catch (error) {
        if (errorEl) {
          errorEl.textContent = error.message || "Something went wrong.";
          errorEl.classList.remove("hidden");
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    const firstInput = form?.querySelector("input, textarea, select");
    if (firstInput) setTimeout(() => firstInput.focus(), 0);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("Choose an image file."));
        return;
      }
      if (!String(file.type || "").startsWith("image/")) {
        reject(new Error("File must be an image (JPEG, PNG, WebP, or GIF)."));
        return;
      }
      if (file.size > MAX_AVATAR_BYTES) {
        reject(new Error("Image must be 2MB or smaller."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read image file."));
      reader.readAsDataURL(file);
    });
  }

  function mountAccountMenu(options = {}) {
    const {
      isAdmin = false,
      showToast = () => {},
      onUserUpdated = () => {},
      initialUser = null,
    } = options;

    let currentUser = initialUser;

    function applyUser(user) {
      currentUser = user;
      renderAccountChip(user, { isAdmin });
      onUserUpdated(user);
    }

    if (initialUser) applyUser(initialUser);

    const wrap = el("account-wrap");
    const trigger = el("account-trigger");
    const panel = el("account-panel");
    const logoutBtn = el("logout-btn");

    trigger?.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = trigger.getAttribute("aria-expanded") === "true";
      setMenuOpen(!open);
    });

    panel?.querySelectorAll("[data-account-action]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = btn.getAttribute("data-account-action");
        closeMenu();
        if (action === "display-name") {
          openModal({
            title: "Change display name",
            submitLabel: "Save name",
            bodyHtml: `
              <label class="account-field">
                <span>Display name</span>
                <input
                  type="text"
                  name="displayName"
                  maxlength="60"
                  autocomplete="nickname"
                  value="${escapeAttr(currentUser?.displayName || "")}"
                  placeholder="How you appear in the header"
                />
              </label>
              <p class="account-hint">Leave blank to show your username (@${escapeAttr(currentUser?.username || "you")}).</p>
            `,
            onSubmit: async (form) => {
              const displayName = form.displayName.value;
              const data = await accountApi("/api/me", {
                method: "PATCH",
                body: JSON.stringify({ displayName }),
              });
              applyUser(data.user);
              showToast("Display name updated");
            },
          });
        } else if (action === "password") {
          openModal({
            title: "Change password",
            submitLabel: "Update password",
            bodyHtml: `
              <label class="account-field">
                <span>Current password</span>
                <input type="password" name="currentPassword" autocomplete="current-password" required />
              </label>
              <label class="account-field">
                <span>New password</span>
                <input type="password" name="newPassword" autocomplete="new-password" minlength="8" required />
              </label>
              <label class="account-field">
                <span>Confirm new password</span>
                <input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required />
              </label>
              <p class="account-hint">Minimum 8 characters. Other sessions will be signed out.</p>
            `,
            onSubmit: async (form) => {
              const currentPassword = form.currentPassword.value;
              const newPassword = form.newPassword.value;
              const confirmPassword = form.confirmPassword.value;
              if (newPassword !== confirmPassword) {
                throw new Error("New passwords do not match.");
              }
              const data = await accountApi("/api/account/password", {
                method: "POST",
                body: JSON.stringify({ currentPassword, newPassword }),
              });
              applyUser(data.user);
              showToast("Password updated");
            },
          });
        } else if (action === "avatar") {
          openModal({
            title: "Profile picture",
            submitLabel: "Upload",
            bodyHtml: `
              <div class="account-avatar-preview-wrap">
                <img
                  class="account-avatar-preview${currentUser?.avatarUrl ? "" : " hidden"}"
                  id="account-avatar-preview"
                  alt=""
                  ${currentUser?.avatarUrl ? `src="${escapeAttr(currentUser.avatarUrl)}"` : ""}
                />
                <span class="account-avatar-preview-fallback${currentUser?.avatarUrl ? " hidden" : ""}" id="account-avatar-fallback">?</span>
              </div>
              <label class="account-field">
                <span>Choose image</span>
                <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp,image/gif" required />
              </label>
              <p class="account-hint">JPEG, PNG, WebP, or GIF · max 2MB</p>
            `,
            onSubmit: async (form) => {
              const file = form.avatar.files?.[0];
              const dataUrl = await fileToDataUrl(file);
              const data = await accountApi("/api/account/avatar", {
                method: "POST",
                body: JSON.stringify({ dataUrl }),
              });
              applyUser(data.user);
              showToast("Profile picture updated");
            },
          });

          const fileInput = el("account-modal-form")?.querySelector('input[name="avatar"]');
          fileInput?.addEventListener("change", async () => {
            const preview = el("account-avatar-preview");
            const fallback = el("account-avatar-fallback");
            try {
              const dataUrl = await fileToDataUrl(fileInput.files?.[0]);
              if (preview) {
                preview.src = dataUrl;
                preview.classList.remove("hidden");
              }
              fallback?.classList.add("hidden");
            } catch {
              /* validated again on submit */
            }
          });
        }
      });
    });

    document.addEventListener("click", (event) => {
      if (!wrap || wrap.contains(event.target)) return;
      closeMenu();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeMenu();
      const root = el("account-modal-root");
      if (root && !root.classList.contains("hidden")) closeModal();
    });

    logoutBtn?.addEventListener("click", async (event) => {
      event.stopPropagation();
      closeMenu();
      try {
        await accountApi("/api/auth/logout", { method: "POST", body: "{}" });
      } catch {
        /* still leave */
      }
      global.location.href = "/?login=1";
    });

    return {
      setUser: applyUser,
      getUser: () => currentUser,
      render: () => renderAccountChip(currentUser, { isAdmin }),
    };
  }

  global.CreatorRadarAccount = {
    mountAccountMenu,
    renderAccountChip,
    displayLabel,
  };
})(typeof window !== "undefined" ? window : globalThis);

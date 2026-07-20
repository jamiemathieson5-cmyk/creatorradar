/**
 * Shared account menu for /admin and /app.
 * Expects markup with #account-wrap, #account-trigger, #account-panel,
 * #account-label, #account-avatar, #account-avatar-initials, #logout-btn,
 * and #account-modal-root.
 */
(function initAccountMenu(global) {
  /** Client target — stay under server limit with base64/JSON overhead headroom. */
  const TARGET_AVATAR_BYTES = Math.floor(1.8 * 1024 * 1024);
  /** Soft ceiling for originals we attempt to decode/compress in-browser. */
  const MAX_SOURCE_AVATAR_BYTES = 25 * 1024 * 1024;
  const AVATAR_EDGE_STEPS = [1024, 768, 512, 384];
  const AVATAR_QUALITY_STEPS = [0.92, 0.85, 0.75, 0.65, 0.55, 0.45];
  const ALLOWED_AVATAR_TYPES = /^(image\/(jpeg|jpg|png|webp|gif))$/i;

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

  /** 1–2 letter initials from display name or username. */
  function initialsFromUser(user) {
    const raw =
      (user?.displayName || "").trim() ||
      (user?.username || "").trim() ||
      "";
    const cleaned = raw.replace(/^@+/, "").trim();
    if (!cleaned) return "?";
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return cleaned.slice(0, 2).toUpperCase();
  }

  function showAvatarImage(avatar, initialsEl) {
    if (avatar) {
      avatar.hidden = false;
      avatar.classList.remove("hidden");
    }
    initialsEl?.classList.add("hidden");
  }

  function showAvatarInitials(avatar, initialsEl, user) {
    if (avatar) {
      avatar.removeAttribute("src");
      avatar.hidden = true;
      avatar.classList.add("hidden");
    }
    if (initialsEl) {
      initialsEl.textContent = initialsFromUser(user);
      initialsEl.classList.remove("hidden");
    }
  }

  function renderAccountChip(user, { isAdmin } = {}) {
    const label = el("account-label");
    const avatar = el("account-avatar");
    const initialsEl = el("account-avatar-initials");
    const trigger = el("account-trigger");
    if (label) label.textContent = displayLabel(user, { isAdmin });
    if (initialsEl) initialsEl.textContent = initialsFromUser(user);

    if (avatar && user?.avatarUrl) {
      const nextSrc = user.avatarUrl;
      avatar.onload = () => showAvatarImage(avatar, initialsEl);
      avatar.onerror = () => showAvatarInitials(avatar, initialsEl, user);
      // Always assign so cache-busted URLs refresh after upload without reload.
      if (avatar.getAttribute("src") !== nextSrc) {
        // Keep initials visible until the image loads.
        initialsEl?.classList.remove("hidden");
        avatar.hidden = true;
        avatar.classList.add("hidden");
        avatar.src = nextSrc;
      } else if (avatar.complete && avatar.naturalWidth > 0) {
        showAvatarImage(avatar, initialsEl);
      } else {
        initialsEl?.classList.remove("hidden");
      }
    } else {
      showAvatarInitials(avatar, initialsEl, user);
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
          <p class="account-modal-status hidden" id="account-modal-status" role="status" aria-live="polite"></p>
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
    const statusEl = el("account-modal-status");
    const submitBtn = el("account-modal-submit");

    if (typeof global.enhancePasswordFields === "function" && form) {
      global.enhancePasswordFields(form);
    }

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
      if (statusEl) {
        statusEl.textContent = "";
        statusEl.classList.add("hidden");
      }
      if (submitBtn) submitBtn.disabled = true;
      try {
        await onSubmit(form, {
          setStatus(message) {
            if (!statusEl) return;
            const text = String(message || "").trim();
            if (text) {
              statusEl.textContent = text;
              statusEl.classList.remove("hidden");
            } else {
              statusEl.textContent = "";
              statusEl.classList.add("hidden");
            }
          },
        });
        closeModal();
      } catch (error) {
        if (statusEl) {
          statusEl.textContent = "";
          statusEl.classList.add("hidden");
        }
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

  function assertAvatarImageFile(file) {
    if (!file) {
      throw new Error("Choose an image file.");
    }
    const type = String(file.type || "").toLowerCase();
    if (!ALLOWED_AVATAR_TYPES.test(type)) {
      throw new Error("File must be an image (JPEG, PNG, WebP, or GIF).");
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read image file."));
      reader.readAsDataURL(file);
    });
  }

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error("Could not load image. Try a different file."));
      img.src = src;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob || null), mime, quality);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () =>
        reject(new Error("Could not encode compressed image."));
      reader.readAsDataURL(blob);
    });
  }

  function preferredAvatarMimeTypes() {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const types = [];
    try {
      if (probe.toDataURL("image/webp").startsWith("data:image/webp")) {
        types.push("image/webp");
      }
    } catch {
      /* WebP export unsupported */
    }
    types.push("image/jpeg");
    return types;
  }

  /**
   * If the file is already under the target size, return it as-is.
   * Otherwise resize (max edge 512–1024) and re-encode JPEG/WebP,
   * stepping quality down until under TARGET_AVATAR_BYTES.
   */
  async function prepareAvatarDataUrl(file, { onStatus } = {}) {
    assertAvatarImageFile(file);

    if (file.size > MAX_SOURCE_AVATAR_BYTES) {
      throw new Error("Image is too large to process. Try a photo under 25MB.");
    }

    if (file.size <= TARGET_AVATAR_BYTES) {
      return readFileAsDataUrl(file);
    }

    onStatus?.("Compressing image…");
    const sourceUrl = await readFileAsDataUrl(file);
    const img = await loadImageElement(sourceUrl);
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) {
      throw new Error("Could not read image dimensions.");
    }

    const mimeTypes = preferredAvatarMimeTypes();

    for (const maxEdge of AVATAR_EDGE_STEPS) {
      const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
      const width = Math.max(1, Math.round(srcW * scale));
      const height = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) {
        throw new Error("Could not compress image in this browser.");
      }
      // Flatten transparency onto white for JPEG/WebP avatars.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      for (const mime of mimeTypes) {
        for (const quality of AVATAR_QUALITY_STEPS) {
          const blob = await canvasToBlob(canvas, mime, quality);
          if (!blob) continue;
          if (blob.size <= TARGET_AVATAR_BYTES) {
            onStatus?.("");
            return blobToDataUrl(blob);
          }
        }
      }
    }

    throw new Error(
      "Could not compress this image enough to upload. Try a smaller photo."
    );
  }

  /** Preview helper — accepts any allowed image, no size reject. */
  async function previewAvatarDataUrl(file) {
    assertAvatarImageFile(file);
    return readFileAsDataUrl(file);
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
                <span class="account-avatar-preview-fallback${currentUser?.avatarUrl ? " hidden" : ""}" id="account-avatar-fallback">${escapeAttr(initialsFromUser(currentUser))}</span>
              </div>
              <label class="account-field">
                <span>Choose image</span>
                <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp,image/gif" required />
              </label>
              <p class="account-hint">JPEG, PNG, WebP, or GIF · large images are compressed automatically</p>
            `,
            onSubmit: async (form, { setStatus } = {}) => {
              const file = form.avatar.files?.[0];
              const dataUrl = await prepareAvatarDataUrl(file, {
                onStatus: setStatus,
              });
              setStatus?.("Uploading…");
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
            const errorEl = el("account-modal-error");
            try {
              const dataUrl = await previewAvatarDataUrl(fileInput.files?.[0]);
              if (errorEl) {
                errorEl.textContent = "";
                errorEl.classList.add("hidden");
              }
              if (preview) {
                preview.src = dataUrl;
                preview.classList.remove("hidden");
              }
              fallback?.classList.add("hidden");
            } catch (error) {
              if (preview) {
                preview.removeAttribute("src");
                preview.classList.add("hidden");
              }
              fallback?.classList.remove("hidden");
              if (errorEl) {
                errorEl.textContent =
                  error.message || "File must be an image (JPEG, PNG, WebP, or GIF).";
                errorEl.classList.remove("hidden");
              }
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
      global.location.href = "/";
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
    initialsFromUser,
  };
})(typeof window !== "undefined" ? window : globalThis);

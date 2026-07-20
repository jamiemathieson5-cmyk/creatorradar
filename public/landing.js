const modalRoot = document.getElementById("modal-root");
const authForm = document.getElementById("auth-form");
const formError = document.getElementById("form-error");
const authSubmit = document.getElementById("auth-submit");
const fieldLogin = document.getElementById("field-login");
const fieldPassword = document.getElementById("field-password");

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function openModal() {
  modalRoot.classList.remove("hidden");
  modalRoot.hidden = false;
  formError.classList.add("hidden");
  formError.textContent = "";
  fieldLogin?.focus();
}

function closeModal() {
  modalRoot.classList.add("hidden");
  modalRoot.hidden = true;
  authForm.reset();
  formError.classList.add("hidden");
}

document.querySelectorAll("[data-open='login']").forEach((btn) => {
  btn.addEventListener("click", () => openModal());
});

document.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", closeModal);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalRoot.hidden) closeModal();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.classList.add("hidden");
  authSubmit.disabled = true;
  const prev = authSubmit.textContent;
  authSubmit.textContent = "Working…";

  try {
    const result = await api("/api/auth/login", {
      login: fieldLogin.value,
      password: fieldPassword.value,
    });
    window.location.href = result.user?.role === "admin" ? "/admin" : "/app";
  } catch (error) {
    formError.textContent = error.message || "Something went wrong.";
    formError.classList.remove("hidden");
    authSubmit.disabled = false;
    authSubmit.textContent = prev;
  }
});

async function boot() {
  try {
    const res = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (data.user) {
      window.location.href = data.user.role === "admin" ? "/admin" : "/app";
      return;
    }
  } catch {
    // stay on landing
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("login") === "1" || params.get("admin") === "1") openModal();
}

boot();

(function initEarlyAccessForm() {
  const form = document.getElementById("early-access-form");
  const wrap = document.getElementById("early-access-form-wrap");
  const thanks = document.getElementById("early-access-thanks");
  const errorEl = document.getElementById("ea-error");
  const submitBtn = document.getElementById("ea-submit");
  const nameEl = document.getElementById("ea-name");
  const emailEl = document.getElementById("ea-email");
  const reasonEl = document.getElementById("ea-reason");
  if (!form || !wrap || !thanks || !submitBtn || !nameEl || !emailEl || !reasonEl) return;

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function clearFieldErrors() {
    [nameEl, emailEl, reasonEl].forEach((el) => {
      el.classList.remove("is-invalid");
      el.removeAttribute("aria-invalid");
    });
    errorEl.classList.add("hidden");
    errorEl.textContent = "";
  }

  function markInvalid(el) {
    el.classList.add("is-invalid");
    el.setAttribute("aria-invalid", "true");
  }

  function validateClient() {
    clearFieldErrors();
    const name = (nameEl.value || "").trim();
    const email = (emailEl.value || "").trim();
    const reason = (reasonEl.value || "").trim();
    const problems = [];

    if (!name) {
      problems.push("Name is required.");
      markInvalid(nameEl);
    }
    if (!email) {
      problems.push("Email is required.");
      markInvalid(emailEl);
    } else if (!EMAIL_RE.test(email)) {
      problems.push("Please enter a valid email address.");
      markInvalid(emailEl);
    }
    if (!reason) {
      problems.push("Please tell us why you want access.");
      markInvalid(reasonEl);
    }

    if (problems.length) {
      errorEl.textContent = problems.join(" ");
      errorEl.classList.remove("hidden");
      const firstInvalid = form.querySelector(".is-invalid");
      firstInvalid?.focus();
      return null;
    }

    return {
      name,
      email,
      reason,
      website: document.getElementById("ea-website")?.value || "",
    };
  }

  [nameEl, emailEl, reasonEl].forEach((el) => {
    el.addEventListener("input", () => {
      if (el.classList.contains("is-invalid") && (el.value || "").trim()) {
        el.classList.remove("is-invalid");
        el.removeAttribute("aria-invalid");
      }
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = validateClient();
    if (!payload) return;

    submitBtn.disabled = true;
    const prev = submitBtn.textContent;
    submitBtn.textContent = "Sending…";

    try {
      const response = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }
      wrap.classList.add("hidden");
      wrap.hidden = true;
      thanks.classList.remove("hidden");
      thanks.hidden = false;
      thanks.focus?.();
    } catch (error) {
      errorEl.textContent = error.message || "Something went wrong. Please try again.";
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = prev;
    }
  });
})();

(function initBackToTop() {
  const btn = document.getElementById("back-to-top");
  if (!btn) return;

  const SHOW_AFTER = 420;
  let ticking = false;

  function updateVisibility() {
    const show = window.scrollY > SHOW_AFTER;
    btn.classList.toggle("is-visible", show);
    btn.hidden = !show;
    ticking = false;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateVisibility);
  }

  btn.addEventListener("click", () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    btn.blur();
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  updateVisibility();
})();

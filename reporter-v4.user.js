// ==UserScript==
// @name         Internal Issue Reporter (v4.1.0 - Configurable Shortcut)
// @namespace    internal-issue-reporter-v4
// @version      4.1.0
// @description  Keyboard-shortcut report flow: press a configurable shortcut (default Alt+Shift+R) to capture a real screenshot via getDisplayMedia(), add a description, and send it to your internal API as multipart FormData. Shortcut is user-configurable via the Tampermonkey menu. No floating button. Uses safe DOM construction (no innerHTML) so it also works on pages with strict Trusted Types CSP, like Gmail.
// @author       secret
// @include      https://*.github.com/*
// @include      https://*.stackoverflow.com/*
// @match        https://dev.internal-crm.com/*
// @match        https://staging.pbx-tool.com/*
// @match        https://mail.google.com/*
// @match        http://localhost:*/*
// @match        https://ant.design/*
// @match        https://docs.google.com/spreadsheets/*
// @match        https://portal.sotatek.com/*
// @exclude      https://portal.sotatek.com/admin/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      webhook.site
// @connect      your-internal-api.company.com
// @run-at       document-idle
// @updateURL    https://tampermonkey-five.vercel.app/reporter-v4.user.js
// @downloadURL  https://tampermonkey-five.vercel.app/reporter-v4.user.js
// ==/UserScript==

(function () {
  "use strict";

  const NS = "issue-reporter-tm";
  let modalOpen = false;

  const pressedKeys = new Set();

  // Make sure the @connect metadata matches the domain of the API URL
  const API_URL = "https://webhook.site/cd43d00f-bba5-40a8-8e08-6f526a122c94";

  const DEFAULT_SHORTCUT = "Alt+Shift+R";
  let currentShortcut = null;

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    for (const key in attrs) {
      const val = attrs[key];
      if (val == null) continue;
      if (key === "class") node.className = val;
      else if (key === "text") node.textContent = val;
      else if (key.startsWith("on") && typeof val === "function") {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else {
        node.setAttribute(key, val);
      }
    }
    (children || []).forEach((child) => {
      if (child == null) return;
      node.appendChild(
        typeof child === "string" ? document.createTextNode(child) : child,
      );
    });
    return node;
  }

  function parseShortcut(raw) {
    if (!raw || typeof raw !== "string") return null;

    const parts = raw
      .split("+")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);

    if (parts.length === 0) return null;

    const combo = {
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
      keys: [], // ordered, de-duplicated list of main (non-modifier) keys
    };
    const seenKeys = new Set();

    for (const part of parts) {
      if (part === "ctrl" || part === "control") combo.ctrl = true;
      else if (part === "alt" || part === "option") combo.alt = true;
      else if (part === "shift") combo.shift = true;
      else if (
        part === "meta" ||
        part === "cmd" ||
        part === "command" ||
        part === "win"
      )
        combo.meta = true;
      else if (!seenKeys.has(part)) {
        seenKeys.add(part);
        combo.keys.push(part);
      }
    }

    if (combo.keys.length === 0) return null;
    return combo;
  }

  function formatShortcut(combo) {
    const labelParts = [];
    if (combo.ctrl) labelParts.push("Ctrl");
    if (combo.alt) labelParts.push("Alt");
    if (combo.shift) labelParts.push("Shift");
    if (combo.meta) labelParts.push("Meta");
    combo.keys.forEach((k) =>
      labelParts.push(k.length === 1 ? k.toUpperCase() : k),
    );
    return labelParts.join("+");
  }

  function isShortcutMatch(e, combo) {
    if (!combo) return false;
    if (e.repeat) return false;
    if (
      e.altKey !== combo.alt ||
      e.shiftKey !== combo.shift ||
      e.ctrlKey !== combo.ctrl ||
      e.metaKey !== combo.meta
    )
      return false;
    return combo.keys.every((k) => pressedKeys.has(k));
  }

  GM_registerMenuCommand(
    "Set Shortcut (issue report keyboard shortcut)",
    async () => {
      const current = await GM_getValue("shortcut", DEFAULT_SHORTCUT);
      const next = prompt(
        "Enter the keyboard shortcut (e.g. Alt+Shift+R, ctrl+alt+t...).\n" +
          "Upper/lower case doesn't matter. Leave empty to use the default (" +
          DEFAULT_SHORTCUT +
          "):",
        current,
      );
      if (next === null) return; // clicked Cancel

      const trimmed = next.trim();
      const valueToSave = trimmed === "" ? DEFAULT_SHORTCUT : trimmed;
      const parsed = parseShortcut(valueToSave);

      if (!parsed) {
        alert("Invalid shortcut. Please enter it in the form: Alt+Shift+R");
        return;
      }

      await GM_setValue("shortcut", valueToSave);
      currentShortcut = parsed;
      alert(
        "New shortcut saved: " +
          formatShortcut(parsed) +
          "\n(Applied immediately, no page reload needed.)",
      );
    },
  );

  injectStyles();
  init();

  async function init() {
    const stored = await GM_getValue("shortcut", DEFAULT_SHORTCUT);
    currentShortcut = parseShortcut(stored) || parseShortcut(DEFAULT_SHORTCUT);
    registerShortcut();
  }

  function injectStyles() {
    GM_addStyle(`
      .${NS}-toast {
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483000;
        display: flex; align-items: center; gap: 8px;
        padding: 10px 16px; background: #1a1a1a; color: #fff;
        border-radius: 999px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 6px 16px rgba(0,0,0,0.25);
        opacity: 0; transform: translateY(8px);
        transition: opacity .15s ease, transform .15s ease;
        pointer-events: none;
      }
      .${NS}-toast--visible { opacity: 1; transform: translateY(0); }

      .${NS}-overlay {
        position: fixed; inset: 0; z-index: 2147483001;
        background: rgba(15,15,15,0.5);
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .${NS}-box {
        width: min(480px, 92vw); max-height: 88vh; overflow-y: auto;
        background: #fff; border-radius: 10px; padding: 18px 20px 16px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.35); box-sizing: border-box;
      }
      .${NS}-header { display: flex; align-items: center; justify-content: space-between; }
      .${NS}-header h3 { margin: 0; font-size: 16px; color: #1a1a1a; }
      .${NS}-close { cursor: pointer; font-size: 20px; line-height: 1; color: #888; background: none; border: none; padding: 2px 6px; }
      .${NS}-close:hover { color: #333; }
      .${NS}-meta { font-size: 11px; color: #888; margin: 6px 0 12px; word-break: break-all; }
      .${NS}-shot-wrap { border: 1px solid #eee; border-radius: 6px; overflow: hidden; margin-bottom: 12px; max-height: 220px; }
      .${NS}-shot { display: block; width: 100%; height: auto; }
      .${NS}-shot-fail { font-size: 12px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; }
      .${NS}-label { display: block; font-size: 12px; font-weight: 600; color: #444; margin-bottom: 6px; }
      .${NS}-input, .${NS}-textarea {
        display: block; box-sizing: border-box; width: 100%; padding: 10px;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #1a1a1a; background: #fafafa; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 12px;
      }
      .${NS}-textarea { resize: vertical; }
      .${NS}-input:focus, .${NS}-textarea:focus { border-color: #ff4d4f; background: #fff; outline: none; }
      .${NS}-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
      .${NS}-btn { cursor: pointer; font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 8px 16px; border-radius: 6px; border: none; }
      .${NS}-btn--ghost { background: #f0f0f0; color: #333; }
      .${NS}-btn--ghost:hover { background: #e4e4e4; }
      .${NS}-btn--primary { background: #ff4d4f; color: #fff; }
      .${NS}-btn--primary:hover { background: #e6393b; }
      .${NS}-status { margin-top: 10px; font-size: 12px; min-height: 14px; color: #666; }
      .${NS}-status--success { color: #15803d; }
      .${NS}-status--error { color: #b91c1c; }
    `);
  }

  function registerShortcut() {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", clearPressedKeys, true);
  }

  function onKeyUp(e) {
    pressedKeys.delete(e.key.toLowerCase());
  }

  function clearPressedKeys() {
    pressedKeys.clear();
  }

  function onKeyDown(e) {
    pressedKeys.add(e.key.toLowerCase());
    if (!isShortcutMatch(e, currentShortcut)) return;
    if (modalOpen) return;
    e.preventDefault();
    e.stopPropagation();
    onShortcutTriggered();
  }

  function showToast(text) {
    let toast = document.getElementById(`${NS}-toast`);
    if (!toast) {
      toast = h("div", { id: `${NS}-toast`, class: `${NS}-toast` });
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    requestAnimationFrame(() => toast.classList.add(`${NS}-toast--visible`));
    return toast;
  }

  function hideToast() {
    const toast = document.getElementById(`${NS}-toast`);
    if (toast) toast.classList.remove(`${NS}-toast--visible`);
  }

  async function onShortcutTriggered() {
    showToast("Capturing screenshot...");

    const screenshotPromise = captureScreenshot();
    const lastUserNamePromise = GM_getValue("lastUserName", "");
    const [screenshot, lastUserName] = await Promise.all([
      screenshotPromise,
      lastUserNamePromise,
    ]);

    hideToast();
    openModal(screenshot, lastUserName);
  }

  async function captureScreenshot() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      console.error(
        "[Issue Reporter] getDisplayMedia is not available (requires HTTPS/secure context)",
      );
      return null;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" }, // hints the browser to suggest "This Tab" first
        preferCurrentTab: true, // Chrome-only: defaults the picker to the current tab
        selfBrowserSurface: "include",
        audio: false,
      });
    } catch (e) {
      // User cancelled the picker, or permission was denied.
      console.error("[Issue Reporter] screenshot capture cancelled/failed", e);
      return null;
    }

    try {
      const track = stream.getVideoTracks()[0];
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      if (video.readyState < 2) {
        await new Promise((resolve) => {
          video.onloadedmetadata = resolve;
        });
      }

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);

      return canvas.toDataURL("image/png");
    } catch (e) {
      console.error("[Issue Reporter] failed to read captured frame", e);
      return null;
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  async function openScreenshotPreview(dataUrl) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank");
      // Revoke after a delay long enough for the new tab to load the image.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (e) {
      console.error("[Issue Reporter] could not open screenshot preview", e);
    }
  }

  async function dataUrlToBlob(dataUrl) {
    try {
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch (e) {
      console.error("[Issue Reporter] failed to convert screenshot to Blob", e);
      return null;
    }
  }

  function collectContext() {
    return {
      url: location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      timestamp: new Date().toISOString(),
    };
  }

  function openModal(screenshotDataUrl, lastUserName) {
    closeModal();
    modalOpen = true;

    const context = collectContext();

    const usernameInput = h("input", {
      id: `${NS}-username`,
      class: `${NS}-input`,
      type: "text",
      placeholder: "Enter your name",
      value: lastUserName || "",
    });

    const descTextarea = h("textarea", {
      id: `${NS}-desc`,
      class: `${NS}-textarea`,
      rows: "4",
      placeholder: "Describe the issue in detail...",
    });

    const statusEl = h("div", { id: `${NS}-status`, class: `${NS}-status` });

    const shotSection = screenshotDataUrl
      ? h("div", { class: `${NS}-shot-wrap` }, [
          h("img", {
            class: `${NS}-shot`,
            src: screenshotDataUrl,
            alt: "Screenshot preview",
          }),
        ])
      : h("div", {
          class: `${NS}-shot-fail`,
          text: "Screenshot could not be captured (cancelled or denied). You can still submit a description.",
        });

    const closeBtn = h("button", {
      class: `${NS}-close`,
      type: "button",
      "aria-label": "Close",
      text: "\u00d7",
    });
    const cancelBtn = h("button", {
      id: `${NS}-cancel`,
      class: `${NS}-btn ${NS}-btn--ghost`,
      type: "button",
      text: "Cancel",
    });
    const submitBtn = h("button", {
      id: `${NS}-submit`,
      class: `${NS}-btn ${NS}-btn--primary`,
      type: "button",
      text: "Send",
    });

    const shortcutLabel = currentShortcut
      ? formatShortcut(currentShortcut)
      : DEFAULT_SHORTCUT;

    const box = h(
      "div",
      {
        class: `${NS}-box`,
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": `${NS}-title`,
      },
      [
        h("div", { class: `${NS}-header` }, [
          h("h3", { id: `${NS}-title`, text: "Report an issue" }),
          closeBtn,
        ]),
        h("div", { class: `${NS}-meta`, text: context.url }),
        h("div", {
          class: `${NS}-meta`,
          text: `Reopen this form with the shortcut: ${shortcutLabel} (change it via the Tampermonkey menu → "Set Shortcut")`,
        }),
        shotSection,
        h("label", {
          class: `${NS}-label`,
          for: `${NS}-username`,
          text: "User Name",
        }),
        usernameInput,
        h("label", {
          class: `${NS}-label`,
          for: `${NS}-desc`,
          text: "Description",
        }),
        descTextarea,
        h("div", { class: `${NS}-actions` }, [cancelBtn, submitBtn]),
        statusEl,
      ],
    );

    const overlay = h("div", { id: `${NS}-overlay`, class: `${NS}-overlay` }, [
      box,
    ]);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    closeBtn.addEventListener("click", closeModal);
    cancelBtn.addEventListener("click", closeModal);
    submitBtn.addEventListener("click", () =>
      submitIssue(context, screenshotDataUrl),
    );

    document.body.appendChild(overlay);
    usernameInput.focus();
  }

  function closeModal() {
    const el = document.getElementById(`${NS}-overlay`);
    if (el) el.remove();
    modalOpen = false;
  }

  async function submitIssue(context, screenshotDataUrl) {
    const statusEl = document.getElementById(`${NS}-status`);
    const submitBtn = document.getElementById(`${NS}-submit`);
    const userName = document.getElementById(`${NS}-username`).value.trim();
    const description = document.getElementById(`${NS}-desc`).value.trim();

    if (!userName) {
      statusEl.textContent = "Please enter your name.";
      statusEl.className = `${NS}-status ${NS}-status--error`;
      return;
    }
    if (!description) {
      statusEl.textContent = "Please enter a description.";
      statusEl.className = `${NS}-status ${NS}-status--error`;
      return;
    }

    submitBtn.disabled = true;
    statusEl.textContent = "Sending...";
    statusEl.className = `${NS}-status`;

    await GM_setValue("lastUserName", userName);

    // Real API_URL not set yet
    if (!API_URL || API_URL.includes("your-internal-api.company.com")) {
      submitBtn.disabled = false;
      statusEl.textContent = "API URL has not been configured in the code.";
      statusEl.className = `${NS}-status ${NS}-status--error`;
      alert(
        "Issue Reporter: the API URL has not been configured. Please notify the script maintainer.",
      );
      return;
    }

    const formData = new FormData();
    formData.append("userName", userName);
    formData.append("description", description);
    formData.append("url", context.url);
    formData.append("title", context.title);
    formData.append("userAgent", context.userAgent);
    formData.append("screenWidth", String(context.screenWidth));
    formData.append("screenHeight", String(context.screenHeight));
    formData.append("devicePixelRatio", String(context.devicePixelRatio));
    formData.append("timestamp", context.timestamp);

    if (screenshotDataUrl) {
      const blob = await dataUrlToBlob(screenshotDataUrl);
      if (blob) {
        formData.append("screenshot", blob, "screenshot.png");
      } else {
        formData.append("screenshotDataUrl", screenshotDataUrl);
      }
    }

    GM_xmlhttpRequest({
      method: "POST",
      url: API_URL,
      data: formData,
      onload: (res) => {
        submitBtn.disabled = false;
        if (res.status >= 200 && res.status < 300) {
          statusEl.textContent = "Issue sent successfully.";
          statusEl.className = `${NS}-status ${NS}-status--success`;
          setTimeout(closeModal, 1200);
        } else {
          const msg = `Send failed: HTTP ${res.status}`;
          statusEl.textContent = msg;
          statusEl.className = `${NS}-status ${NS}-status--error`;
          alert(
            `Issue Reporter: ${msg}. Please try again or report the issue directly.`,
          );
        }
      },
      onerror: (err) => {
        submitBtn.disabled = false;
        const msg = `Could not connect to the API: ${err?.error || "network error"}`;
        statusEl.textContent = msg;
        statusEl.className = `${NS}-status ${NS}-status--error`;
        alert(
          `Issue Reporter: ${msg}. Check your network connection or notify the administrator.`,
        );
      },
      ontimeout: () => {
        submitBtn.disabled = false;
        const msg = "Send failed: request timed out.";
        statusEl.textContent = msg;
        statusEl.className = `${NS}-status ${NS}-status--error`;
        alert(`Issue Reporter: ${msg}`);
      },
    });
  }
})();

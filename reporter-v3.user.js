// ==UserScript==
// @name         Internal Issue Reporter (v2 - Keyboard Shortcut)
// @namespace    internal-issue-reporter-v2
// @version      3.0.0
// @description  Keyboard-shortcut report flow: press Alt+Shift+R to capture a real screenshot via getDisplayMedia(), add a description, and send it to your internal API. No floating button. Uses safe DOM construction (no innerHTML) so it also works on pages with strict Trusted Types CSP, like Gmail.
// @author       you
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
// @exclude      https://mail.google.com/mail/u/0/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      webhook.site
// @connect      your-internal-api.company.com
// @run-at       document-idle
// @updateURL    https://tampermonkey-five.vercel.app/reporter-v2.user.js
// @downloadURL  https://tampermonkey-five.vercel.app/reporter-v2.user.js
// ==/UserScript==

(function () {
  "use strict";

  const NS = "issue-reporter-tm";
  let modalOpen = false;

  // ---------------------------------------------------------------------
  // Hardcoded API endpoint. Sửa dòng dưới đây thành URL API nội bộ thật,
  // sau đó nhớ cập nhật @connect ở phần metadata phía trên cho khớp domain.
  // ---------------------------------------------------------------------
  const API_URL = "https://webhook.site/cd43d00f-bba5-40a8-8e08-6f526a122c94";

  // ---------------------------------------------------------------------
  // Small safe DOM builder — avoids innerHTML entirely so this also works
  // on pages that enforce Trusted Types (e.g. Gmail), which throw on any
  // raw innerHTML/outerHTML string assignment.
  // ---------------------------------------------------------------------
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

  injectStyles();
  registerShortcut();

  // ---------------------------------------------------------------------
  // Styles — GM_addStyle sets .textContent on a <style> tag internally,
  // which Trusted Types does not restrict, so this is safe as-is.
  // ---------------------------------------------------------------------
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

  // ---------------------------------------------------------------------
  // Keyboard shortcut: Alt+Shift+R. Registered on window with capture=true
  // so it fires even if focus is inside an input/textarea/iframe-less page.
  // Note: keydown still counts as a user gesture, so getDisplayMedia() can
  // still be called directly inside this handler.
  // ---------------------------------------------------------------------
  const SHORTCUT_LABEL = "Alt+Shift+R";

  function registerShortcut() {
    window.addEventListener("keydown", onKeyDown, true);
  }

  function isShortcutMatch(e) {
    return (
      e.altKey &&
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      (e.key === "R" || e.key === "r")
    );
  }

  function onKeyDown(e) {
    if (!isShortcutMatch(e)) return;
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
    showToast("🚨 Đang chụp màn hình...");

    // Call captureScreenshot() first/synchronously so the getDisplayMedia()
    // permission prompt still counts as triggered by this keypress (user
    // activation can be lost if too many awaits happen before it).
    const screenshotPromise = captureScreenshot();
    const lastUserNamePromise = GM_getValue("lastUserName", "");
    const [screenshot, lastUserName] = await Promise.all([
      screenshotPromise,
      lastUserNamePromise,
    ]);

    hideToast();
    openModal(screenshot, lastUserName);
  }

  // ---------------------------------------------------------------------
  // Screenshot via the Screen Capture API. This captures real rendered
  // pixels (like a native screenshot) rather than re-rendering the DOM, so
  // it correctly handles <canvas>-based UIs (e.g. Google Sheets) and is not
  // blocked by page CSP/Trusted Types (e.g. Gmail) the way html2canvas was.
  //
  // Trade-off: the browser shows a native picker asking the user to choose
  // "this tab / a window / the entire screen" and confirm sharing — this
  // cannot be skipped or pre-selected for privacy/security reasons. Only
  // one video frame is grabbed, then the capture is stopped immediately.
  // ---------------------------------------------------------------------
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
      // Stop sharing immediately after grabbing one frame, so the browser's
      // "you are sharing your screen" indicator disappears right away.
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  // Chrome blocks top-level navigation to large `data:` URLs (shows
  // about:blank instead of the content). Converting to a `blob:` URL first
  // works around this and is safe to navigate to.
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
          h("h3", { id: `${NS}-title`, text: "🚨 Report an issue" }),
          closeBtn,
        ]),
        h("div", { class: `${NS}-meta`, text: context.url }),
        h("div", {
          class: `${NS}-meta`,
          text: `Mở lại form này bằng phím tắt: ${SHORTCUT_LABEL}`,
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

    const payload = {
      ...context,
      userName,
      description,
      screenshot: screenshotDataUrl,
    };
    await GM_setValue("lastUserName", userName);

    // Chưa sửa API_URL thật (vẫn còn placeholder) — báo lỗi ngay, không gửi đi đâu cả.
    if (!API_URL || API_URL.includes("your-internal-api.company.com")) {
      submitBtn.disabled = false;
      statusEl.textContent = "API URL chưa được cấu hình trong code.";
      statusEl.className = `${NS}-status ${NS}-status--error`;
      alert(
        "Issue Reporter: API URL chưa được cấu hình. Vui lòng báo cho người quản lý script.",
      );
      return;
    }

    GM_xmlhttpRequest({
      method: "POST",
      url: API_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      onload: (res) => {
        submitBtn.disabled = false;
        if (res.status >= 200 && res.status < 300) {
          statusEl.textContent = "Issue sent successfully.";
          statusEl.className = `${NS}-status ${NS}-status--success`;
          setTimeout(closeModal, 1200);
        } else {
          const msg = `Gửi thất bại: HTTP ${res.status}`;
          statusEl.textContent = msg;
          statusEl.className = `${NS}-status ${NS}-status--error`;
          alert(
            `Issue Reporter: ${msg}. Vui lòng thử lại hoặc báo lỗi trực tiếp.`,
          );
        }
      },
      onerror: (err) => {
        submitBtn.disabled = false;
        const msg = `Không thể kết nối API: ${err?.error || "network error"}`;
        statusEl.textContent = msg;
        statusEl.className = `${NS}-status ${NS}-status--error`;
        alert(
          `Issue Reporter: ${msg}. Kiểm tra lại kết nối mạng hoặc báo cho quản trị viên.`,
        );
      },
      ontimeout: () => {
        submitBtn.disabled = false;
        const msg = "Gửi thất bại: hết thời gian chờ (timeout).";
        statusEl.textContent = msg;
        statusEl.className = `${NS}-status ${NS}-status--error`;
        alert(`Issue Reporter: ${msg}`);
      },
    });
  }
})();

// ==UserScript==
// @name         Internal Issue Reporter (v1.0.1)
// @namespace    internal-issue-reporter
// @version      1.0.1
// @description  Floating report button: capture a real screenshot via getDisplayMedia(), add a description, and send it to your internal API. No per-repo code changes needed — just add domains to @match below. Uses safe DOM construction (no innerHTML) so it also works on pages with strict Trusted Types CSP, like Gmail.
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
// @exclude      https://mail.google.com/mail/u/0/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      webhook.site
// @connect      your-internal-api.company.com
// @run-at       document-idle
// @updateURL    https://tampermonkey-five.vercel.app/reporter.user.js
// @downloadURL  https://tampermonkey-five.vercel.app/reporter.user.js
// ==/UserScript==

(function () {
  "use strict";

  const NS = "issue-reporter-tm";
  let modalOpen = false;

  // Small safe DOM builder — avoids innerHTML entirely so this also works
  // on pages that enforce Trusted Types (e.g. Gmail), which throw on any
  // raw innerHTML/outerHTML string assignment.

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

  // Settings (stored via GM_setValue, configurable through the Tampermonkey
  // menu — click the extension icon → script menu — no code edit needed).

  GM_registerMenuCommand("Set API URL", async () => {
    const current = await GM_getValue("apiUrl", "");
    const next = prompt(
      "API URL to send issues to (leave blank for demo mode):",
      current,
    );
    if (next !== null) await GM_setValue("apiUrl", next.trim());
  });

  injectStyles();
  mountFloatingButton();

  // Styles — GM_addStyle sets .textContent on a <style> tag internally,
  // which Trusted Types does not restrict, so this is safe as-is.

  function injectStyles() {
    GM_addStyle(`
      .${NS}-fab {
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483000;
        display: flex; align-items: center; gap: 6px;
        padding: 10px 16px; background: #ff4d4f; color: #fff;
        border: none; border-radius: 999px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        cursor: pointer; box-shadow: 0 6px 16px rgba(0,0,0,0.25);
        transition: transform .15s ease, box-shadow .15s ease;
      }
      .${NS}-fab:hover { transform: translateY(-2px); box-shadow: 0 10px 20px rgba(0,0,0,0.3); }
      .${NS}-fab span { color: #fff; }
      .${NS}-fab--busy { opacity: .6; cursor: wait; }

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

  function mountFloatingButton() {
    if (document.getElementById(`${NS}-btn`)) return;

    const btn = h(
      "button",
      {
        id: `${NS}-btn`,
        class: `${NS}-fab`,
        type: "button",
        "aria-label": "Report issue",
      },
      [h("span", { text: "🚨" }), h("span", { text: "Report" })],
    );
    btn.addEventListener("click", onReportClick);
    document.body.appendChild(btn);
  }

  async function onReportClick() {
    if (modalOpen) return;

    const btn = document.getElementById(`${NS}-btn`);
    btn.disabled = true;
    btn.classList.add(`${NS}-fab--busy`);

    // Call captureScreenshot() first/synchronously so the getDisplayMedia()
    // permission prompt still counts as triggered by this click (user
    // activation can be lost if too many awaits happen before it).
    const screenshotPromise = captureScreenshot();
    const lastUserNamePromise = GM_getValue("lastUserName", "");
    const [screenshot, lastUserName] = await Promise.all([
      screenshotPromise,
      lastUserNamePromise,
    ]);

    btn.disabled = false;
    btn.classList.remove(`${NS}-fab--busy`);

    openModal(screenshot, lastUserName);
  }

  // Screenshot via the Screen Capture API. This captures real rendered
  // pixels (like a native screenshot) rather than re-rendering the DOM, so
  // it correctly handles <canvas>-based UIs (e.g. Google Sheets) and is not
  // blocked by page CSP/Trusted Types (e.g. Gmail) the way html2canvas was.
  //
  // Trade-off: the browser shows a native picker asking the user to choose
  // "this tab / a window / the entire screen" and confirm sharing — this
  // cannot be skipped or pre-selected for privacy/security reasons. Only
  // one video frame is grabbed, then the capture is stopped immediately.

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

    const apiUrl = await GM_getValue("apiUrl", "");

    if (!apiUrl) {
      // Demo mode: no backend configured, log to console and open the screenshot
      // in a new tab so it can be visually verified.
      console.log("[Issue Reporter] DEMO submit (no apiUrl set):", {
        ...payload,
        screenshot: payload.screenshot
          ? `<${payload.screenshot.length} chars base64>`
          : null,
      });
      if (payload.screenshot) await openScreenshotPreview(payload.screenshot);

      submitBtn.disabled = false;
      statusEl.textContent =
        "Demo mode: no API URL configured, logged to console instead.";
      statusEl.className = `${NS}-status ${NS}-status--success`;
      setTimeout(closeModal, 1200);
      return;
    }

    GM_xmlhttpRequest({
      method: "POST",
      url: apiUrl,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      onload: (res) => {
        submitBtn.disabled = false;
        if (res.status >= 200 && res.status < 300) {
          statusEl.textContent = "Issue sent successfully.";
          statusEl.className = `${NS}-status ${NS}-status--success`;
          setTimeout(closeModal, 1200);
        } else {
          statusEl.textContent = `Failed to send: HTTP ${res.status}`;
          statusEl.className = `${NS}-status ${NS}-status--error`;
        }
      },
      onerror: (err) => {
        submitBtn.disabled = false;
        statusEl.textContent = `Failed to send: ${err?.error || "network error"}`;
        statusEl.className = `${NS}-status ${NS}-status--error`;
      },
    });
  }
})();

// ==UserScript==
// @name         X / Twitter → VRChat
// @namespace    https://github.com/neura-neura/userscripts
// @version      1.1.4
// @description  Copies the progressive MP4 of an X/Twitter video to paste into a VRChat video player.
// @author       neura-neura
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://www.twitter.com/*
// @match        https://mobile.twitter.com/*
// @run-at       document-start
// @grant        GM_setClipboard
// @inject-into  page
// @homepageURL  https://github.com/neura-neura/userscripts
// @supportURL   https://github.com/neura-neura/userscripts/issues
// @downloadURL  https://raw.githubusercontent.com/neura-neura/userscripts/main/twitter-to-vrc.user.js
// @updateURL    https://raw.githubusercontent.com/neura-neura/userscripts/main/twitter-to-vrc.user.js
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const BUTTON_ATTRIBUTE = 'data-xvrc-parse-button';
  const MAX_STREAM_AGE_MS = 30 * 60 * 1000;
  const WAIT_FOR_STREAM_MS = 5_000;
  const streamsByMediaID = new Map();
  const directMP4ByMediaID = new Map();
  let newestStream;
  let scanPending = false;
  let toastTimer;

  // X keeps this test id stable more often than it keeps translated labels
  // stable. The label list covers localized builds that omit the test id.
  const SHARE_TEST_IDS = new Set(['share', 'sharebutton', 'share-post']);
  const SHARE_LABELS = new Set([
    'share',
    'share post',
    'compartir',
    'compartir publicación',
    'compartir publicacion',
    '分享',
    '分享帖子',
    '分享貼文',
    '共有',
    'ポストを共有',
    '공유',
    '게시물 공유',
    'partager',
    'partager le post',
    'teilen',
    'beitrag teilen',
    'compartilhar',
    'compartilhar post',
    'partilhar',
    'condividi',
    'condividi post',
    'поделиться',
    'поділитися',
    'paylaş',
    'مشاركة',
    'साझा करें',
  ]);

  const VRC_ICON_PATHS = Object.freeze([
    {
      fill: '#eee',
      d: 'M204.8,240.9c-2.5,0-4.8-1.1-6.4-3.1l-47.4-58.8H36.1c-17.1,0-31.1-13.9-31.1-31.1V36.1c0-17.1,13.9-31.1,31.1-31.1h173.9c17.1,0,31.1,13.9,31.1,31.1v111.9c0,16.1-12.3,29.4-28,30.9l.2,53.7c0,2.2-.8,4.3-2.4,5.9-1.6,1.6-3.7,2.5-5.9,2.5Z',
    },
    {
      fill: '#111',
      d: 'M209.9,10c14.4,0,26.1,11.7,26.1,26.1v111.9c0,14.4-11.7,26.1-26.1,26.1h-1.9l.2,58.6c0,2-1.6,3.3-3.3,3.3s-1.8-.4-2.5-1.2l-48.9-60.7H36.1c-14.4,0-26.1-11.7-26.1-26.1V36.1c0-14.4,11.7-26.1,26.1-26.1h173.9M209.9,0H36.1C16.2,0,0,16.2,0,36.1v111.9c0,19.9,16.2,36.1,36.1,36.1h112.6l45.9,57c2.5,3.2,6.3,5,10.3,5s7-1.4,9.5-3.9c2.5-2.5,3.9-5.8,3.9-9.4v-49.5c15.9-3.7,27.8-18,27.8-35.2V36.1c0-19.9-16.2-36.1-36.1-36.1h0Z',
    },
    {
      fill: '#111',
      d: 'M84.9,144c-2.1,0-4.1-.4-6-1.3-1.9-.9-3.1-2.2-3.7-3.9l-28.7-93.3c-.2-.6-.3-1-.3-1.3,0-1.2.5-2.3,1.5-3.2,1-.9,2.3-1.7,3.7-2.2,1.5-.6,2.9-.9,4.2-.9s2.5.2,3.5.7c1,.5,1.6,1.3,1.9,2.4l23.8,82.1,23.6-82.1c.4-1.2,1.1-2,2-2.4,1-.5,2.1-.7,3.3-.7s2.9.3,4.3.9c1.4.6,2.7,1.3,3.7,2.2,1,.9,1.5,2,1.5,3.2s0,.4,0,.6c0,.2,0,.4,0,.7l-28.5,93.3c-.6,1.7-1.8,3-3.7,3.9-1.9.9-3.9,1.3-6.1,1.3Z',
    },
    {
      fill: '#111',
      d: 'M190.1,143.6c-1.2,0-2.4-.4-3.4-1.3-1-.9-1.8-1.9-2.5-3.2l-21.2-41.2h-14.4v40.2c0,1.6-.8,2.9-2.4,3.7-1.6.9-3.3,1.3-5.3,1.3s-3.7-.4-5.3-1.3c-1.6-.9-2.4-2.1-2.4-3.7V42.8c0-1.3.5-2.5,1.4-3.5.9-1,2.2-1.4,3.8-1.4h27.4c6,0,11.6.9,16.6,2.7,5,1.8,9,4.8,12,9.1,3,4.3,4.5,10.2,4.5,17.6s-.9,10.6-2.7,14.4c-1.8,3.8-4.2,6.9-7.2,9.1-3,2.3-6.5,3.9-10.3,5l20.2,37.9c.2.3.3.6.4,1.1,0,.4.1.8.1,1.1,0,1.2-.5,2.5-1.4,3.7-1,1.2-2.1,2.2-3.5,3-1.4.8-2.9,1.2-4.4,1.2ZM148.6,85.7h17.3c5.4,0,9.7-1.3,12.9-3.9,3.2-2.6,4.8-7,4.8-13.2s-1.6-10.7-4.8-13.2c-3.2-2.6-7.5-3.9-12.9-3.9h-17.3v34.3Z',
    },
  ]);

  function addStyles() {
    if (document.getElementById('xvrc-styles')) return;

    const style = document.createElement('style');
    style.id = 'xvrc-styles';
    style.textContent = `
      #xvrc-toast {
        position: fixed;
        z-index: 2147483647;
        top: 0;
        left: 50%;
        box-sizing: border-box;
        width: min(400px, calc(100vw - 32px));
        margin: 0;
        padding: 10px 20px;
        color: hsl(200deg 70% 30%);
        border: 1px solid hsl(200deg 70% 40%);
        border-radius: 10px;
        background: hsl(200deg 70% 90%);
        box-shadow: 0 10px 10px #00000050;
        font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        opacity: 0;
        pointer-events: none;
        transform: translate(-50%, -120%);
        transition: transform .5s ease, opacity .5s ease;
      }
      #xvrc-toast.xvrc-showing { opacity: 1; transform: translate(-50%, 10px); }
      #xvrc-toast.xvrc-success {
        color: hsl(130deg 70% 30%);
        border-color: hsl(130deg 70% 40%);
        background: hsl(130deg 70% 90%);
      }
      #xvrc-toast.xvrc-error {
        color: hsl(0deg 70% 30%);
        border-color: hsl(0deg 70% 40%);
        background: hsl(0deg 70% 90%);
      }
      #xvrc-toast p { margin: 0; }
      #xvrc-toast .xvrc-detail {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px solid currentColor;
        font-size: .8em;
        line-height: 1.3;
        overflow-wrap: anywhere;
      }
      button[${BUTTON_ATTRIBUTE}] { color: inherit; }
      button[${BUTTON_ATTRIBUTE}][data-xvrc-parsing="true"] svg { animation: xvrc-spin 1s linear infinite; }
      @keyframes xvrc-spin { to { transform: rotate(360deg); } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function showToast(kind, message, detail = '', duration = 4_500) {
    let toast = document.getElementById('xvrc-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'xvrc-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }

    clearTimeout(toastTimer);
    toast.className = kind === 'success' ? 'xvrc-success' : kind === 'error' ? 'xvrc-error' : '';
    toast.replaceChildren();

    const main = document.createElement('p');
    main.textContent = message;
    toast.appendChild(main);

    if (detail) {
      const details = document.createElement('p');
      details.className = 'xvrc-detail';
      details.textContent = detail;
      toast.appendChild(details);
    }

    requestAnimationFrame(() => toast.classList.add('xvrc-showing'));
    if (duration > 0) {
      toastTimer = setTimeout(() => toast.classList.remove('xvrc-showing'), duration);
    }
  }

  function createIcon() {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    // The original artwork touches all four viewBox edges. A safe margin keeps
    // its thin outline visible at the small size used by X's action row.
    svg.setAttribute('viewBox', '-12 -12 270 269.9');
    svg.setAttribute('width', '1.6em');
    svg.setAttribute('height', '1.6em');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.width = '1.6em';
    svg.style.height = '1.6em';
    svg.style.display = 'block';

    for (const iconPath of VRC_ICON_PATHS) {
      const path = document.createElementNS(namespace, 'path');
      path.setAttribute('d', iconPath.d);
      path.setAttribute('fill', iconPath.fill);
      svg.appendChild(path);
    }
    return svg;
  }

  function getMediaID(url) {
    if (!url) return undefined;
    const match = String(url).match(/(?:amplify_video(?:_thumb)?|ext_tw_video(?:_thumb)?)\/(\d+)/i);
    return match?.[1];
  }

  function parseStreamURL(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }

    if (url.hostname.toLowerCase() !== 'video.twimg.com') return undefined;
    const mediaID = getMediaID(url.pathname);
    if (!mediaID) return undefined;

    const pathname = url.pathname;
    const isMasterPlaylist = /\/(?:pu\/)?pl\/[^/]+\.m3u8$/i.test(pathname);
    const isDirectMP4 = /\/pu\/vid\/.*\.mp4$/i.test(pathname);
    if (!isMasterPlaylist && !isDirectMP4) return undefined;

    const resolution = pathname.match(/\/(\d+)x(\d+)\//i);
    return {
      mediaID,
      url: url.href,
      type: isMasterPlaylist ? 'hls' : 'mp4',
      pixels: resolution ? Number(resolution[1]) * Number(resolution[2]) : 0,
      discoveredAt: Date.now(),
    };
  }

  function rememberStream(value) {
    const stream = parseStreamURL(value);
    if (!stream) return;

    const known = streamsByMediaID.get(stream.mediaID) || [];
    const duplicate = known.find(item => item.url === stream.url);
    if (duplicate) {
      return;
    }

    known.push(stream);
    streamsByMediaID.set(stream.mediaID, known.slice(-12));
    newestStream = stream;

    for (const [mediaID, candidates] of streamsByMediaID) {
      const fresh = candidates.filter(candidate => Date.now() - candidate.discoveredAt < MAX_STREAM_AGE_MS);
      if (fresh.length) streamsByMediaID.set(mediaID, fresh);
      else streamsByMediaID.delete(mediaID);
    }
  }

  /**
   * X's player consumes fragmented HLS through MediaSource. Its GraphQL reply
   * also contains a regular, muxed MP4 variant, which is the compatible URL
   * for external players such as the ones used in VRChat.
   */
  function rememberDirectMP4(mediaID, variants) {
    if (!/^\d+$/.test(String(mediaID))) return;

    const candidates = [];
    for (const variant of variants) {
      if (variant?.content_type !== 'video/mp4' || typeof variant.url !== 'string') continue;
      try {
        const url = new URL(variant.url);
        const resolution = url.pathname.match(/\/(\d+)x(\d+)\//i);
        candidates.push({
          mediaID: String(mediaID),
          url: url.href,
          type: 'mp4',
          bitrate: Number(variant.bitrate) || 0,
          pixels: resolution ? Number(resolution[1]) * Number(resolution[2]) : 0,
          discoveredAt: Date.now(),
        });
      } catch {
        // Skip a malformed URL without discarding the other MP4 variants.
      }
    }
    if (!candidates.length) return;

    const known = directMP4ByMediaID.get(String(mediaID)) || [];
    for (const candidate of candidates) {
      if (!known.some(item => item.url === candidate.url)) known.push(candidate);
    }
    directMP4ByMediaID.set(String(mediaID), known.slice(-12));
  }

  function collectDirectMP4Variants(payload) {
    if (!payload || typeof payload !== 'object') return;

    const seen = new WeakSet();
    const pending = [payload];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);

      const variants = value.video_info?.variants;
      const mediaID = value.id_str ?? value.id;
      if (Array.isArray(variants) && mediaID !== undefined) {
        try {
          rememberDirectMP4(mediaID, variants);
        } catch {
          // Ignore one malformed variant while preserving the rest of the API response.
        }
      }

      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') pending.push(child);
      }
    }
  }

  function isTwitterAPIResponse(responseURL) {
    try {
      const url = new URL(responseURL);
      return /(^|\.)(x|twitter)\.com$/i.test(url.hostname) && url.pathname.includes('/i/api/');
    } catch {
      return false;
    }
  }

  function interceptTweetAPIs() {
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function(...args) {
        const responsePromise = originalFetch.apply(this, args);
        Promise.resolve(responsePromise).then(response => {
          if (!isTwitterAPIResponse(response.url)) return;
          response.clone().json().then(collectDirectMP4Variants).catch(() => undefined);
        }).catch(() => undefined);
        return responsePromise;
      };
    }

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener('loadend', () => {
        if (!isTwitterAPIResponse(this.responseURL)) return;
        try {
          const data = typeof this.response === 'string'
            ? JSON.parse(this.response)
            : this.response;
          collectDirectMP4Variants(data);
        } catch {
          // Not every X API request is JSON.
        }
      }, { once: true });
      return originalSend.apply(this, args);
    };
  }

  function readResourceTimingBuffer() {
    try {
      performance.getEntriesByType('resource').forEach(entry => rememberStream(entry.name));
    } catch {
      // Resource Timing is unavailable in a few privacy-hardened browsers.
    }
  }

  function observeNetworkResources() {
    readResourceTimingBuffer();
    try {
      const observer = new PerformanceObserver(list => {
        list.getEntries().forEach(entry => rememberStream(entry.name));
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // The timing buffer scan above is enough on browsers without PerformanceObserver support.
    }
    setInterval(readResourceTimingBuffer, 2_000);
  }

  function getPostMediaIDs(post) {
    const ids = new Set();
    post.querySelectorAll('video, source, img').forEach(element => {
      const values = [
        element.getAttribute('poster'),
        element.getAttribute('src'),
        element.currentSrc,
        element.src,
      ];
      values.forEach(value => {
        const mediaID = getMediaID(value);
        if (mediaID) ids.add(mediaID);
      });
    });
    return ids;
  }

  function selectBestStream(candidates) {
    return [...candidates].sort((a, b) => {
      const bitrateDifference = (b.bitrate || 0) - (a.bitrate || 0);
      if (bitrateDifference) return bitrateDifference;
      const pixelDifference = b.pixels - a.pixels;
      if (pixelDifference) return pixelDifference;
      return b.discoveredAt - a.discoveredAt;
    })[0];
  }

  function getStreamForPost(post) {
    const matchingCandidates = [];
    for (const mediaID of getPostMediaIDs(post)) {
      matchingCandidates.push(...(directMP4ByMediaID.get(mediaID) || []));
      matchingCandidates.push(...(streamsByMediaID.get(mediaID) || []).filter(stream => stream.type === 'mp4'));
    }
    if (matchingCandidates.length) return selectBestStream(matchingCandidates);
    return undefined;
  }

  function waitForStream(post) {
    const existing = getStreamForPost(post);
    if (existing) return Promise.resolve(existing);

    return new Promise(resolve => {
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const stream = getStreamForPost(post);
        if (stream || Date.now() - startedAt >= WAIT_FOR_STREAM_MS) {
          clearInterval(interval);
          resolve(stream);
        }
      }, 200);
    });
  }

  async function copyToClipboard(text) {
    let lastError;
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return;
      }
    } catch (error) {
      lastError = error;
    }

    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      lastError = error;
    }

    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw lastError || new Error('The browser denied clipboard access.');
  }

  function normalizeActionLabel(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLowerCase();
  }

  function isShareButton(button) {
    const testID = normalizeActionLabel(button.getAttribute('data-testid'));
    if (SHARE_TEST_IDS.has(testID)) return true;

    const label = normalizeActionLabel(button.getAttribute('aria-label'));
    return SHARE_LABELS.has(label);
  }

  function findStructuralShareButton(post, buttons) {
    // In X's action row, Share is consistently the final action. Looking at
    // the row shape keeps this fallback independent of the current locale.
    for (const group of post.querySelectorAll('[role="group"]')) {
      const groupButtons = buttons.filter(button => button.closest('[role="group"]') === group);
      if (groupButtons.length >= 4) return groupButtons.at(-1);
    }

    const rows = new Map();
    for (const button of buttons) {
      const row = button.parentElement;
      if (!row || rows.has(row)) continue;

      const rowButtons = [...row.children].filter(
        child => child.matches?.('button') && !child.hasAttribute(BUTTON_ATTRIBUTE),
      );
      if (rowButtons.length >= 4) rows.set(row, rowButtons);
    }

    return [...rows.values()]
      .sort((a, b) => b.length - a.length)[0]
      ?.at(-1);
  }

  function findShareButton(post) {
    const buttons = [...post.querySelectorAll('button')]
      .filter(button => !button.hasAttribute(BUTTON_ATTRIBUTE));
    return buttons.find(isShareButton) || findStructuralShareButton(post, buttons);
  }

  function isFlatActionRow(element) {
    return Boolean(element) && [...element.children].filter(child => child.matches?.('button')).length >= 4;
  }

  function makeParseButton(shareButton, post) {
    const button = shareButton.cloneNode(false);
    button.removeAttribute('id');
    button.removeAttribute('aria-haspopup');
    button.removeAttribute('aria-expanded');
    button.removeAttribute('data-state');
    button.removeAttribute('data-base-ui-click-trigger');
    button.setAttribute(BUTTON_ATTRIBUTE, 'true');
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', 'Copy video for VRChat');
    button.setAttribute('title', 'Copy video for VRChat');

    const originalContent = shareButton.firstElementChild;
    if (originalContent?.namespaceURI === 'http://www.w3.org/2000/svg') {
      button.appendChild(createIcon());
    } else if (originalContent) {
      const content = originalContent.cloneNode(false);
      const iconHost = originalContent.firstElementChild?.cloneNode(false);
      if (iconHost) {
        iconHost.appendChild(createIcon());
        content.appendChild(iconHost);
      } else {
        content.appendChild(createIcon());
      }
      button.appendChild(content);
    } else {
      button.appendChild(createIcon());
    }

    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.xvrcParsing === 'true') return;

      button.dataset.xvrcParsing = 'true';
      button.disabled = true;
      showToast('info', "Looking for X's direct MP4…", 'The fragmented HLS playlist will not be used.');

      try {
        const stream = await waitForStream(post);
        if (!stream) {
          throw new Error('X has not exposed a direct MP4 yet. Reload the post, play the video for a few seconds, and try again.');
        }

        await copyToClipboard(stream.url);
        showToast(
          'success',
          'Video URL copied. Paste it into the VRChat video player with Ctrl+V.',
          `Progressive MP4 · video ${stream.mediaID}`,
          6_000,
        );
      } catch (error) {
        showToast('error', 'Unable to copy the video for VRChat.', error.message || String(error), 7_000);
      } finally {
        button.disabled = false;
        delete button.dataset.xvrcParsing;
      }
    });

    return button;
  }

  function appendButtonAfterShare(post) {
    if (post.querySelector(`button[${BUTTON_ATTRIBUTE}]`)) return;
    if (!post.querySelector('video')) return;

    const shareButton = findShareButton(post);
    if (!shareButton) return;
    const button = makeParseButton(shareButton, post);
    const actionGroup = shareButton.closest('[role="group"]');

    if (!actionGroup && isFlatActionRow(shareButton.parentElement)) {
      shareButton.insertAdjacentElement('afterend', button);
      return;
    }

    if (actionGroup) {
      const shareItem = [...actionGroup.children].find(child => child.contains(shareButton));
      if (shareItem) {
        const wrapper = shareItem.cloneNode(false);
        const inner = shareButton.parentElement;
        if (inner && inner !== shareItem && shareItem.contains(inner)) {
          const innerWrapper = inner.cloneNode(false);
          innerWrapper.appendChild(button);
          wrapper.appendChild(innerWrapper);
        } else {
          wrapper.appendChild(button);
        }
        actionGroup.appendChild(wrapper);
        return;
      }
    }

    shareButton.insertAdjacentElement('afterend', button);
  }

  function mountButtons() {
    scanPending = false;
    document.querySelectorAll('article').forEach(appendButtonAfterShare);
  }

  function scheduleMount() {
    if (scanPending) return;
    scanPending = true;
    requestAnimationFrame(mountButtons);
  }

  function observePageChanges() {
    const observer = new MutationObserver(scheduleMount);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('play', scheduleMount, true);
    document.addEventListener('loadedmetadata', scheduleMount, true);
    setInterval(scheduleMount, 2_000);
  }

  function start() {
    addStyles();
    interceptTweetAPIs();
    observeNetworkResources();
    observePageChanges();
    scheduleMount();
  }

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

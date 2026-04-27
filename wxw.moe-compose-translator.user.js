// ==UserScript==
// @name         wxw.moe Composer Translator
// @namespace    https://wxw.moe/
// @version      1.0.0
// @description  Adds a translate button with saved language and capitalization controls to the wxw.moe composer.
// @license      MIT
// @homepageURL  https://github.com/neura-neura/userscripts
// @supportURL   https://github.com/neura-neura/userscripts/issues
// @match        https://wxw.moe/*
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      translate.googleapis.com
// ==/UserScript==

(function () {
  'use strict';

  const SELECTORS = {
    composeForm: '.compose-form',
    buttons: '.compose-form__buttons',
    counter: '.character-counter',
    textarea: '.autosuggest-textarea__textarea',
  };

  const STORAGE_KEYS = {
    sourceLang: 'wxwmoe-translator.sourceLang',
    targetLang: 'wxwmoe-translator.targetLang',
    capitalization: 'wxwmoe-translator.capitalization',
    preserveTokens: 'wxwmoe-translator.preserveTokens',
  };

  const DEFAULT_SETTINGS = {
    sourceLang: 'auto',
    targetLang: 'en',
    capitalization: 'normal',
    preserveTokens: true,
  };

  const LANGUAGES = [
    { code: 'auto', label: 'Auto detect' },
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
    { code: 'zh-CN', label: 'Chinese (Simplified)' },
    { code: 'zh-TW', label: 'Chinese (Traditional)' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'it', label: 'Italian' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'ru', label: 'Russian' },
    { code: 'uk', label: 'Ukrainian' },
    { code: 'pl', label: 'Polish' },
    { code: 'nl', label: 'Dutch' },
    { code: 'tr', label: 'Turkish' },
    { code: 'ar', label: 'Arabic' },
    { code: 'hi', label: 'Hindi' },
    { code: 'id', label: 'Indonesian' },
    { code: 'th', label: 'Thai' },
    { code: 'vi', label: 'Vietnamese' },
  ];

  const TARGET_LANGUAGES = LANGUAGES.filter((language) => language.code !== 'auto');

  const CAPITALIZATION_OPTIONS = [
    { code: 'normal', label: 'Normal' },
    { code: 'lower', label: 'Lowercase' },
    { code: 'upper', label: 'Uppercase' },
  ];

  const TRANSLATE_ICON = `
    <svg viewBox="0 0 256 256" aria-hidden="true">
      <path d="M224 184h-80l40-80ZM96 127.56A95.78 95.78 0 0 0 128 56H64a95.78 95.78 0 0 0 32 71.56"></path>
      <path d="m247.15 212.42-56-112a8 8 0 0 0-14.31 0l-21.71 43.43A88 88 0 0 1 108 126.93 103.65 103.65 0 0 0 135.69 64H160a8 8 0 0 0 0-16h-56V32a8 8 0 0 0-16 0v16H32a8 8 0 0 0 0 16h87.63A87.7 87.7 0 0 1 96 116.35a87.7 87.7 0 0 1-19-31 8 8 0 1 0-15.08 5.34A103.6 103.6 0 0 0 84 127a87.55 87.55 0 0 1-52 17 8 8 0 0 0 0 16 103.46 103.46 0 0 0 64-22.08 104.2 104.2 0 0 0 51.44 21.31l-26.6 53.19a8 8 0 0 0 14.31 7.16L148.94 192h70.11l13.79 27.58A8 8 0 0 0 240 224a8 8 0 0 0 7.15-11.58M156.94 176 184 121.89 211.05 176Z"></path>
    </svg>
  `;

  const CHEVRON_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.7 9.3a1 1 0 0 1 1.4 0L12 13.17l3.9-3.88a1 1 0 1 1 1.4 1.42l-4.6 4.58a1 1 0 0 1-1.4 0L6.7 10.7a1 1 0 0 1 0-1.4Z"></path>
    </svg>
  `;

  const PROTECTED_TEXT_PATTERN =
    /(https?:\/\/[^\s]+|@[A-Za-z0-9_]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?|#[\p{L}\p{N}_]+|:[A-Za-z0-9_+\-]+:)/gu;

  const controls = new Set();
  const controlByComposeForm = new WeakMap();
  const originalTextByTextarea = new WeakMap();

  injectStyles();
  scanForComposeForms(document);
  installGlobalListeners();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        scanForComposeForms(node);
      }
    }

    pruneDetachedControls();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  function injectStyles() {
    GM_addStyle(`
      .compose-form__actions {
        flex-wrap: nowrap;
        gap: 8px;
      }

      .compose-form__buttons {
        align-items: center;
        display: flex;
        flex: 1 1 auto;
        gap: 6px;
        min-width: 0;
      }

      .compose-form__buttons > * {
        flex: 0 0 auto;
      }

      .compose-form__buttons .character-counter {
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        margin-left: auto;
        min-width: 5ch;
        text-align: right;
      }

      .compose-form__submit {
        flex: 0 0 auto;
        margin-left: auto;
      }

      .compose-form__submit .button {
        min-width: 0;
        white-space: nowrap;
      }

      .wxwmoe-translate {
        align-items: center;
        display: inline-flex;
        flex: 0 0 auto;
        gap: 0;
        margin-right: 0;
      }

      .wxwmoe-translate-button,
      .wxwmoe-translate-menu-toggle,
      .wxwmoe-translate-menu-action {
        appearance: none;
        align-items: center;
        background: transparent;
        border: 0;
        border-radius: 999px;
        box-shadow: none;
        color: var(--color-accent, #d3487f);
        cursor: pointer;
        display: inline-flex;
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 600;
        gap: 6px;
        height: 24px;
        line-height: 1;
        margin: 0;
        min-width: 24px;
        padding: 0;
        text-decoration: none;
        transition:
          background-color 0.15s ease,
          color 0.15s ease,
          opacity 0.15s ease,
          transform 0.15s ease;
      }

      .wxwmoe-translate-button:hover,
      .wxwmoe-translate-menu-toggle:hover,
      .wxwmoe-translate-menu-action:hover {
        background: var(--color-accent-bg, rgba(211, 72, 127, 0.14));
      }

      .wxwmoe-translate-button[disabled],
      .wxwmoe-translate-menu-toggle[disabled],
      .wxwmoe-translate-menu-action[disabled] {
        cursor: not-allowed;
        opacity: 0.45;
      }

      .wxwmoe-translate-button {
        justify-content: center;
      }

      .wxwmoe-translate-button.is-busy svg {
        animation: wxwmoe-translate-pulse 0.8s ease-in-out infinite alternate;
      }

      .wxwmoe-translate-menu-toggle {
        justify-content: center;
        min-width: 18px;
      }

      .wxwmoe-translate-button svg,
      .wxwmoe-translate-menu-toggle svg {
        fill: currentColor;
        height: 16px;
        pointer-events: none;
        width: 16px;
      }

      .wxwmoe-translate-menu-toggle svg {
        height: 12px;
        width: 12px;
      }

      .wxwmoe-translate-menu {
        background: var(--dropdown-background-color, var(--surface-background-color, #20202c));
        border: 1px solid var(--dropdown-border-color, var(--color-accent-lines, rgba(211, 72, 127, 0.24)));
        border-radius: 14px;
        box-shadow: var(--dropdown-shadow, 0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.25));
        color: var(--color-fg, #fff);
        color-scheme: dark light;
        display: grid;
        gap: 10px;
        left: 0;
        max-height: calc(100vh - 16px);
        overflow: auto;
        padding: 12px;
        position: fixed;
        top: 0;
        width: min(280px, calc(100vw - 16px));
        z-index: 2147483646;
      }

      .wxwmoe-translate-menu[hidden] {
        display: none;
      }

      .wxwmoe-translate-menu label {
        display: grid;
        font-size: 12px;
        font-weight: 600;
        gap: 6px;
      }

      .wxwmoe-translate-menu select {
        appearance: none;
        background: var(--surface-variant-background-color, var(--color-content-secondary-bg, #292938));
        border: 1px solid var(--color-accent-lines, rgba(211, 72, 127, 0.24));
        border-radius: 10px;
        color: inherit;
        font: inherit;
        min-height: 34px;
        padding: 6px 10px;
        width: 100%;
      }

      .wxwmoe-translate-menu select option {
        background: var(--surface-background-color, #20202c);
        color: var(--color-fg, #fff);
      }

      .wxwmoe-translate-menu select:focus,
      .wxwmoe-translate-menu-action:focus,
      .wxwmoe-translate-button:focus,
      .wxwmoe-translate-menu-toggle:focus {
        outline: 2px solid var(--color-accent-lines, rgba(211, 72, 127, 0.28));
        outline-offset: 1px;
      }

      .wxwmoe-translate-menu-action {
        background: var(--color-accent-bg, rgba(211, 72, 127, 0.14));
        border: 1px solid var(--color-accent-lines, rgba(211, 72, 127, 0.24));
        border-radius: 10px;
        color: var(--color-accent, #d3487f);
        justify-content: center;
        padding: 8px 10px;
        width: 100%;
      }

      .wxwmoe-translate-checkbox {
        align-items: flex-start;
        display: flex;
        font-size: 12px;
        font-weight: 500;
        gap: 8px;
        line-height: 1.35;
      }

      .wxwmoe-translate-checkbox input {
        accent-color: var(--color-accent, #d3487f);
        margin: 2px 0 0;
      }

      .wxwmoe-translate-status {
        color: var(--color-fg-muted, rgba(255, 255, 255, 0.7));
        font-size: 12px;
        line-height: 1.35;
      }

      .wxwmoe-translate-status[data-tone="error"] {
        color: var(--color-reject, #df405a);
      }

      .wxwmoe-translate-status[data-tone="success"] {
        color: var(--color-accent, #d3487f);
      }

      .wxwmoe-translate-hint {
        color: var(--color-fg-muted, rgba(255, 255, 255, 0.58));
        font-size: 11px;
        line-height: 1.35;
      }

      .wxwmoe-visually-hidden {
        border: 0;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        height: 1px;
        margin: -1px;
        overflow: hidden;
        padding: 0;
        position: absolute;
        white-space: nowrap;
        width: 1px;
      }

      @keyframes wxwmoe-translate-pulse {
        from {
          opacity: 0.52;
          transform: scale(0.92);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
    `);
  }

  function installGlobalListeners() {
    document.addEventListener('click', (event) => {
      pruneDetachedControls();

      for (const control of controls) {
        if (!control.root.contains(event.target) && !control.menu.contains(event.target)) {
          closeMenu(control);
        }
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        for (const control of controls) {
          closeMenu(control);
        }
      }

      if (!event.ctrlKey || !event.altKey || event.key.toLowerCase() !== 't') {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.matches(SELECTORS.textarea)) {
        return;
      }

      const composeForm = target.closest(SELECTORS.composeForm);
      const control = composeForm ? controlByComposeForm.get(composeForm) : null;
      if (!control || control.translateButton.disabled) {
        return;
      }

      event.preventDefault();
      handleTranslate(control);
    });

    window.addEventListener('resize', positionVisibleMenus);
    window.addEventListener('scroll', positionVisibleMenus, true);
  }

  function scanForComposeForms(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return;
    }

    const composeForms = [];
    if (root instanceof HTMLElement && root.matches(SELECTORS.composeForm)) {
      composeForms.push(root);
    }
    composeForms.push(...root.querySelectorAll(SELECTORS.composeForm));

    for (const composeForm of composeForms) {
      ensureControls(composeForm);
    }
  }

  function ensureControls(composeForm) {
    const buttons = composeForm.querySelector(SELECTORS.buttons);
    if (!buttons || buttons.querySelector('.wxwmoe-translate')) {
      return;
    }

    const control = createControls(composeForm, buttons);
    const counter = buttons.querySelector(SELECTORS.counter);

    if (counter) {
      buttons.insertBefore(control.root, counter);
    } else {
      buttons.appendChild(control.root);
    }

    controls.add(control);
    controlByComposeForm.set(composeForm, control);
  }

  function createControls(composeForm, buttons) {
    const settings = loadSettings();
    const root = document.createElement('div');
    root.className = 'wxwmoe-translate';

    const translateButton = document.createElement('button');
    translateButton.type = 'button';
    translateButton.className = 'wxwmoe-translate-button';
    translateButton.title = 'Translate the composer text (Ctrl+Alt+T)';
    translateButton.setAttribute('aria-label', 'Translate the composer text');
    translateButton.innerHTML = `${TRANSLATE_ICON}<span class="wxwmoe-visually-hidden">Translate</span>`;

    const undoButton = document.createElement('button');
    undoButton.type = 'button';
    undoButton.className = 'wxwmoe-translate-menu-action';
    undoButton.textContent = 'Undo last translation';
    undoButton.title = 'Restore the text from before the last translation';
    undoButton.disabled = true;

    const menuToggle = document.createElement('button');
    menuToggle.type = 'button';
    menuToggle.className = 'wxwmoe-translate-menu-toggle';
    menuToggle.title = 'Translation options';
    menuToggle.setAttribute('aria-label', 'Open translation options');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.innerHTML = `${CHEVRON_ICON}<span class="wxwmoe-visually-hidden">Options</span>`;

    const menu = document.createElement('div');
    menu.className = 'wxwmoe-translate-menu';
    menu.hidden = true;

    const sourceLabel = document.createElement('label');
    sourceLabel.textContent = 'Source language';
    const sourceSelect = buildSelect(LANGUAGES, settings.sourceLang);
    sourceLabel.appendChild(sourceSelect);

    const targetLabel = document.createElement('label');
    targetLabel.textContent = 'Target language';
    const targetSelect = buildSelect(TARGET_LANGUAGES, settings.targetLang);
    targetLabel.appendChild(targetSelect);

    const capitalizationLabel = document.createElement('label');
    capitalizationLabel.textContent = 'Capitalization';
    const capitalizationSelect = buildSelect(CAPITALIZATION_OPTIONS, settings.capitalization);
    capitalizationLabel.appendChild(capitalizationSelect);

    const preserveLabel = document.createElement('label');
    preserveLabel.className = 'wxwmoe-translate-checkbox';
    const preserveCheckbox = document.createElement('input');
    preserveCheckbox.type = 'checkbox';
    preserveCheckbox.checked = settings.preserveTokens;
    const preserveText = document.createElement('span');
    preserveText.textContent = 'Protect mentions, hashtags, links, and :emoji:';
    preserveLabel.appendChild(preserveCheckbox);
    preserveLabel.appendChild(preserveText);

    const status = document.createElement('div');
    status.className = 'wxwmoe-translate-status';
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Ready to translate.';

    const hint = document.createElement('div');
    hint.className = 'wxwmoe-translate-hint';
    hint.textContent = 'Shortcut: Ctrl+Alt+T while the textarea is focused.';

    menu.append(undoButton, sourceLabel, targetLabel, capitalizationLabel, preserveLabel, status, hint);
    root.append(translateButton, menuToggle);
    document.body.appendChild(menu);

    const control = {
      composeForm,
      buttons,
      root,
      menu,
      translateButton,
      undoButton,
      menuToggle,
      sourceSelect,
      targetSelect,
      capitalizationSelect,
      preserveCheckbox,
      status,
    };

    translateButton.addEventListener('click', () => {
      handleTranslate(control);
    });

    undoButton.addEventListener('click', () => {
      handleUndo(control);
    });

    menuToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleMenu(control);
    });

    sourceSelect.addEventListener('change', () => {
      saveSetting(STORAGE_KEYS.sourceLang, sourceSelect.value);
      syncControls();
    });

    targetSelect.addEventListener('change', () => {
      saveSetting(STORAGE_KEYS.targetLang, targetSelect.value);
      syncControls();
    });

    capitalizationSelect.addEventListener('change', () => {
      saveSetting(STORAGE_KEYS.capitalization, capitalizationSelect.value);
      syncControls();
    });

    preserveCheckbox.addEventListener('change', () => {
      saveSetting(STORAGE_KEYS.preserveTokens, preserveCheckbox.checked);
      syncControls();
    });

    return control;
  }

  function buildSelect(options, selectedValue) {
    const select = document.createElement('select');
    for (const option of options) {
      const optionElement = document.createElement('option');
      optionElement.value = option.code;
      optionElement.textContent = option.label;
      optionElement.selected = option.code === selectedValue;
      select.appendChild(optionElement);
    }
    return select;
  }

  function closeOtherMenus(currentControl) {
    for (const control of controls) {
      if (control !== currentControl) {
        closeMenu(control);
      }
    }
  }

  function pruneDetachedControls() {
    for (const control of Array.from(controls)) {
      if (document.body.contains(control.root)) {
        continue;
      }

      closeMenu(control);
      control.menu.remove();
      controls.delete(control);
    }
  }

  function toggleMenu(control) {
    if (control.menu.hidden) {
      openMenu(control);
      return;
    }

    closeMenu(control);
  }

  function openMenu(control) {
    closeOtherMenus(control);
    control.menu.hidden = false;
    control.menuToggle.setAttribute('aria-expanded', 'true');
    positionMenu(control);
  }

  function closeMenu(control) {
    control.menu.hidden = true;
    control.menu.style.visibility = '';
    control.menuToggle.setAttribute('aria-expanded', 'false');
  }

  function positionVisibleMenus() {
    pruneDetachedControls();

    for (const control of controls) {
      if (!control.menu.hidden) {
        positionMenu(control);
      }
    }
  }

  function positionMenu(control) {
    if (control.menu.hidden) {
      return;
    }

    const margin = 8;
    const gap = 8;
    const anchor = control.menuToggle.getBoundingClientRect();
    control.menu.style.visibility = 'hidden';

    const menuRect = control.menu.getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;

    const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
    const left = clamp(anchor.right - menuWidth, margin, maxLeft);

    const availableAbove = anchor.top - gap - margin;
    const availableBelow = window.innerHeight - anchor.bottom - gap - margin;
    let top;

    if (availableAbove >= menuHeight || availableAbove >= availableBelow) {
      top = clamp(anchor.top - menuHeight - gap, margin, Math.max(margin, window.innerHeight - menuHeight - margin));
    } else {
      top = clamp(anchor.bottom + gap, margin, Math.max(margin, window.innerHeight - menuHeight - margin));
    }

    control.menu.style.left = `${Math.round(left)}px`;
    control.menu.style.top = `${Math.round(top)}px`;
    control.menu.style.visibility = '';
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function loadSettings() {
    return {
      sourceLang: GM_getValue(STORAGE_KEYS.sourceLang, DEFAULT_SETTINGS.sourceLang),
      targetLang: GM_getValue(STORAGE_KEYS.targetLang, DEFAULT_SETTINGS.targetLang),
      capitalization: GM_getValue(STORAGE_KEYS.capitalization, DEFAULT_SETTINGS.capitalization),
      preserveTokens: GM_getValue(STORAGE_KEYS.preserveTokens, DEFAULT_SETTINGS.preserveTokens),
    };
  }

  function saveSetting(key, value) {
    GM_setValue(key, value);
  }

  function syncControls() {
    pruneDetachedControls();
    const settings = loadSettings();

    for (const control of controls) {
      control.sourceSelect.value = settings.sourceLang;
      control.targetSelect.value = settings.targetLang;
      control.capitalizationSelect.value = settings.capitalization;
      control.preserveCheckbox.checked = settings.preserveTokens;
    }
  }

  async function handleTranslate(control) {
    const textarea = getTextarea(control.composeForm);
    if (!textarea) {
      setStatus(control, 'Could not find the text box to translate.', 'error');
      return;
    }

    const originalText = textarea.value;
    if (!originalText.trim()) {
      setStatus(control, 'Write something first.', 'error');
      return;
    }

    const settings = loadSettings();
    setBusy(control, true);
    closeMenu(control);

    try {
      const result = await translateDraft(originalText, settings);
      setTextareaValue(textarea, result.text);
      originalTextByTextarea.set(textarea, originalText);
      control.undoButton.disabled = false;

      const detectedLabel = findLanguageLabel(result.detectedSource || settings.sourceLang);
      const targetLabel = findLanguageLabel(settings.targetLang);
      setStatus(control, `Detected: ${detectedLabel}. Translated to ${targetLabel}.`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Translation failed.';
      setStatus(control, message, 'error');
    } finally {
      setBusy(control, false);
    }
  }

  function handleUndo(control) {
    const textarea = getTextarea(control.composeForm);
    if (!textarea) {
      setStatus(control, 'Could not find the text box to restore.', 'error');
      return;
    }

    const originalText = originalTextByTextarea.get(textarea);
    if (typeof originalText !== 'string') {
      setStatus(control, 'There is no previous translation to undo yet.', 'error');
      control.undoButton.disabled = true;
      return;
    }

    setTextareaValue(textarea, originalText);
    originalTextByTextarea.delete(textarea);
    control.undoButton.disabled = true;
    setStatus(control, 'Original text restored.', 'success');
  }

  function setBusy(control, isBusy) {
    control.translateButton.disabled = isBusy;
    control.menuToggle.disabled = isBusy;
    control.translateButton.classList.toggle('is-busy', isBusy);
  }

  function setStatus(control, message, tone) {
    control.status.textContent = message;
    control.status.dataset.tone = tone || '';

    if (!control.menu.hidden) {
      positionMenu(control);
    }
  }

  function getTextarea(composeForm) {
    return composeForm.querySelector(SELECTORS.textarea);
  }

  async function translateDraft(text, settings) {
    const prepared = settings.preserveTokens ? protectSpecialTokens(text) : { text, tokens: [] };
    const translation = await translatePreservingLineBreaks(prepared.text, settings.sourceLang, settings.targetLang);
    let translatedText = applyCapitalization(
      translation.text,
      settings.capitalization,
      settings.targetLang
    );
    translatedText = restoreProtectedTokens(translatedText, prepared.tokens);

    return {
      text: translatedText,
      detectedSource: translation.detectedSource,
    };
  }

  async function translatePreservingLineBreaks(text, sourceLang, targetLang) {
    const initial = await requestTranslation(text, sourceLang, targetLang);
    if (hasMatchingLineBreaks(text, initial.text)) {
      return initial;
    }

    const parts = text.split(/(\r\n|\n|\r)/);
    const translatedParts = [];
    let detectedSource = initial.detectedSource;

    for (const part of parts) {
      if (part === '\r\n' || part === '\n' || part === '\r') {
        translatedParts.push(part);
        continue;
      }

      if (!part) {
        translatedParts.push(part);
        continue;
      }

      const segments = part.match(/^(\s*)(.*?)(\s*)$/s);
      const leading = segments ? segments[1] : '';
      const core = segments ? segments[2] : part;
      const trailing = segments ? segments[3] : '';

      if (!core) {
        translatedParts.push(part);
        continue;
      }

      const translated = await requestTranslation(core, sourceLang, targetLang);
      detectedSource = detectedSource || translated.detectedSource;
      translatedParts.push(`${leading}${translated.text}${trailing}`);
    }

    return {
      text: translatedParts.join(''),
      detectedSource,
    };
  }

  function hasMatchingLineBreaks(originalText, translatedText) {
    const originalBreaks = originalText.match(/\r\n|\n|\r/g) || [];
    const translatedBreaks = translatedText.match(/\r\n|\n|\r/g) || [];

    if (originalBreaks.length !== translatedBreaks.length) {
      return false;
    }

    return originalBreaks.every((value, index) => value === translatedBreaks[index]);
  }

  function protectSpecialTokens(text) {
    const tokens = [];
    const protectedText = text.replace(PROTECTED_TEXT_PATTERN, (match) => {
      const token = `__WXWMOE_TOKEN_${tokens.length}__`;
      tokens.push({ token, value: match });
      return token;
    });

    return {
      text: protectedText,
      tokens,
    };
  }

  function restoreProtectedTokens(text, tokens) {
    let restored = text;
    for (const tokenEntry of tokens) {
      restored = restored.replace(new RegExp(escapeRegExp(tokenEntry.token), 'gi'), tokenEntry.value);
    }
    return restored;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyCapitalization(text, mode, targetLang) {
    const locale = normalizeLocale(targetLang);
    if (mode === 'lower') {
      return text.toLocaleLowerCase(locale);
    }
    if (mode === 'upper') {
      return text.toLocaleUpperCase(locale);
    }
    return text;
  }

  function normalizeLocale(languageCode) {
    if (!languageCode || languageCode === 'auto') {
      return undefined;
    }
    return languageCode;
  }

  async function requestTranslation(text, sourceLang, targetLang) {
    if (!text) {
      return { text: '', detectedSource: sourceLang };
    }

    const payload = new URLSearchParams();
    payload.set('client', 'gtx');
    payload.set('sl', sourceLang);
    payload.set('tl', targetLang);
    payload.set('hl', targetLang);
    payload.append('dt', 't');
    payload.set('dj', '1');
    payload.set('source', 'input');
    payload.set('q', text);

    const responseText = await httpRequest({
      method: 'POST',
      url: 'https://translate.googleapis.com/translate_a/single',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      data: payload.toString(),
      timeout: 30000,
    });

    let parsed;
    try {
      parsed = JSON.parse(responseText.replace(/^\)\]\}'\s*/, ''));
    } catch (error) {
      throw new Error('The translator response could not be parsed.');
    }

    const translatedText = extractTranslatedText(parsed);
    const detectedSource = extractDetectedSource(parsed) || sourceLang;

    if (typeof translatedText !== 'string' || (!translatedText && text.trim())) {
      throw new Error('No valid translation was returned.');
    }

    return {
      text: translatedText,
      detectedSource,
    };
  }

  function extractTranslatedText(parsed) {
    if (parsed && Array.isArray(parsed.sentences)) {
      return parsed.sentences.map((sentence) => sentence.trans || '').join('');
    }

    if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
      return parsed[0].map((entry) => entry[0] || '').join('');
    }

    return '';
  }

  function extractDetectedSource(parsed) {
    if (parsed && typeof parsed.src === 'string') {
      return parsed.src;
    }

    if (Array.isArray(parsed) && typeof parsed[2] === 'string') {
      return parsed[2];
    }

    return '';
  }

  function findLanguageLabel(code) {
    const entry = LANGUAGES.find((language) => language.code.toLowerCase() === String(code).toLowerCase());
    return entry ? entry.label : code;
  }

  function httpRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...options,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }

          reject(new Error(`The translator returned ${response.status}.`));
        },
        onerror: () => {
          reject(new Error('No response from the translation service.'));
        },
        ontimeout: () => {
          reject(new Error('Translation timed out.'));
        },
      });
    });
  }

  function setTextareaValue(textarea, value) {
    const prototype = Object.getPrototypeOf(textarea);
    const descriptor =
      Object.getOwnPropertyDescriptor(prototype, 'value') ||
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(textarea, value);
    } else {
      textarea.value = value;
    }

    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    textarea.focus();
  }
})();

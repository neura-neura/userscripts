// ==UserScript==
// @name         Crunchyroll Subtitle Resizer
// @namespace    https://github.com/neura-neura/userscripts
// @version      1.0
// @description  Forces clean Crunchyroll playback and renders adjustable ASS subtitles, annotations, and local subtitle files
// @author       neura-neura
// @homepageURL  https://github.com/neura-neura/userscripts
// @supportURL   https://github.com/neura-neura/userscripts/issues
// @match        *://*.crunchyroll.com/*
// @match        *://static.crunchyroll.com/vilos-v2/web/vilos/player.html*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // =================================================================================
    // --- USER SETTINGS: Adjust the values below to customize your subtitles ---
    // =================================================================================

    // 1. SUBTITLE SIZE
    // Controls the overall size of the subtitles.
    // Use values less than 1.0 to make them smaller, and greater than 1.0 to make them larger.
    // Examples:
    // 0.8 = 80% size (Smaller)
    // 0.7 = 70% size (Even smaller)
    // 1.0 = 100% size (Default)
    // 1.2 = 120% size (Larger)
    const SUBTITLE_SCALE = 0.8;


    // 2. VERTICAL POSITION
    // Adjust this if the subtitles are too high or too low after resizing.
    // It moves the subtitle block up or down from the bottom of the screen.
    // Examples:
    // "1%"  (Default - slightly raised from the very bottom)
    // "0%"  (At the very bottom edge)
    // "-2%" (Slightly lower, potentially cutting into the controls area)
    // "5%"  (Higher up on the screen)
    const VERTICAL_POSITION = "1%";


    // 3. GENERATED SUBTITLES
    // Crunchyroll may serve some subtitles burned into the video. When this is enabled,
    // the script asks the player for the clean video stream and renders the matching
    // subtitle file in an adjustable overlay.
    const FORCE_CLEAN_STREAM_FOR_HARDSUBS = true;
    const GENERATED_SUBTITLE_OVERLAY = true;
    const GENERATED_SUBTITLE_LANGUAGE = "es-419"; // Use "auto" to infer from the page/player.
    const GENERATED_SUBTITLE_VERTICAL_POSITION = "4%";


    // 4. DEBUG MODE
    // Keep this enabled while troubleshooting. Filter the browser console by [CRSR].
    const DEBUG = false;
    const DEBUG_VERBOSE = false;
    const HEURISTIC_TEXT_OVERLAYS = true;
    const HEURISTIC_SCAN_INTERVAL_MS = 500;
    const HEURISTIC_TEXT_SELECTOR = 'div, span, p, b, i, em, strong, font, ruby, rt, rb, h1, h2, h3, h4, h5, h6, [role="text"]';


    // =================================================================================
    // --- SCRIPT LOGIC: No need to edit below this line ---
    // =================================================================================

    const STYLE_ID = 'crunchyroll-subtitle-resizer-style';
    const PROCESSED_ATTR = 'data-crsr-processed';
    const DEBUG_PREFIX = '[CRSR]';
    const DEBUG_MAX_ITEMS = 30;
    const HEURISTIC_ATTR = 'data-crsr-heuristic';
    const DEBUG_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const NETWORK_MAX_RECORDS = 80;
    const NETWORK_BODY_SNIPPET_MAX_CHARS = 5000;
    const MANIFEST_URL_PATTERN = /\/manifest\.mpd(?:[?#]|$)|\.m3u8(?:[?#]|$)/i;
    const SUBTITLE_RESOURCE_PATTERN = /subtitle|caption|timedtext|texttrack|text-track|webvtt|\.vtt|\.ttml|\.srt|\.ass|\.ssa/i;
    const MANIFEST_CONTENT_TYPE_PATTERN = /application\/(?:dash\+xml|x-mpegurl|vnd\.apple\.mpegurl)|mpegurl/i;
    const SUBTITLE_CONTENT_TYPE_PATTERN = /text\/vtt|application\/(?:ttml|x-subrip)|text\/(?:srt|subrip)/i;
    const PLAYBACK_V3_PATTERN = /\/playback\/v3\/[^/]+\/web\/[^/]+\/play(?:[?#]|$)/i;
    const SETTINGS_STORAGE_KEY = 'crsr-generated-subtitle-settings-v2';
    const FONT_STYLESHEET_LINK_ID = 'crsr-subtitle-font-stylesheet';
    const DEFAULT_FONT_STYLESHEET_URL = 'https://cdn.jsdelivr.net/npm/gotham-pro-font@1.0.0/fonts.min.css';
    const FONT_OPTIONS = [
        'GothamPro, sans-serif',
        'Arial, Helvetica, sans-serif',
        'Verdana, Geneva, sans-serif',
        'Tahoma, Geneva, sans-serif',
        'Trebuchet MS, Helvetica, sans-serif',
        'Georgia, serif',
        'Times New Roman, Times, serif',
        'Courier New, Courier, monospace'
    ];
    const DEFAULT_GENERATED_SUBTITLE_SETTINGS = {
        language: GENERATED_SUBTITLE_LANGUAGE,
        scale: 1,
        fontSize: 38,
        verticalPosition: GENERATED_SUBTITLE_VERTICAL_POSITION,
        textColor: '#ffffff',
        backgroundColor: '#000000',
        backgroundOpacity: 0.23,
        fontFamily: 'GothamPro, sans-serif',
        fontStylesheetUrl: DEFAULT_FONT_STYLESHEET_URL,
        fontWeight: 500,
        outlineColor: '#000000',
        outlineWidth: 0,
        shadowColor: '#000000',
        shadowBlur: 7,
        lineHeight: 1.18,
        letterSpacing: 0.2,
        paddingX: 12,
        paddingY: 8,
        borderRadius: 8,
        panelOpen: false
    };
    const generatedSubtitleSettings = loadGeneratedSubtitleSettings();
    const debugState = {
        startedAt: new Date().toISOString(),
        href: location.href,
        readyStateAtStart: document.readyState,
        stylesInjected: 0,
        rootsObserved: 0,
        processRootCalls: 0,
        heuristicScanCalls: 0,
        heuristicCandidatesMatched: 0,
        heuristicCandidatesProcessed: 0,
        shadowRootsKnown: 0,
        lastProbeCount: 0,
        lastSampleCount: 0,
        lastPlaybackAnalysis: null,
        networkRequests: 0,
        networkManifestUrls: 0,
        networkSubtitleLikeUrls: 0,
        networkManifestBodies: 0,
        playbackV3Responses: 0,
        cleanStreamRewrites: 0,
        generatedSubtitleCues: 0,
        generatedAnnotationCues: 0,
        candidatesMatched: 0,
        candidatesProcessed: 0,
        candidatesSkipped: 0,
        lastCandidates: [],
        errors: []
    };
    const networkState = {
        fetchPatched: false,
        xhrPatched: false,
        performanceObserved: false,
        requests: [],
        manifestUrls: [],
        subtitleLikeUrls: [],
        hardsubLocales: [],
        manifestBodies: [],
        subtitleBodies: [],
        jsonBodies: [],
        errors: []
    };
    const playbackState = {
        responses: [],
        lastPlayback: null,
        lastPlaybackSummary: null,
        cleanStreamRewrites: 0,
        selectedSubtitle: null,
        subtitleUrl: null,
        subtitleFormat: null,
        subtitleRawText: '',
        subtitleFileName: '',
        subtitleSource: null,
        localSubtitleOverride: false,
        subtitleStatus: 'idle',
        cues: [],
        annotationCues: [],
        loadPromise: null,
        renderRaf: null,
        overlay: null,
        annotationLayer: null,
        dialogueCanvas: null,
        dialogueCanvasContext: null,
        overlayAnchor: null,
        overlayText: null,
        lastRenderedText: null,
        lastRenderedDialogueKey: null,
        lastNonEmptyDialogueText: '',
        lastNonEmptyDialogueAt: 0,
        lastNonEmptyDialogueVideoTime: 0,
        lastDialogueCanvasSignature: null,
        renderedTextChanges: 0,
        recentRenderedTextChanges: [],
        annotationNodes: new Map(),
        lastAnnotationKeys: '',
        lastOverlayGeometry: null,
        errors: []
    };
    const settingsUiState = {
        root: null,
        toggle: null,
        panel: null,
        controls: {},
        remoteFontFamilies: []
    };
    const knownShadowRoots = new Set();
    const warnedHardsubManifests = new Set();
    let heuristicTimer = null;
    let heuristicInterval = null;
    let runtimeGeneratedSubtitleScale = generatedSubtitleSettings.scale;
    let runtimeGeneratedSubtitleVerticalPosition = generatedSubtitleSettings.verticalPosition;
    let runtimeGeneratedSubtitleLanguage = generatedSubtitleSettings.language;
    const PLAYER_SELECTORS = [
        '#player-container',
        '.video-player-wrapper',
        '.katamariDesktop',
        '.bitmovinplayer-container',
        '.bmpui-ui-player'
    ];
    const SUBTITLE_SELECTORS = [
        '#velocity-canvas',
        '.bmpui-ui-subtitle-overlay',
        '.bmpui-ui-subtitle-region-container',
        '.bmpui-ui-subtitle-region',
        '.bmpui-ui-subtitle-label',
        '[class*="subtitle" i]',
        '[class*="caption" i]',
        '[class*="closed-caption" i]',
        '[class*="text-track" i]',
        '[class*="timedtext" i]',
        '[class*="cue" i]',
        '[data-testid*="subtitle" i]',
        '[data-testid*="caption" i]',
        '[data-testid*="cue" i]'
    ];
    const SUBTITLE_SELECTOR_LIST = SUBTITLE_SELECTORS.join(',');
    const PLAYER_SUBTITLE_SELECTOR_LIST = SUBTITLE_SELECTORS
        .map((selector) => PLAYER_SELECTORS.map((playerSelector) => `${playerSelector} ${selector}`).join(','))
        .join(',');
    const INTERACTIVE_SELECTORS = [
        'button',
        'a',
        'input',
        'select',
        'textarea',
        '[role="button"]',
        '[role="menu"]',
        '[role="menuitem"]',
        '[role="dialog"]',
        '[class*="button" i]',
        '[class*="menu" i]',
        '[class*="tooltip" i]',
        '[class*="popover" i]',
        '[class*="dropdown" i]',
        '[data-testid*="control" i]',
        '[data-testid*="button" i]',
        '[data-testid*="menu" i]'
    ];
    const CONTROLISH_SELECTORS = [
        ...INTERACTIVE_SELECTORS,
        '[id*="accessibility-announcer" i]',
        '[id*="seek" i]',
        '[id*="slider" i]',
        '[class*="accessibility-announcer" i]',
        '[class*="button" i]',
        '[class*="menu" i]',
        '[class*="tooltip" i]',
        '[class*="popover" i]',
        '[class*="dropdown" i]',
        '[class*="seek" i]',
        '[class*="slider" i]',
        '[class*="progress" i]',
        '[class*="scrubber" i]',
        '[class*="time" i]',
        '[class*="volume" i]',
        '[class*="settings" i]',
        '[class*="skip" i]',
        '[data-testid*="control" i]',
        '[data-testid*="button" i]',
        '[data-testid*="menu" i]',
        '[data-testid*="time" i]',
        '[data-testid*="skip" i]'
    ];
    const CONTROLISH_SELECTOR_LIST = CONTROLISH_SELECTORS.join(',');

    const cssSubtitleResize = `
        :root {
            --crsr-subtitle-scale: ${SUBTITLE_SCALE};
            --crsr-vertical-position: ${VERTICAL_POSITION};
            --crsr-generated-subtitle-scale: ${generatedSubtitleSettings.scale};
            --crsr-generated-vertical-position: ${generatedSubtitleSettings.verticalPosition};
            --crsr-generated-text-color: ${generatedSubtitleSettings.textColor};
            --crsr-generated-bg-rgb: ${hexToRgbTuple(generatedSubtitleSettings.backgroundColor)};
            --crsr-generated-bg-opacity: ${generatedSubtitleSettings.backgroundOpacity};
            --crsr-generated-font-size: ${generatedSubtitleSettings.fontSize}px;
            --crsr-generated-font-family: ${cssString(generatedSubtitleSettings.fontFamily)};
            --crsr-generated-font-weight: ${generatedSubtitleSettings.fontWeight};
            --crsr-generated-line-height: ${generatedSubtitleSettings.lineHeight};
            --crsr-generated-letter-spacing: ${generatedSubtitleSettings.letterSpacing}px;
            --crsr-generated-padding-x: ${generatedSubtitleSettings.paddingX}px;
            --crsr-generated-padding-y: ${generatedSubtitleSettings.paddingY}px;
            --crsr-generated-radius: ${generatedSubtitleSettings.borderRadius}px;
            --crsr-generated-text-shadow: ${buildGeneratedTextShadow(generatedSubtitleSettings)};
        }

        video::cue {
            font-size: ${SUBTITLE_SCALE * 100}% !important;
            line-height: 1.2 !important;
        }

        #velocity-canvas {
            transform: scale(${SUBTITLE_SCALE}) !important;
            transform-origin: bottom center !important;
            bottom: ${VERTICAL_POSITION} !important;
            width: 100% !important;
            height: 100% !important;
            object-fit: contain !important;
        }

        #player-container .bmpui-ui-subtitle-overlay,
        #player-container [class*="subtitle" i][class*="overlay" i],
        #player-container [class*="caption" i][class*="overlay" i],
        .video-player-wrapper .bmpui-ui-subtitle-overlay,
        .video-player-wrapper [class*="subtitle" i][class*="overlay" i],
        .video-player-wrapper [class*="caption" i][class*="overlay" i],
        .katamariDesktop .bmpui-ui-subtitle-overlay,
        .katamariDesktop [class*="subtitle" i][class*="overlay" i],
        .katamariDesktop [class*="caption" i][class*="overlay" i] {
            bottom: var(--crsr-vertical-position) !important;
        }

        #player-container .bmpui-ui-subtitle-label,
        .video-player-wrapper .bmpui-ui-subtitle-label,
        .katamariDesktop .bmpui-ui-subtitle-label,
        #player-container [${PROCESSED_ATTR}="true"]:not([${HEURISTIC_ATTR}="true"]),
        .video-player-wrapper [${PROCESSED_ATTR}="true"]:not([${HEURISTIC_ATTR}="true"]),
        .katamariDesktop [${PROCESSED_ATTR}="true"]:not([${HEURISTIC_ATTR}="true"]) {
            scale: var(--crsr-subtitle-scale) !important;
            transform-origin: bottom center !important;
        }

        #crsr-generated-subtitle-overlay {
            position: var(--crsr-generated-overlay-position, absolute) !important;
            left: var(--crsr-generated-video-left, 0px) !important;
            top: var(--crsr-generated-video-top, 0px) !important;
            right: auto !important;
            bottom: auto !important;
            width: var(--crsr-generated-video-width, 100%) !important;
            height: var(--crsr-generated-video-height, 100%) !important;
            pointer-events: none !important;
            overflow: hidden !important;
            contain: layout paint style !important;
            isolation: isolate !important;
            transform: translateZ(0) !important;
            backface-visibility: hidden !important;
            z-index: 2147483646 !important;
        }

        #crsr-generated-annotation-layer {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            pointer-events: none !important;
            overflow: hidden !important;
            z-index: 1 !important;
        }

        #crsr-generated-dialogue-canvas {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            pointer-events: none !important;
            z-index: 2 !important;
            contain: strict !important;
            transform: translateZ(0) !important;
            backface-visibility: hidden !important;
        }

        .crsr-generated-annotation {
            position: absolute !important;
            display: inline-block !important;
            width: max-content !important;
            max-width: 90% !important;
            box-sizing: border-box !important;
            pointer-events: none !important;
            white-space: pre-wrap !important;
            text-align: center !important;
            line-height: 1.15 !important;
            background: transparent !important;
            font-synthesis-weight: auto !important;
            text-rendering: geometricPrecision !important;
            backface-visibility: hidden !important;
            will-change: transform !important;
            overflow-wrap: anywhere !important;
            word-break: normal !important;
        }

        #crsr-generated-subtitle-anchor {
            position: absolute !important;
            left: 0 !important;
            right: 0 !important;
            bottom: var(--crsr-generated-vertical-position) !important;
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 4vw !important;
            transform: translateZ(0) !important;
            transform-origin: bottom center !important;
            text-align: center !important;
            box-sizing: border-box !important;
            pointer-events: none !important;
            contain: layout style !important;
            z-index: 3 !important;
        }

        #crsr-generated-subtitle-text {
            position: absolute !important;
            left: 50% !important;
            bottom: 0 !important;
            display: inline-block !important;
            width: auto !important;
            max-width: calc(100% - 8vw) !important;
            transform: translateX(-50%) translateZ(0) scale(var(--crsr-generated-subtitle-scale)) !important;
            transform-origin: bottom center !important;
            color: var(--crsr-generated-text-color) !important;
            background: rgb(var(--crsr-generated-bg-rgb) / var(--crsr-generated-bg-opacity)) !important;
            font-family: var(--crsr-generated-font-family) !important;
            font-size: var(--crsr-generated-font-size) !important;
            font-weight: var(--crsr-generated-font-weight) !important;
            font-optical-sizing: auto !important;
            font-synthesis-weight: auto !important;
            font-variation-settings: 'wght' var(--crsr-generated-font-weight) !important;
            line-height: var(--crsr-generated-line-height) !important;
            letter-spacing: var(--crsr-generated-letter-spacing) !important;
            padding: var(--crsr-generated-padding-y) var(--crsr-generated-padding-x) !important;
            border-radius: var(--crsr-generated-radius) !important;
            text-align: center !important;
            white-space: pre-wrap !important;
            text-shadow: var(--crsr-generated-text-shadow) !important;
            text-rendering: geometricPrecision !important;
            backface-visibility: hidden !important;
            will-change: transform !important;
            contain: layout paint style !important;
            word-break: normal !important;
            overflow-wrap: anywhere !important;
        }

        #crsr-generated-subtitle-text *,
        #crsr-generated-subtitle-text i,
        #crsr-generated-subtitle-text em,
        #crsr-generated-subtitle-text u,
        #crsr-generated-subtitle-text font {
            font-family: inherit !important;
            font-size: inherit !important;
            font-optical-sizing: inherit !important;
            font-synthesis-weight: inherit !important;
            font-variation-settings: inherit !important;
            line-height: inherit !important;
            letter-spacing: inherit !important;
            text-shadow: inherit !important;
        }

        #crsr-generated-subtitle-text i,
        #crsr-generated-subtitle-text em {
            display: inline-block !important;
            font-style: normal !important;
            font-weight: var(--crsr-generated-font-weight) !important;
            transform: skewX(-12deg) !important;
            transform-origin: center !important;
        }

        #crsr-settings-root {
            position: fixed !important;
            right: 16px !important;
            bottom: 88px !important;
            z-index: 2147483647 !important;
            color: #f8fafc !important;
            font-family: Arial, Helvetica, sans-serif !important;
            font-size: 12px !important;
            line-height: 1.3 !important;
        }

        #crsr-settings-root,
        #crsr-settings-root * {
            box-sizing: border-box !important;
        }

        #crsr-settings-toggle {
            width: 44px !important;
            height: 32px !important;
            border: 1px solid rgba(255, 255, 255, 0.18) !important;
            border-radius: 6px !important;
            background: rgba(17, 24, 39, 0.92) !important;
            color: #f8fafc !important;
            cursor: pointer !important;
            font: 700 11px/1 Arial, Helvetica, sans-serif !important;
            letter-spacing: 0 !important;
        }

        #crsr-settings-panel {
            display: none !important;
            position: absolute !important;
            right: 0 !important;
            bottom: 40px !important;
            width: min(330px, calc(100vw - 32px)) !important;
            max-height: min(620px, calc(100vh - 120px)) !important;
            overflow: auto !important;
            padding: 12px !important;
            border: 1px solid rgba(255, 255, 255, 0.16) !important;
            border-radius: 8px !important;
            background: rgba(15, 23, 42, 0.96) !important;
            box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45) !important;
            backdrop-filter: blur(8px) !important;
        }

        #crsr-settings-root[data-open="true"] #crsr-settings-panel {
            display: block !important;
        }

        .crsr-settings-header {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            gap: 8px !important;
            margin-bottom: 10px !important;
        }

        .crsr-settings-title {
            font-size: 12px !important;
            font-weight: 700 !important;
            color: #f8fafc !important;
        }

        .crsr-settings-close {
            width: 28px !important;
            height: 28px !important;
            border: 0 !important;
            border-radius: 6px !important;
            background: rgba(255, 255, 255, 0.08) !important;
            color: #f8fafc !important;
            cursor: pointer !important;
            font-size: 16px !important;
            line-height: 1 !important;
        }

        .crsr-settings-grid {
            display: grid !important;
            grid-template-columns: 1fr !important;
            gap: 10px !important;
        }

        .crsr-settings-field {
            display: grid !important;
            grid-template-columns: 92px minmax(0, 1fr) 42px !important;
            align-items: center !important;
            gap: 8px !important;
        }

        .crsr-settings-field label {
            color: #cbd5e1 !important;
            font-size: 11px !important;
            font-weight: 600 !important;
        }

        .crsr-settings-field output {
            color: #e2e8f0 !important;
            font-size: 11px !important;
            text-align: right !important;
            font-variant-numeric: tabular-nums !important;
        }

        .crsr-settings-field input[type="range"] {
            width: 100% !important;
        }

        .crsr-settings-field input[type="color"] {
            width: 38px !important;
            height: 28px !important;
            padding: 0 !important;
            border: 1px solid rgba(255, 255, 255, 0.16) !important;
            border-radius: 6px !important;
            background: transparent !important;
        }

        .crsr-settings-field select,
        .crsr-settings-field input[type="text"],
        .crsr-settings-field input[type="url"],
        .crsr-settings-field input[type="number"] {
            width: 100% !important;
            min-width: 0 !important;
            height: 28px !important;
            border: 1px solid rgba(255, 255, 255, 0.16) !important;
            border-radius: 6px !important;
            background: rgba(2, 6, 23, 0.72) !important;
            color: #f8fafc !important;
            padding: 0 8px !important;
            font-size: 12px !important;
        }

        .crsr-settings-field.crsr-wide {
            grid-template-columns: 92px minmax(0, 1fr) !important;
        }

        .crsr-settings-actions {
            display: flex !important;
            flex-wrap: wrap !important;
            justify-content: flex-end !important;
            gap: 8px !important;
            margin-top: 12px !important;
        }

        .crsr-settings-action {
            height: 30px !important;
            border: 1px solid rgba(255, 255, 255, 0.16) !important;
            border-radius: 6px !important;
            background: rgba(255, 255, 255, 0.08) !important;
            color: #f8fafc !important;
            padding: 0 10px !important;
            cursor: pointer !important;
            font-size: 12px !important;
        }

        html.crsr-generated-subtitle-active .bmpui-ui-subtitle-overlay,
        html.crsr-generated-subtitle-active .bmpui-ui-subtitle-label,
        html.crsr-generated-subtitle-active [class*="subtitle" i][class*="overlay" i],
        html.crsr-generated-subtitle-active [class*="caption" i][class*="overlay" i] {
            display: none !important;
        }
    `;

    debugLog('boot', {
        href: location.href,
        readyState: document.readyState,
        scale: SUBTITLE_SCALE,
        verticalPosition: VERTICAL_POSITION,
        generatedSubtitleVerticalPosition: GENERATED_SUBTITLE_VERTICAL_POSITION,
        unsafeWindowAvailable: DEBUG_WINDOW !== window,
        userAgent: navigator.userAgent
    });

    installNetworkHooks();
    installDebugApi();
    injectStyle(document, cssSubtitleResize);
    applyGeneratedSubtitleSettings({ save: false });
    loadGeneratedFontStylesheet(generatedSubtitleSettings.fontStylesheetUrl, {
        quiet: true,
        selectFirstFamily: false
    });
    installFullscreenHooks();
    patchAttachShadow();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
        startObserver();
    }

    function injectStyle(root, css) {
        if (root === document && typeof GM_addStyle === 'function') {
            GM_addStyle(css);
            debugState.stylesInjected += 1;
            debugLog('style injected with GM_addStyle');
            return;
        }

        const host = root.head || root.documentElement || root;
        if (!host || root.querySelector?.(`#${STYLE_ID}`)) {
            debugVerbose('style skipped', {
                reason: !host ? 'no-host' : 'already-present',
                root: describeRoot(root)
            });
            return;
        }

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        host.appendChild(style);
        debugState.stylesInjected += 1;
        debugLog('style injected', { root: describeRoot(root) });
    }

    function patchAttachShadow() {
        if (!Element.prototype.attachShadow || Element.prototype.attachShadow.__crsrPatched) {
            debugVerbose('attachShadow patch skipped', {
                available: Boolean(Element.prototype.attachShadow),
                alreadyPatched: Boolean(Element.prototype.attachShadow?.__crsrPatched)
            });
            return;
        }

        const originalAttachShadow = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(init) {
            const shadowRoot = originalAttachShadow.call(this, init);
            debugVerbose('shadow root created', describeElement(this));
            registerShadowRoot(shadowRoot);
            scheduleHeuristicScan('shadow-root-created');
            return shadowRoot;
        };
        Element.prototype.attachShadow.__crsrPatched = true;
        debugLog('attachShadow patched');
    }

    function startObserver() {
        debugLog('startObserver', {
            readyState: document.readyState,
            playerMatches: countMatches(PLAYER_SELECTORS.join(',')),
            subtitleMatches: countMatches(PLAYER_SUBTITLE_SELECTOR_LIST),
            videos: countMatches('video'),
            canvases: countMatches('canvas')
        });

        processRoot(document);
        observeRoot(document);
        registerExistingShadowRoots(document);
        ensureSettingsUi();
        startHeuristicInterval();
        scheduleHeuristicScan('start-observer');

        printSummarySoon();
    }

    function observeRoot(root) {
        if (root.__crsrObserver) {
            debugVerbose('observer skipped', {
                reason: 'already-observing',
                root: describeRoot(root)
            });
            return;
        }

        const observer = new MutationObserver((mutations) => {
            let shouldRunHeuristicScan = false;

            for (const mutation of mutations) {
                if (isCrsrOwnedNode(mutation.target)) {
                    continue;
                }

                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (isCrsrOwnedNode(node)) {
                            continue;
                        }

                        if (node.nodeType === Node.ELEMENT_NODE) {
                            processRoot(node);
                            registerExistingShadowRoots(node);
                            shouldRunHeuristicScan = true;
                        } else if (node.nodeType === Node.TEXT_NODE) {
                            shouldRunHeuristicScan = true;
                        }
                    }
                    continue;
                }

                if (mutation.target.nodeType === Node.ELEMENT_NODE) {
                    processRoot(mutation.target);
                    shouldRunHeuristicScan = true;
                } else if (mutation.type === 'characterData') {
                    shouldRunHeuristicScan = true;
                }
            }

            if (shouldRunHeuristicScan) {
                scheduleHeuristicScan('mutation');
            }
        });

        observer.observe(root, {
            attributes: true,
            attributeFilter: ['aria-live', 'class', 'data-testid', 'id'],
            characterData: true,
            childList: true,
            subtree: true
        });

        root.__crsrObserver = observer;
        debugState.rootsObserved += 1;
        debugLog('observer installed', { root: describeRoot(root) });
    }

    function isCrsrOwnedNode(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node
            : node?.parentElement;
        if (!element?.closest) {
            return false;
        }

        return Boolean(element.closest('#crsr-generated-subtitle-overlay, #crsr-settings-root'));
    }

    function processRoot(root) {
        if (!root.querySelectorAll) {
            debugVerbose('processRoot skipped', {
                reason: 'no-querySelectorAll',
                root: describeRoot(root)
            });
            return;
        }

        debugState.processRootCalls += 1;

        try {
            const matches = root.querySelectorAll(PLAYER_SUBTITLE_SELECTOR_LIST);
            debugState.candidatesMatched += matches.length;
            if (matches.length) {
                debugVerbose('processRoot matches', {
                    count: matches.length,
                    root: describeRoot(root)
                });
            }
            matches.forEach(processCandidate);

            if (root.matches?.(PLAYER_SUBTITLE_SELECTOR_LIST)) {
                debugState.candidatesMatched += 1;
                processCandidate(root);
            }

            scheduleHeuristicScan('process-root');
        } catch (error) {
            debugError('processRoot selector failed', error, {
                root: describeRoot(root),
                selector: PLAYER_SUBTITLE_SELECTOR_LIST
            });
        }
    }

    function processCandidate(element) {
        if (!isSubtitleCandidate(element)) {
            debugState.candidatesSkipped += 1;
            rememberCandidate('skip:not-subtitle-candidate', element);
            return;
        }

        if (element.id === 'velocity-canvas') {
            element.style.setProperty('transform', `scale(${SUBTITLE_SCALE})`, 'important');
            element.style.setProperty('transform-origin', 'bottom center', 'important');
            element.style.setProperty('bottom', VERTICAL_POSITION, 'important');
            debugState.candidatesProcessed += 1;
            rememberCandidate('processed:velocity-canvas', element);
            debugLog('processed velocity canvas', describeElement(element));
            printSummarySoon();
            return;
        }

        if (isOverlay(element)) {
            element.style.setProperty('bottom', VERTICAL_POSITION, 'important');
        }

        if (hasSubtitleChild(element)) {
            debugState.candidatesSkipped += 1;
            rememberCandidate('skip:has-subtitle-child', element);
            debugVerbose('candidate skipped because child will be processed', describeElement(element));
            return;
        }

        element.setAttribute(PROCESSED_ATTR, 'true');
        element.style.setProperty('scale', SUBTITLE_SCALE, 'important');
        element.style.setProperty('transform-origin', 'bottom center', 'important');
        debugState.candidatesProcessed += 1;
        rememberCandidate('processed', element);
        debugLog('processed subtitle candidate', describeElement(element));
        printSummarySoon();
    }

    function isSubtitleCandidate(element) {
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
            return false;
        }

        try {
            if (element.closest(INTERACTIVE_SELECTORS.join(','))) {
                return false;
            }
        } catch (error) {
            debugError('interactive selector failed', error, {
                selector: INTERACTIVE_SELECTORS.join(','),
                element: describeElement(element)
            });
        }

        const marker = [
            element.id,
            element.className?.toString(),
            element.getAttribute('data-testid')
        ].join(' ').toLowerCase();

        return element.id === 'velocity-canvas' ||
            marker.includes('bmpui-ui-subtitle') ||
            marker.includes('subtitle') ||
            marker.includes('caption') ||
            marker.includes('closed-caption') ||
            marker.includes('text-track') ||
            marker.includes('timedtext') ||
            marker.includes('cue');
    }

    function isOverlay(element) {
        const marker = [
            element.className?.toString(),
            element.getAttribute('data-testid')
        ].join(' ').toLowerCase();

        return marker.includes('overlay') ||
            marker.includes('subtitle-region-container') ||
            marker.includes('caption-region-container');
    }

    function hasSubtitleChild(element) {
        return Array.from(element.children).some((child) => child.matches?.(SUBTITLE_SELECTOR_LIST) ||
            child.querySelector?.(SUBTITLE_SELECTOR_LIST));
    }

    function registerShadowRoot(shadowRoot) {
        if (!shadowRoot || knownShadowRoots.has(shadowRoot)) {
            return;
        }

        knownShadowRoots.add(shadowRoot);
        debugState.shadowRootsKnown = knownShadowRoots.size;
        injectStyle(shadowRoot, cssSubtitleResize);
        processRoot(shadowRoot);
        observeRoot(shadowRoot);
        registerExistingShadowRoots(shadowRoot);
    }

    function registerExistingShadowRoots(root) {
        if (!root?.querySelectorAll) {
            return;
        }

        if (root instanceof Element && root.shadowRoot) {
            registerShadowRoot(root.shadowRoot);
        }

        safeQueryAll('*', root).forEach((element) => {
            if (element.shadowRoot) {
                registerShadowRoot(element.shadowRoot);
            }
        });
    }

    function startHeuristicInterval() {
        if (!HEURISTIC_TEXT_OVERLAYS || heuristicInterval) {
            return;
        }

        heuristicInterval = setInterval(() => {
            scheduleHeuristicScan('interval');
        }, HEURISTIC_SCAN_INTERVAL_MS);
        debugLog('heuristic scanner started', {
            intervalMs: HEURISTIC_SCAN_INTERVAL_MS,
            textSelector: HEURISTIC_TEXT_SELECTOR
        });
    }

    function scheduleHeuristicScan(reason) {
        if (!HEURISTIC_TEXT_OVERLAYS || heuristicTimer) {
            return;
        }

        heuristicTimer = setTimeout(() => {
            heuristicTimer = null;
            processHeuristicTextOverlays(reason);
        }, 120);
    }

    function processHeuristicTextOverlays(reason) {
        if (!HEURISTIC_TEXT_OVERLAYS) {
            return [];
        }

        if (isGeneratedSubtitleOverlayActive()) {
            debugVerbose('heuristic scan skipped', {
                reason,
                because: 'generated-subtitle-overlay-active'
            });
            return [];
        }

        debugState.heuristicScanCalls += 1;
        debugState.lastHeuristicReason = reason;
        registerExistingShadowRoots(document);

        const players = getVisiblePlayers();
        const rawCandidates = getHeuristicTextCandidates(players, false);
        const candidates = pruneNestedCandidates(rawCandidates);
        let processedCount = 0;

        debugState.heuristicCandidatesMatched += rawCandidates.length;

        candidates.forEach(({ element }) => {
            if (element.getAttribute(PROCESSED_ATTR) === 'true') {
                return;
            }

            processHeuristicCandidate(element);
            processedCount += 1;
        });

        if (rawCandidates.length || processedCount) {
            debugLog('heuristic scan', {
                reason,
                players: players.length,
                matched: rawCandidates.length,
                selected: candidates.length,
                processed: processedCount,
                samples: candidates.slice(0, 8).map(({ element, player, text }) => ({
                    text,
                    element: describeElement(element),
                    player: describeElement(player).selector
                }))
            });
        }

        if (processedCount) {
            printSummarySoon();
        }

        return candidates;
    }

    function processHeuristicCandidate(element) {
        const computed = getComputedStyle(element);

        element.setAttribute(PROCESSED_ATTR, 'true');
        element.setAttribute(HEURISTIC_ATTR, 'true');
        element.style.setProperty('scale', SUBTITLE_SCALE, 'important');
        element.style.setProperty('transform-origin', 'bottom center', 'important');

        if (computed.display === 'inline') {
            element.style.setProperty('display', 'inline-block', 'important');
        }

        debugState.heuristicCandidatesProcessed += 1;
        debugState.candidatesProcessed += 1;
        rememberCandidate('processed:heuristic-text-overlay', element);
        debugLog('processed heuristic subtitle candidate', describeElement(element));
    }

    function clearHeuristicProcessedElements(reason) {
        const elements = deepQueryAll(`[${HEURISTIC_ATTR}="true"]`);
        let count = 0;

        elements.forEach((element) => {
            if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
                return;
            }

            element.removeAttribute(HEURISTIC_ATTR);
            element.removeAttribute(PROCESSED_ATTR);
            element.style.removeProperty('scale');
            element.style.removeProperty('transform-origin');
            element.style.removeProperty('display');
            count += 1;
        });

        if (count) {
            debugLog('cleared heuristic subtitle candidates', { reason, count });
        }

        return count;
    }

    function isGeneratedSubtitleOverlayActive() {
        return GENERATED_SUBTITLE_OVERLAY &&
            document.documentElement.classList.contains('crsr-generated-subtitle-active') &&
            Boolean(playbackState.cues.length || playbackState.annotationCues.length);
    }

    function getHeuristicTextCandidates(players = getVisiblePlayers(), includeProcessed = false) {
        if (!players.length) {
            return [];
        }

        return deepQueryAll(HEURISTIC_TEXT_SELECTOR).reduce((matches, element) => {
            const match = getHeuristicMatch(element, players, includeProcessed);
            if (match) {
                matches.push(match);
            }
            return matches;
        }, []);
    }

    function getHeuristicMatch(element, players, includeProcessed) {
        if (!(element instanceof HTMLElement)) {
            return null;
        }

        const rect = element.getBoundingClientRect();
        const player = players.find(({ rect: playerRect }) => rectMostlyInside(rect, playerRect));
        if (!player) {
            return null;
        }

        const computed = getComputedStyle(element);
        if (!isHeuristicSubtitleElement(element, rect, computed, player.rect, includeProcessed)) {
            return null;
        }

        return {
            element,
            player: player.element,
            text: normalizeText(element.textContent)
        };
    }

    function isHeuristicSubtitleElement(element, rect, computed, playerRect, includeProcessed) {
        return !getHeuristicRejectReason(element, rect, computed, playerRect, includeProcessed);
    }

    function getHeuristicRejectReason(element, rect, computed, playerRect, includeProcessed) {
        if (!includeProcessed && element.getAttribute(PROCESSED_ATTR) === 'true') {
            return 'already-processed';
        }

        if (!includeProcessed && element.parentElement?.closest(`[${PROCESSED_ATTR}="true"]`)) {
            return 'inside-processed-parent';
        }

        if (element.matches('button, a, input, select, textarea, video, canvas, svg, img, picture, script, style, noscript')) {
            return 'non-text-tag';
        }

        const text = normalizeText(element.textContent);
        if (text.length < 2 || text.length > 260) {
            return 'text-length';
        }

        if (isControlishElement(element)) {
            return 'controlish-element';
        }

        if (isControlishText(text)) {
            return 'controlish-text';
        }

        if (!isVisibleTextElement(rect, computed)) {
            return 'not-visible';
        }

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const horizontalRatio = (centerX - playerRect.left) / playerRect.width;
        const verticalRatio = (centerY - playerRect.top) / playerRect.height;
        const widthRatio = rect.width / playerRect.width;
        const heightRatio = rect.height / playerRect.height;
        const fontSize = Number.parseFloat(computed.fontSize) || 0;
        const directText = getDirectText(element);

        if (horizontalRatio < 0.04 || horizontalRatio > 0.96) {
            return 'outside-horizontal-band';
        }

        if (verticalRatio < 0.42 || verticalRatio > 0.97) {
            return 'outside-vertical-band';
        }

        if (widthRatio > 0.98 && heightRatio > 0.28) {
            return 'too-large';
        }

        if (fontSize < 16 && text.length < 18) {
            return 'small-font-short-text';
        }

        if (widthRatio < 0.015 && text.length <= 4 && fontSize < 20) {
            return 'too-small';
        }

        if (!directText && countVisibleTextChildren(element) > 6) {
            return 'container-with-many-text-children';
        }

        return null;
    }

    function isVisibleTextElement(rect, computed) {
        if (!rect || rect.width < 3 || rect.height < 3) {
            return false;
        }

        if (computed.display === 'none' || computed.visibility === 'hidden' || computed.visibility === 'collapse') {
            return false;
        }

        if (Number.parseFloat(computed.opacity || '1') === 0) {
            return false;
        }

        return true;
    }

    function isControlishElement(element) {
        const ariaLive = element.getAttribute('aria-live');
        if (ariaLive && element.id !== 'velocity-canvas') {
            return true;
        }

        if (element.closest('[aria-hidden="true"]')) {
            return true;
        }

        try {
            return Boolean(element.closest(CONTROLISH_SELECTOR_LIST));
        } catch (error) {
            debugError('controlish selector failed', error, {
                selector: CONTROLISH_SELECTOR_LIST,
                element: describeElement(element)
            });
            return false;
        }
    }

    function isControlishText(text) {
        const normalized = normalizeText(text).toLowerCase();
        const simplified = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        if (/^\d{1,2}:\d{2}(?::\d{2})?(\s*\/\s*\d{1,2}:\d{2}(?::\d{2})?)?$/.test(simplified)) {
            return true;
        }

        if (/^\d+(\.\d+)?x$/.test(simplified) || /^\d+%$/.test(simplified)) {
            return true;
        }

        return [
            'auto',
            'audio',
            'back',
            'calidad',
            'captions',
            'configuracion',
            'continue',
            'continuar',
            'english',
            'episodes',
            'episodios',
            'exit fullscreen',
            'forward',
            'fullscreen',
            'mute',
            'next',
            'normal',
            'off',
            'omitir intro',
            'on',
            'pause',
            'play',
            'previous',
            'quality',
            'rewind',
            'saltar intro',
            'settings',
            'skip intro',
            'speed',
            'subtitles',
            'subtitulos',
            'unmute',
            'velocidad',
            'volume'
        ].includes(simplified);
    }

    function countVisibleTextChildren(element) {
        return Array.from(element.children).filter((child) => {
            const text = normalizeText(child.textContent);
            if (!text || !(child instanceof HTMLElement)) {
                return false;
            }

            const rect = child.getBoundingClientRect();
            const computed = getComputedStyle(child);
            return isVisibleTextElement(rect, computed);
        }).length;
    }

    function getDirectText(element) {
        return normalizeText(Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent)
            .join(' '));
    }

    function pruneNestedCandidates(candidates) {
        return candidates.filter(({ element }) => !candidates.some(({ element: other }) => {
            return other !== element && element.contains(other);
        }));
    }

    function getVisiblePlayers() {
        const found = [
            ...deepQueryAll(PLAYER_SELECTORS.join(',')),
            ...deepQueryAll('video').map((video) => video.closest(PLAYER_SELECTORS.join(',')) || video.parentElement)
        ];
        const seen = new Set();

        return found.reduce((players, element) => {
            if (!element || seen.has(element)) {
                return players;
            }

            seen.add(element);
            const rect = element.getBoundingClientRect();
            const computed = element instanceof HTMLElement ? getComputedStyle(element) : null;
            if (!rect || rect.width < 160 || rect.height < 90 || computed?.display === 'none' ||
                computed?.visibility === 'hidden') {
                return players;
            }

            players.push({ element, rect });
            return players;
        }, []);
    }

    function rectMostlyInside(rect, containerRect) {
        if (!rect || !containerRect || rect.width <= 0 || rect.height <= 0 ||
            containerRect.width <= 0 || containerRect.height <= 0) {
            return false;
        }

        return rect.left >= containerRect.left - 6 &&
            rect.right <= containerRect.right + 6 &&
            rect.top >= containerRect.top - 6 &&
            rect.bottom <= containerRect.bottom + 6;
    }

    function probe(options = {}) {
        const result = buildProbeResult(options);
        if (!options.silent) {
            debugLog('probe', result);
        }
        return result;
    }

    function sample(options = {}) {
        const durationMs = Math.max(1000, Math.min(30000, Number(options.durationMs || options.ms || 8000)));
        const intervalMs = Math.max(200, Math.min(3000, Number(options.intervalMs || 500)));
        const limit = Number.isFinite(options.limit) ? options.limit : DEBUG_MAX_ITEMS;
        const startedAt = Date.now();
        const snapshots = [];
        const seen = new Map();

        debugLog('sample started', { durationMs, intervalMs, limit });

        function collect() {
            const currentProbe = buildProbeResult({ limit, silent: true });
            const video = deepQueryAll('video')[0];
            const snapshot = {
                atMs: Date.now() - startedAt,
                currentTime: video ? round(video.currentTime || 0, 3) : null,
                paused: video ? video.paused : null,
                counts: currentProbe.counts,
                accepted: currentProbe.accepted,
                lowerText: currentProbe.rejected
                    .filter((item) => item.rect.verticalRatio >= 0.42)
                    .slice(0, limit)
            };

            snapshots.push(snapshot);

            [...currentProbe.accepted, ...currentProbe.rejected].forEach((item) => {
                const key = `${item.text}|${item.selector}`;
                if (!seen.has(key)) {
                    seen.set(key, {
                        firstAtMs: snapshot.atMs,
                        lastAtMs: snapshot.atMs,
                        occurrences: 1,
                        item
                    });
                    return;
                }

                const existing = seen.get(key);
                existing.lastAtMs = snapshot.atMs;
                existing.occurrences += 1;
            });
        }

        return new Promise((resolve) => {
            collect();

            const interval = setInterval(collect, intervalMs);
            setTimeout(async () => {
                clearInterval(interval);

                const playback = await analyzePlayback({ silent: true });
                const result = {
                    href: location.href,
                    durationMs,
                    intervalMs,
                    snapshots: snapshots.slice(-Math.ceil(durationMs / intervalMs) - 2),
                    uniqueTextItems: Array.from(seen.values())
                        .sort((a, b) => b.occurrences - a.occurrences)
                        .slice(0, limit),
                    playback
                };

                debugState.lastSampleCount = snapshots.length;
                debugLog('sample complete', result);
                resolve(result);
            }, durationMs);
        });
    }

    function buildProbeResult(options = {}) {
        registerExistingShadowRoots(document);

        const limit = Number.isFinite(options.limit) ? options.limit : DEBUG_MAX_ITEMS;
        const players = getVisiblePlayers();
        const items = getPlayerTextProbeItems(players);
        const accepted = items.filter((item) => !item.rejectReason);
        const rejected = items.filter((item) => item.rejectReason);
        const rejectReasonCounts = rejected.reduce((counts, item) => {
            counts[item.rejectReason] = (counts[item.rejectReason] || 0) + 1;
            return counts;
        }, {});

        debugState.lastProbeCount = items.length;

        return {
            href: location.href,
            readyState: document.readyState,
            title: document.title,
            counts: {
                players: players.length,
                visibleTextItems: items.length,
                accepted: accepted.length,
                rejected: rejected.length,
                rejectReasonCounts
            },
            accepted: accepted.slice(0, limit),
            rejected: rejected.slice(0, limit),
            players: players.map(({ element }) => describeElement(element)).slice(0, limit)
        };
    }

    async function analyzePlayback(options = {}) {
        const manifestUrls = getManifestUrls();
        const subtitleLikeUrls = getSubtitleLikeResourceUrls();
        const videos = deepQueryAll('video').map((video) => ({
            element: describeElement(video),
            currentSrc: video.currentSrc || video.src || null,
            currentTime: round(video.currentTime || 0, 3),
            paused: video.paused,
            readyState: video.readyState,
            textTracks: Array.from(video.textTracks || []).map((track) => ({
                kind: track.kind,
                label: track.label,
                language: track.language,
                mode: track.mode,
                cues: track.cues ? track.cues.length : null,
                activeCues: track.activeCues ? track.activeCues.length : null
            }))
        }));

        const manifestAnalyses = [];
        for (const url of manifestUrls.slice(0, 5)) {
            manifestAnalyses.push(await analyzeManifestUrl(url));
        }

        const hasVideoTextTracks = videos.some((video) => video.textTracks.length > 0);
        const hasSoftSubtitleSignal = hasVideoTextTracks ||
            subtitleLikeUrls.length > 0 ||
            manifestAnalyses.some((manifest) =>
                manifest.ok &&
                (
                    manifest.hasTextAdaptationSet ||
                    manifest.hasTextTrackCodecs ||
                    manifest.hasVttText ||
                    manifest.hasHlsSubtitles
                )
            );
        const hasHardSubManifest = manifestAnalyses.some((manifest) => manifest.ok && manifest.hardsubLocale);
        const likelyHardSubPlayback = hasHardSubManifest && !hasSoftSubtitleSignal;

        const result = {
            href: location.href,
            videos,
            resources: {
                manifestUrls: manifestUrls.map(redactUrl),
                subtitleLikeUrls: subtitleLikeUrls.map(redactUrl),
                network: {
                    requests: networkState.requests.length,
                    capturedManifestBodies: networkState.manifestBodies.length,
                    hardsubLocales: networkState.hardsubLocales.slice(),
                    playbackV3Responses: playbackState.responses.length
                }
            },
            manifests: manifestAnalyses,
            playbackV3: playbackState.lastPlaybackSummary,
            generatedSubtitles: cloneGeneratedSubtitleState(),
            likelyHardSubPlayback,
            diagnosis: likelyHardSubPlayback
                ? 'The playback manifest points to a hardsub locale and no soft subtitle track was detected.'
                : 'No definitive hardsub-only signal was found in the captured playback data.'
        };

        debugState.lastPlaybackAnalysis = result;

        if (likelyHardSubPlayback) {
            warnHardSubPlayback(result);
        }

        if (!options.silent) {
            debugLog('playback analysis', result);
        }

        return result;
    }

    async function analyzeManifestUrl(url) {
        const hardsubLocale = getHardsubLocaleFromUrl(url);
        const captured = findCapturedManifestBody(url);

        if (captured?.summary) {
            return {
                url: redactUrl(url),
                ok: captured.ok !== false,
                status: captured.status,
                captured: true,
                source: captured.source,
                hardsubLocale,
                ...captured.summary
            };
        }

        try {
            const response = await fetch(url, {
                credentials: 'include',
                cache: 'force-cache'
            });
            const text = await response.text();
            return {
                url: redactUrl(url),
                ok: response.ok,
                status: response.status,
                captured: false,
                hardsubLocale,
                ...parseManifestSummary(text)
            };
        } catch (error) {
            debugError('manifest analysis failed', error, { url });
            return {
                url: redactUrl(url),
                ok: false,
                captured: false,
                hardsubLocale,
                error: {
                    name: error?.name,
                    message: error?.message
                }
            };
        }
    }

    async function handlePlaybackV3FetchResponse(response, url, meta) {
        let playback;
        try {
            playback = await response.clone().json();
        } catch (error) {
            recordPlaybackError('playback v3 json parse failed', error, { url });
            return null;
        }

        recordPlaybackResponse(playback, url, meta);
        queueGeneratedSubtitleLoad('playback-v3');

        if (!FORCE_CLEAN_STREAM_FOR_HARDSUBS) {
            return null;
        }

        const rewrite = rewritePlaybackHardSubsToClean(playback);
        if (!rewrite.changed) {
            debugVerbose('playback clean stream rewrite skipped', rewrite.reason);
            return null;
        }

        playbackState.cleanStreamRewrites += rewrite.changedCount;
        debugState.cleanStreamRewrites = playbackState.cleanStreamRewrites;
        debugLog('playback hardsubs redirected to clean stream', {
            changedCount: rewrite.changedCount,
            cleanUrl: redactUrl(rewrite.cleanUrl),
            languages: rewrite.languages
        });

        return createJsonResponse(response, rewrite.playback);
    }

    function recordPlaybackResponse(playback, url, meta = {}) {
        const previousAssetId = playbackState.lastPlayback?.assetId;
        if (previousAssetId && playback?.assetId && previousAssetId !== playback.assetId) {
            resetGeneratedSubtitleState('playback-asset-changed');
        }

        const summary = summarizePlaybackV3(playback, url, meta);
        playbackState.lastPlayback = playback;
        playbackState.lastPlaybackSummary = summary;
        pushLimited(playbackState.responses, summary, DEBUG_MAX_ITEMS);
        debugState.playbackV3Responses = playbackState.responses.length;
        updateSettingsLanguageOptions();
        debugLog('playback v3 captured', summary);
    }

    function summarizePlaybackV3(playback, url, meta = {}) {
        const subtitles = playback?.subtitles || {};
        const captions = playback?.captions || {};
        const hardSubs = playback?.hardSubs || {};

        return {
            at: new Date().toISOString(),
            source: meta.source || null,
            status: meta.status ?? null,
            url: redactUrl(url),
            assetId: playback?.assetId || null,
            audioLocale: playback?.audioLocale || null,
            burnedInLocale: playback?.burnedInLocale || null,
            hardSubLanguages: Object.keys(hardSubs),
            subtitleLanguages: Object.keys(subtitles),
            captionLanguages: Object.keys(captions),
            cleanStreamAvailable: Boolean(hardSubs.none?.url),
            selectedSubtitle: playbackState.selectedSubtitle
        };
    }

    function rewritePlaybackHardSubsToClean(playback) {
        const hardSubs = playback?.hardSubs;
        const cleanUrl = hardSubs?.none?.url;
        if (!hardSubs || !cleanUrl) {
            return {
                changed: false,
                reason: 'missing hardSubs.none.url'
            };
        }

        const rewritten = cloneJson(playback);
        const languages = [];
        for (const [language, hardSub] of Object.entries(rewritten.hardSubs || {})) {
            if (language === 'none' || !hardSub?.url || hardSub.url === cleanUrl) {
                continue;
            }

            hardSub.url = cleanUrl;
            hardSub.hlang = 'none';
            languages.push(language);
        }

        if ('burnedInLocale' in rewritten) {
            rewritten.burnedInLocale = '';
        }

        return {
            changed: languages.length > 0,
            changedCount: languages.length,
            cleanUrl,
            languages,
            playback: rewritten
        };
    }

    function createJsonResponse(originalResponse, data) {
        const HeadersCtor = DEBUG_WINDOW.Headers || Headers;
        const ResponseCtor = DEBUG_WINDOW.Response || Response;
        const headers = new HeadersCtor(originalResponse.headers);
        headers.set('content-type', 'application/json');
        headers.delete('content-length');

        return new ResponseCtor(JSON.stringify(data), {
            status: originalResponse.status,
            statusText: originalResponse.statusText,
            headers
        });
    }

    function queueGeneratedSubtitleLoad(reason) {
        if (!GENERATED_SUBTITLE_OVERLAY || playbackState.loadPromise) {
            return;
        }

        playbackState.loadPromise = Promise.resolve().then(async () => {
            await sleep(150);
            await loadGeneratedSubtitleFromPlayback(reason);
        }).finally(() => {
            playbackState.loadPromise = null;
        });
    }

    async function loadGeneratedSubtitleFromPlayback(reason, options = {}) {
        if (playbackState.localSubtitleOverride && !options.forceRemote) {
            startGeneratedSubtitleRender();
            return playbackState.cues;
        }

        if (options.forceRemote) {
            playbackState.localSubtitleOverride = false;
        }

        const playback = playbackState.lastPlayback;
        if (!playback) {
            return null;
        }

        const selected = chooseGeneratedSubtitle(playback);
        playbackState.selectedSubtitle = selected ? {
            language: selected.language,
            format: selected.format,
            url: redactUrl(selected.url)
        } : null;

        if (!selected?.url) {
            playbackState.subtitleStatus = 'missing';
            debugLog('generated subtitle skipped: no matching subtitle URL', {
                reason,
                configuredLanguage: runtimeGeneratedSubtitleLanguage,
                available: Object.keys(playback.subtitles || {})
            });
            return null;
        }

        if (playbackState.subtitleUrl === selected.url && (playbackState.cues.length || playbackState.annotationCues.length)) {
            startGeneratedSubtitleRender();
            return playbackState.cues;
        }

        playbackState.subtitleStatus = 'loading';
        playbackState.subtitleUrl = selected.url;
        playbackState.subtitleFormat = selected.format || 'unknown';
        debugLog('generated subtitle loading', {
            reason,
            language: selected.language,
            format: selected.format,
            url: redactUrl(selected.url)
        });

        try {
            const response = await DEBUG_WINDOW.fetch.call(DEBUG_WINDOW, selected.url, {
                credentials: 'omit',
                cache: 'force-cache'
            });
            if (!response?.ok) {
                throw new Error(`subtitle fetch failed: ${response?.status}`);
            }

            const text = await response.text();
            const parsed = applyGeneratedSubtitleText(text, selected.format, {
                source: 'remote',
                fileName: getSubtitleDownloadFileName(selected),
                selectedSubtitle: {
                    language: selected.language,
                    format: selected.format,
                    url: redactUrl(selected.url)
                },
                url: selected.url
            });
            debugLog('generated subtitle ready', {
                language: selected.language,
                format: selected.format,
                cues: parsed.cues.length,
                annotations: parsed.annotationCues.length
            });
            startGeneratedSubtitleRender();
            return parsed.cues;
        } catch (error) {
            playbackState.subtitleStatus = 'error';
            recordPlaybackError('generated subtitle load failed', error, {
                url: selected.url,
                language: selected.language,
                format: selected.format
            });
            return null;
        }
    }

    function applyGeneratedSubtitleText(text, format, meta = {}) {
        const parsed = parseSubtitleCues(text, format);
        const cues = parsed.cues || [];
        const annotationCues = parsed.annotationCues || [];

        clearGeneratedAnnotationNodes();
        playbackState.lastAnnotationKeys = '';
        playbackState.lastRenderedText = null;
        playbackState.lastRenderedDialogueKey = null;
        playbackState.lastNonEmptyDialogueText = '';
        playbackState.lastNonEmptyDialogueAt = 0;
        playbackState.lastNonEmptyDialogueVideoTime = 0;
        playbackState.lastDialogueCanvasSignature = null;
        playbackState.renderedTextChanges = 0;
        playbackState.recentRenderedTextChanges = [];
        playbackState.cues = cues;
        playbackState.annotationCues = annotationCues;
        playbackState.subtitleRawText = String(text || '');
        playbackState.subtitleFormat = format || 'unknown';
        playbackState.subtitleSource = meta.source || null;
        playbackState.subtitleFileName = sanitizeDownloadFileName(meta.fileName || getSubtitleDownloadFileName(meta.selectedSubtitle || {}));
        playbackState.subtitleUrl = meta.url || null;
        playbackState.selectedSubtitle = meta.selectedSubtitle || playbackState.selectedSubtitle;
        playbackState.subtitleStatus = cues.length || annotationCues.length ? 'ready' : 'empty';
        debugState.generatedSubtitleCues = cues.length;
        debugState.generatedAnnotationCues = annotationCues.length;

        return {
            cues,
            annotationCues
        };
    }

    async function downloadCurrentSubtitleFile() {
        if (!playbackState.subtitleRawText && playbackState.subtitleUrl && !playbackState.localSubtitleOverride) {
            await loadGeneratedSubtitleFromPlayback('download-request');
        }

        if (!playbackState.subtitleRawText) {
            debugLog('subtitle download skipped: no subtitle text loaded');
            window.alert?.('Aun no hay un subtitulo cargado para descargar.');
            return null;
        }

        const format = normalizeSubtitleFormat(playbackState.subtitleFormat || getSubtitleFormatFromFileName(playbackState.subtitleFileName));
        const fileName = sanitizeDownloadFileName(playbackState.subtitleFileName || `crunchyroll-subtitle.${format || 'ass'}`);
        const blob = new Blob([playbackState.subtitleRawText], {
            type: getSubtitleMimeType(format)
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.documentElement.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        debugLog('subtitle downloaded', {
            fileName,
            source: playbackState.subtitleSource,
            format,
            bytes: playbackState.subtitleRawText.length
        });
        return fileName;
    }

    async function loadLocalSubtitleFile(file) {
        try {
            const text = await file.text();
            const format = normalizeSubtitleFormat(getSubtitleFormatFromFileName(file.name) || 'ass');
            const parsed = applyGeneratedSubtitleText(text, format, {
                source: 'local',
                fileName: file.name,
                selectedSubtitle: {
                    language: 'local',
                    format,
                    url: null,
                    fileName: file.name
                },
                url: null
            });
            playbackState.localSubtitleOverride = true;
            playbackState.subtitleStatus = parsed.cues.length || parsed.annotationCues.length ? 'ready' : 'empty';
            debugLog('local subtitle loaded', {
                fileName: file.name,
                format,
                cues: parsed.cues.length,
                annotations: parsed.annotationCues.length
            });
            startGeneratedSubtitleRender();
            return parsed;
        } catch (error) {
            playbackState.subtitleStatus = 'error';
            recordPlaybackError('local subtitle load failed', error, {
                fileName: file?.name || null
            });
            return null;
        }
    }

    function getSubtitleDownloadFileName(selected = playbackState.selectedSubtitle || {}) {
        const url = selected.url && !String(selected.url).startsWith('redacted') ? selected.url : playbackState.subtitleUrl;
        const urlFileName = getFileNameFromUrl(url);
        const language = selected.language || runtimeGeneratedSubtitleLanguage || 'subtitle';
        const format = normalizeSubtitleFormat(selected.format || getSubtitleFormatFromFileName(urlFileName) || playbackState.subtitleFormat || 'ass');
        return sanitizeDownloadFileName(urlFileName || `crunchyroll-${language}.${format}`);
    }

    function getFileNameFromUrl(url) {
        if (!url) {
            return '';
        }

        try {
            const pathname = new URL(url, location.href).pathname;
            return decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
        } catch (error) {
            return String(url).split(/[/?#]/)[0].split('/').pop() || '';
        }
    }

    function getSubtitleFormatFromFileName(fileName) {
        const match = String(fileName || '').match(/\.([a-z0-9]+)$/i);
        return match ? normalizeSubtitleFormat(match[1]) : '';
    }

    function normalizeSubtitleFormat(format) {
        const value = String(format || '').replace(/^\./, '').toLowerCase();
        if (value === 'ssa') {
            return 'ass';
        }
        if (['ass', 'vtt', 'srt'].includes(value)) {
            return value;
        }
        return value || 'ass';
    }

    function getSubtitleMimeType(format) {
        if (format === 'vtt') {
            return 'text/vtt;charset=utf-8';
        }
        return 'text/plain;charset=utf-8';
    }

    function sanitizeDownloadFileName(value) {
        const fileName = String(value || 'crunchyroll-subtitle.ass')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
        return fileName || 'crunchyroll-subtitle.ass';
    }

    function chooseGeneratedSubtitle(playback) {
        const subtitles = playback?.subtitles || {};
        const languages = Object.keys(subtitles).filter((language) => subtitles[language]?.url);
        if (!languages.length) {
            return null;
        }

        const preferred = getGeneratedSubtitleLanguageCandidates(playback, languages);
        const language = preferred.find((candidate) => subtitles[candidate]?.url) ||
            preferred.map((candidate) => findLocaleByBaseLanguage(candidate, languages)).find(Boolean) ||
            languages.find((candidate) => candidate !== 'none') ||
            languages[0];

        return subtitles[language] ? {
            ...subtitles[language],
            language
        } : null;
    }

    function getGeneratedSubtitleLanguageCandidates(playback, languages) {
        const configured = normalizeLocale(runtimeGeneratedSubtitleLanguage);
        const candidates = [];

        if (configured && configured !== 'auto') {
            candidates.push(configured);
        }

        candidates.push(
            ...networkState.hardsubLocales,
            playback?.burnedInLocale,
            document.documentElement.lang,
            ...Array.from(navigator.languages || []),
            navigator.language,
            'es-419',
            'es-ES',
            'en-US'
        );

        languages.forEach((language) => {
            if (language && !candidates.includes(language)) {
                const base = language.split('-')[0];
                if (candidates.some((candidate) => candidate?.split('-')[0] === base)) {
                    candidates.push(language);
                }
            }
        });

        return candidates.map(normalizeLocale).filter(Boolean).filter(uniqueFilter);
    }

    function findLocaleByBaseLanguage(locale, languages) {
        const base = normalizeLocale(locale)?.split('-')[0];
        if (!base) {
            return null;
        }

        return languages.find((language) => normalizeLocale(language).split('-')[0] === base) || null;
    }

    function normalizeLocale(value) {
        return String(value || '').trim();
    }

    function parseSubtitleCues(text, format = '') {
        const value = String(text || '').replace(/^\uFEFF/, '');
        const normalizedFormat = String(format || '').toLowerCase();

        if (normalizedFormat === 'ass' || /^\s*\[Script Info\]/i.test(value) || /\nDialogue:/i.test(value)) {
            return parseAssCues(value);
        }

        return {
            cues: parseVttLikeCues(value),
            annotationCues: []
        };
    }

    function parseVttLikeCues(text) {
        const cues = [];
        const blocks = text.replace(/\r/g, '').split(/\n{2,}/);

        blocks.forEach((block) => {
            const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
            const timeIndex = lines.findIndex((line) => line.includes('-->'));
            if (timeIndex < 0) {
                return;
            }

            const [startRaw, endRaw] = lines[timeIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
            const start = parseSubtitleTime(startRaw);
            const end = parseSubtitleTime(endRaw);
            const cueText = cleanSubtitleText(lines.slice(timeIndex + 1).join('\n'));
            if (Number.isFinite(start) && Number.isFinite(end) && cueText) {
                cues.push({
                    id: `vtt-${cues.length}`,
                    start,
                    end,
                    text: cueText,
                    layer: 0
                });
            }
        });

        return cues.sort((a, b) => a.start - b.start);
    }

    function parseAssCues(text) {
        const cues = [];
        const annotationCues = [];
        const scriptInfo = {
            playResX: 1920,
            playResY: 1080
        };
        const styles = new Map();
        let section = '';
        let eventFormat = [];
        let styleFormat = [];
        let eventIndex = 0;

        text.replace(/\r/g, '').split('\n').forEach((line) => {
            const trimmed = line.trim();
            const sectionMatch = trimmed.match(/^\[(.+)\]$/);
            if (sectionMatch) {
                section = sectionMatch[1].toLowerCase();
                return;
            }

            if (section === 'script info') {
                parseAssScriptInfoLine(trimmed, scriptInfo);
                return;
            }

            if (/^v4\+?\s+styles$/i.test(section)) {
                if (/^Format\s*:/i.test(trimmed)) {
                    styleFormat = trimmed.replace(/^Format\s*:/i, '').split(',').map((item) => item.trim().toLowerCase());
                    return;
                }

                if (/^Style\s*:/i.test(trimmed) && styleFormat.length) {
                    const style = parseAssStyle(trimmed.replace(/^Style\s*:/i, '').trim(), styleFormat);
                    if (style.name) {
                        styles.set(style.name.toLowerCase(), style);
                    }
                }
                return;
            }

            if (section !== 'events') {
                return;
            }

            if (/^Format\s*:/i.test(trimmed)) {
                eventFormat = trimmed.replace(/^Format\s*:/i, '').split(',').map((item) => item.trim().toLowerCase());
                return;
            }

            if (!/^Dialogue\s*:/i.test(trimmed) || !eventFormat.length) {
                return;
            }

            const fields = splitAssDialogueFields(trimmed.replace(/^Dialogue\s*:/i, '').trim(), eventFormat.length);
            const start = parseSubtitleTime(fields[eventFormat.indexOf('start')]);
            const end = parseSubtitleTime(fields[eventFormat.indexOf('end')]);
            const rawText = fields[eventFormat.indexOf('text')] || '';
            const cueText = cleanSubtitleText(rawText);
            if (!Number.isFinite(start) || !Number.isFinite(end) || !cueText) {
                return;
            }

            const styleName = fields[eventFormat.indexOf('style')] || 'Default';
            const style = getAssStyle(styles, styleName);
            const overrides = parseAssOverrides(rawText);
            const assCue = {
                id: `ass-${eventIndex}`,
                start,
                end,
                text: cueText,
                rawText,
                layer: parseInteger(fields[eventFormat.indexOf('layer')], 0),
                styleName,
                style,
                overrides,
                margins: {
                    left: parseInteger(fields[eventFormat.indexOf('marginl')], style.marginL),
                    right: parseInteger(fields[eventFormat.indexOf('marginr')], style.marginR),
                    vertical: parseInteger(fields[eventFormat.indexOf('marginv')], style.marginV)
                },
                playResX: scriptInfo.playResX,
                playResY: scriptInfo.playResY
            };
            eventIndex += 1;

            if (isAssAnnotationCue(assCue)) {
                annotationCues.push(assCue);
            } else {
                cues.push({
                    id: assCue.id,
                    start,
                    end,
                    text: cueText,
                    layer: assCue.layer
                });
            }
        });

        return {
            cues: cues.sort((a, b) => a.start - b.start),
            annotationCues: annotationCues.sort((a, b) => a.start - b.start || a.layer - b.layer)
        };
    }

    function parseAssScriptInfoLine(line, scriptInfo) {
        const match = String(line || '').match(/^([^:]+):\s*(.+)$/);
        if (!match) {
            return;
        }

        const key = match[1].trim().toLowerCase();
        const value = Number.parseFloat(match[2]);
        if (!Number.isFinite(value) || value <= 0) {
            return;
        }

        if (key === 'playresx') {
            scriptInfo.playResX = value;
        } else if (key === 'playresy') {
            scriptInfo.playResY = value;
        }
    }

    function parseAssStyle(value, format) {
        const fields = splitAssDialogueFields(value, format.length);
        const get = (name, fallback = '') => fields[format.indexOf(name)] ?? fallback;

        return {
            name: get('name', 'Default'),
            fontName: get('fontname', 'Arial'),
            fontSize: parseNumber(get('fontsize'), 48),
            primaryColor: assColorToCss(get('primarycolour'), '#ffffff'),
            outlineColor: assColorToCss(get('outlinecolour'), '#000000'),
            backColor: assColorToCss(get('backcolour'), '#000000'),
            bold: parseInteger(get('bold'), 0) !== 0,
            italic: parseInteger(get('italic'), 0) !== 0,
            underline: parseInteger(get('underline'), 0) !== 0,
            scaleX: parseNumber(get('scalex'), 100),
            scaleY: parseNumber(get('scaley'), 100),
            spacing: parseNumber(get('spacing'), 0),
            angle: parseNumber(get('angle'), 0),
            outline: parseNumber(get('outline'), 2),
            shadow: parseNumber(get('shadow'), 0),
            alignment: parseInteger(get('alignment'), 2),
            marginL: parseInteger(get('marginl'), 20),
            marginR: parseInteger(get('marginr'), 20),
            marginV: parseInteger(get('marginv'), 20)
        };
    }

    function getAssStyle(styles, styleName) {
        const style = styles.get(String(styleName || '').toLowerCase()) ||
            styles.get('default');

        return style || {
            name: styleName || 'Default',
            fontName: 'Arial',
            fontSize: 48,
            primaryColor: '#ffffff',
            outlineColor: '#000000',
            backColor: '#000000',
            bold: false,
            italic: false,
            underline: false,
            scaleX: 100,
            scaleY: 100,
            spacing: 0,
            angle: 0,
            outline: 2,
            shadow: 0,
            alignment: 2,
            marginL: 20,
            marginR: 20,
            marginV: 20
        };
    }

    function parseAssOverrides(rawText) {
        const overrideText = Array.from(String(rawText || '').matchAll(/\{([^}]*)\}/g))
            .map((match) => match[1])
            .join('');
        const overrides = {};
        const pos = overrideText.match(/\\pos\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i);
        const move = overrideText.match(/\\move\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?))?\s*\)/i);
        const alignment = overrideText.match(/\\an([1-9])/i);

        if (pos) {
            overrides.position = {
                x: Number(pos[1]),
                y: Number(pos[2])
            };
        }
        if (move) {
            overrides.move = {
                x1: Number(move[1]),
                y1: Number(move[2]),
                x2: Number(move[3]),
                y2: Number(move[4]),
                t1: Number.isFinite(Number(move[5])) ? Number(move[5]) / 1000 : null,
                t2: Number.isFinite(Number(move[6])) ? Number(move[6]) / 1000 : null
            };
        }
        if (alignment) {
            overrides.alignment = Number(alignment[1]);
        }

        assignAssOverrideNumber(overrides, 'fontSize', overrideText, /\\fs(\d+(?:\.\d+)?)/i);
        assignAssOverrideNumber(overrides, 'outline', overrideText, /\\bord(\d+(?:\.\d+)?)/i);
        assignAssOverrideNumber(overrides, 'shadow', overrideText, /\\shad(\d+(?:\.\d+)?)/i);
        assignAssOverrideNumber(overrides, 'scaleX', overrideText, /\\fscx(\d+(?:\.\d+)?)/i);
        assignAssOverrideNumber(overrides, 'scaleY', overrideText, /\\fscy(\d+(?:\.\d+)?)/i);
        assignAssOverrideNumber(overrides, 'angle', overrideText, /\\frz?(-?\d+(?:\.\d+)?)/i);
        assignAssOverrideBoolean(overrides, 'bold', overrideText, /\\b([01])/i);
        assignAssOverrideBoolean(overrides, 'italic', overrideText, /\\i([01])/i);

        const fontName = overrideText.match(/\\fn([^\\}]+)/i);
        if (fontName?.[1]) {
            overrides.fontName = fontName[1].trim();
        }
        const primaryColor = overrideText.match(/\\(?:1?c)&H([0-9a-f]{6,8})&/i);
        if (primaryColor?.[1]) {
            overrides.primaryColor = assColorToCss(primaryColor[1]);
        }
        const outlineColor = overrideText.match(/\\3c&H([0-9a-f]{6,8})&/i);
        if (outlineColor?.[1]) {
            overrides.outlineColor = assColorToCss(outlineColor[1]);
        }
        const shadowColor = overrideText.match(/\\4c&H([0-9a-f]{6,8})&/i);
        if (shadowColor?.[1]) {
            overrides.backColor = assColorToCss(shadowColor[1]);
        }

        return overrides;
    }

    function assignAssOverrideNumber(target, key, text, pattern) {
        const match = text.match(pattern);
        if (match?.[1]) {
            target[key] = Number(match[1]);
        }
    }

    function assignAssOverrideBoolean(target, key, text, pattern) {
        const match = text.match(pattern);
        if (match?.[1]) {
            target[key] = match[1] !== '0';
        }
    }

    function isAssAnnotationCue(cue) {
        const styleName = `${cue.styleName || ''} ${cue.style?.name || ''}`;
        const hasPositioning = Boolean(cue.overrides.position || cue.overrides.move);
        const overrideAlignment = cue.overrides.alignment;
        const hasNonDialogueAlignment = Number.isFinite(overrideAlignment) && overrideAlignment !== 2;
        const styleLooksLikeAnnotation = /(^|[^a-z])(sign|screen|on[-\s]?screen|text|note|poster|phone|message|title|typeset|ui|banner|letter|label|caption|credits|kanji|translation)([^a-z]|$)/i.test(styleName);

        return hasPositioning || hasNonDialogueAlignment || styleLooksLikeAnnotation;
    }

    function splitAssDialogueFields(value, count) {
        const fields = [];
        let cursor = 0;

        for (let index = 0; index < count - 1; index += 1) {
            const comma = value.indexOf(',', cursor);
            if (comma < 0) {
                fields.push(value.slice(cursor));
                cursor = value.length;
                break;
            }
            fields.push(value.slice(cursor, comma));
            cursor = comma + 1;
        }

        fields.push(value.slice(cursor));
        while (fields.length < count) {
            fields.push('');
        }

        return fields;
    }

    function parseSubtitleTime(value) {
        const match = String(value || '').trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/);
        if (!match) {
            return NaN;
        }

        const hours = Number(match[1] || 0);
        const minutes = Number(match[2] || 0);
        const seconds = Number(match[3] || 0);
        const fraction = Number(`0.${(match[4] || '0').padEnd(3, '0').slice(0, 3)}`);
        return hours * 3600 + minutes * 60 + seconds + fraction;
    }

    function parseNumber(value, fallback = 0) {
        const number = Number.parseFloat(String(value || '').trim());
        return Number.isFinite(number) ? number : fallback;
    }

    function parseInteger(value, fallback = 0) {
        const number = Number.parseInt(String(value || '').trim(), 10);
        return Number.isFinite(number) ? number : fallback;
    }

    function assColorToCss(value, fallback = '#ffffff') {
        const match = String(value || '').trim().match(/^(?:&H)?([0-9a-f]{6}|[0-9a-f]{8})&?$/i);
        if (!match) {
            return fallback;
        }

        const hex = match[1].padStart(8, '0');
        const alpha = Number.parseInt(hex.slice(0, 2), 16);
        const blue = Number.parseInt(hex.slice(2, 4), 16);
        const green = Number.parseInt(hex.slice(4, 6), 16);
        const red = Number.parseInt(hex.slice(6, 8), 16);
        const opacity = round(1 - alpha / 255, 3);

        return opacity >= 1
            ? `rgb(${red} ${green} ${blue})`
            : `rgb(${red} ${green} ${blue} / ${opacity})`;
    }

    function cleanSubtitleText(value) {
        return decodeHtmlEntities(String(value || '')
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\N|\\n/g, '\n')
            .replace(/\\h/g, ' ')
            .replace(/<[^>]+>/g, '')
            .replace(/\r/g, '')
            .split('\n')
            .map((line) => normalizeText(line))
            .join('\n')
            .trim());
    }

    function decodeHtmlEntities(value) {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = value;
        return textarea.value;
    }

    function startGeneratedSubtitleRender() {
        if (!GENERATED_SUBTITLE_OVERLAY || (!playbackState.cues.length && !playbackState.annotationCues.length)) {
            return;
        }

        clearHeuristicProcessedElements('generated-overlay-started');
        playbackState.lastOverlayGeometry = null;
        ensureGeneratedSubtitleOverlay();
        if (playbackState.renderRaf) {
            cancelAnimationFrame(playbackState.renderRaf);
        }
        playbackState.lastRenderedText = null;
        playbackState.lastRenderedDialogueKey = null;
        document.documentElement.classList.add('crsr-generated-subtitle-active');
        renderGeneratedSubtitleFrame();
    }

    function resetGeneratedSubtitleState(reason) {
        if (playbackState.renderRaf) {
            cancelAnimationFrame(playbackState.renderRaf);
        }
        playbackState.renderRaf = null;
        playbackState.cues = [];
        playbackState.annotationCues = [];
        playbackState.subtitleUrl = null;
        playbackState.subtitleFormat = null;
        playbackState.subtitleRawText = '';
        playbackState.subtitleFileName = '';
        playbackState.subtitleSource = null;
        playbackState.localSubtitleOverride = false;
        playbackState.subtitleStatus = 'idle';
        playbackState.selectedSubtitle = null;
        playbackState.lastRenderedText = null;
        playbackState.lastRenderedDialogueKey = null;
        playbackState.lastNonEmptyDialogueText = '';
        playbackState.lastNonEmptyDialogueAt = 0;
        playbackState.lastNonEmptyDialogueVideoTime = 0;
        playbackState.lastDialogueCanvasSignature = null;
        playbackState.renderedTextChanges = 0;
        playbackState.recentRenderedTextChanges = [];
        playbackState.lastAnnotationKeys = '';
        playbackState.lastOverlayGeometry = null;
        clearGeneratedAnnotationNodes();
        if (playbackState.overlayText) {
            playbackState.overlayText.textContent = '';
            playbackState.overlayText.style.setProperty('visibility', 'hidden', 'important');
        }
        clearGeneratedDialogueCanvas();
        document.documentElement.classList.remove('crsr-generated-subtitle-active');
        debugLog('generated subtitle state reset', { reason });
    }

    function clearGeneratedDialogueCanvas() {
        const canvas = playbackState.dialogueCanvas;
        const context = playbackState.dialogueCanvasContext;
        if (!canvas || !context) {
            return;
        }

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        playbackState.lastDialogueCanvasSignature = null;
    }

    function renderGeneratedSubtitleFrame() {
        const video = getPrimaryVideo();
        if (video && (!playbackState.dialogueCanvas || playbackState.overlay?.parentNode !== getVideoOverlayContainer(video))) {
            ensureGeneratedSubtitleOverlay();
        }

        const canvas = playbackState.dialogueCanvas;
        if (!video || !canvas) {
            playbackState.renderRaf = requestAnimationFrame(renderGeneratedSubtitleFrame);
            return;
        }

        const activeDialogue = getActiveGeneratedDialogue(video.currentTime);
        const geometryChanged = syncGeneratedSubtitleOverlayToVideo(video);
        renderGeneratedAnnotations(video.currentTime, geometryChanged);
        renderGeneratedDialogueCanvas(activeDialogue, video, geometryChanged);

        playbackState.renderRaf = requestAnimationFrame(renderGeneratedSubtitleFrame);
    }

    function renderGeneratedDialogueCanvas(activeDialogue, video, geometryChanged) {
        const canvas = playbackState.dialogueCanvas;
        const overlay = playbackState.overlay;
        if (!canvas || !overlay) {
            return;
        }

        const rect = overlay.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return;
        }

        const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        const canvasWidth = Math.max(1, Math.round(rect.width * dpr));
        const canvasHeight = Math.max(1, Math.round(rect.height * dpr));
        const resized = canvas.width !== canvasWidth || canvas.height !== canvasHeight;
        if (resized) {
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
        }

        const text = activeDialogue.text || '';
        const key = activeDialogue.key || '';
        const settings = generatedSubtitleSettings;
        const signature = [
            key,
            text,
            canvasWidth,
            canvasHeight,
            dpr,
            settings.scale,
            settings.fontSize,
            settings.fontFamily,
            settings.fontWeight,
            settings.textColor,
            settings.backgroundColor,
            settings.backgroundOpacity,
            settings.outlineColor,
            settings.outlineWidth,
            settings.shadowColor,
            settings.shadowBlur,
            settings.lineHeight,
            settings.letterSpacing,
            settings.paddingX,
            settings.paddingY,
            settings.borderRadius,
            settings.verticalPosition
        ].join('\u001f');

        if (!geometryChanged && !resized && signature === playbackState.lastDialogueCanvasSignature) {
            return;
        }

        const context = playbackState.dialogueCanvasContext || canvas.getContext('2d');
        if (!context) {
            return;
        }

        playbackState.dialogueCanvasContext = context;
        playbackState.lastDialogueCanvasSignature = signature;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, rect.width, rect.height);

        if (key !== playbackState.lastRenderedDialogueKey || text !== playbackState.lastRenderedText) {
            playbackState.lastRenderedText = text;
            playbackState.lastRenderedDialogueKey = key;
            playbackState.renderedTextChanges += 1;
            pushLimited(playbackState.recentRenderedTextChanges, {
                at: round(video.currentTime, 3),
                key,
                textLength: text.length,
                activeLines: text ? text.split('\n').length : 0
            }, DEBUG_MAX_ITEMS);
        }

        if (!text) {
            return;
        }

        drawGeneratedDialogueCanvasText(context, text, rect.width, rect.height);
    }

    function drawGeneratedDialogueCanvasText(context, text, width, height) {
        const settings = generatedSubtitleSettings;
        const scale = Number(settings.scale) || 1;
        const fontSize = Math.max(1, Number(settings.fontSize) * scale);
        const lineHeight = fontSize * (Number(settings.lineHeight) || 1.18);
        const paddingX = Math.max(0, Number(settings.paddingX) * scale);
        const paddingY = Math.max(0, Number(settings.paddingY) * scale);
        const radius = Math.max(0, Number(settings.borderRadius) * scale);
        const maxBoxWidth = Math.max(24, width * 0.92);
        const maxTextWidth = Math.max(16, maxBoxWidth - paddingX * 2);
        const fontFamily = cssString(settings.fontFamily || DEFAULT_GENERATED_SUBTITLE_SETTINGS.fontFamily);
        const fontWeight = Number(settings.fontWeight) || 500;

        context.save();
        context.font = `${fontWeight} ${round(fontSize, 3)}px ${fontFamily}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        if ('letterSpacing' in context) {
            context.letterSpacing = `${round((Number(settings.letterSpacing) || 0) * scale, 3)}px`;
        }

        const lines = getCanvasSubtitleLines(context, text, maxTextWidth);
        if (!lines.length) {
            context.restore();
            return;
        }

        const textWidth = Math.min(maxTextWidth, Math.max(...lines.map((line) => context.measureText(line).width)));
        const boxWidth = Math.min(maxBoxWidth, Math.ceil(textWidth + paddingX * 2));
        const boxHeight = Math.ceil(lines.length * lineHeight + paddingY * 2);
        const boxX = (width - boxWidth) / 2;
        const boxY = Math.max(0, height - cssLengthToPixels(settings.verticalPosition, width, height, fontSize) - boxHeight);
        const centerX = width / 2;
        const firstLineY = boxY + paddingY + lineHeight / 2;

        if (Number(settings.backgroundOpacity) > 0) {
            context.fillStyle = colorWithOpacity(settings.backgroundColor, settings.backgroundOpacity);
            drawRoundedCanvasRect(context, boxX, boxY, boxWidth, boxHeight, radius);
            context.fill();
        }

        const outlineWidth = Math.max(0, Number(settings.outlineWidth) * scale);
        if (outlineWidth > 0) {
            context.lineJoin = 'round';
            context.miterLimit = 2;
            context.lineWidth = outlineWidth * 2;
            context.strokeStyle = settings.outlineColor;
            context.shadowColor = 'transparent';
            context.shadowBlur = 0;
            lines.forEach((line, index) => {
                context.strokeText(line, centerX, firstLineY + index * lineHeight, maxTextWidth);
            });
        }

        context.fillStyle = settings.textColor;
        context.shadowColor = colorWithOpacity(settings.shadowColor, 0.9);
        context.shadowBlur = Math.max(0, Number(settings.shadowBlur) * scale);
        context.shadowOffsetX = 0;
        context.shadowOffsetY = 0;
        lines.forEach((line, index) => {
            context.fillText(line, centerX, firstLineY + index * lineHeight, maxTextWidth);
        });

        context.restore();
    }

    function getCanvasSubtitleLines(context, text, maxWidth) {
        return String(text || '').split('\n').flatMap((line) => wrapCanvasSubtitleLine(context, line, maxWidth));
    }

    function wrapCanvasSubtitleLine(context, line, maxWidth) {
        const value = String(line || '').trim();
        if (!value || context.measureText(value).width <= maxWidth) {
            return value ? [value] : [];
        }

        const words = value.split(/\s+/);
        const wrapped = [];
        let current = '';

        words.forEach((word) => {
            const next = current ? `${current} ${word}` : word;
            if (context.measureText(next).width <= maxWidth) {
                current = next;
                return;
            }

            if (current) {
                wrapped.push(current);
            }

            if (context.measureText(word).width <= maxWidth) {
                current = word;
                return;
            }

            const pieces = splitLongCanvasWord(context, word, maxWidth);
            wrapped.push(...pieces.slice(0, -1));
            current = pieces[pieces.length - 1] || '';
        });

        if (current) {
            wrapped.push(current);
        }

        return wrapped;
    }

    function splitLongCanvasWord(context, word, maxWidth) {
        const pieces = [];
        let current = '';

        Array.from(String(word || '')).forEach((character) => {
            const next = `${current}${character}`;
            if (!current || context.measureText(next).width <= maxWidth) {
                current = next;
                return;
            }

            pieces.push(current);
            current = character;
        });

        if (current) {
            pieces.push(current);
        }

        return pieces;
    }

    function cssLengthToPixels(value, width, height, fontSize) {
        const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)(px|%|vh|vw|rem|em)$/i);
        if (!match) {
            return 0;
        }

        const number = Number(match[1]);
        const unit = match[2].toLowerCase();
        if (unit === 'px') {
            return number;
        }
        if (unit === '%') {
            return height * number / 100;
        }
        if (unit === 'vh') {
            return window.innerHeight * number / 100;
        }
        if (unit === 'vw') {
            return window.innerWidth * number / 100;
        }
        if (unit === 'rem') {
            return (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * number;
        }
        if (unit === 'em') {
            return fontSize * number;
        }

        return width * 0;
    }

    function colorWithOpacity(color, opacity) {
        return `rgb(${hexToRgbTuple(color)} / ${clampNumber(opacity, 0, 1, 1)})`;
    }

    function drawRoundedCanvasRect(context, x, y, width, height, radius) {
        const maxRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
        context.beginPath();
        if (typeof context.roundRect === 'function') {
            context.roundRect(x, y, width, height, maxRadius);
            return;
        }

        context.moveTo(x + maxRadius, y);
        context.lineTo(x + width - maxRadius, y);
        context.quadraticCurveTo(x + width, y, x + width, y + maxRadius);
        context.lineTo(x + width, y + height - maxRadius);
        context.quadraticCurveTo(x + width, y + height, x + width - maxRadius, y + height);
        context.lineTo(x + maxRadius, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - maxRadius);
        context.lineTo(x, y + maxRadius);
        context.quadraticCurveTo(x, y, x + maxRadius, y);
        context.closePath();
    }

    function renderGeneratedAnnotations(time, geometryChanged = false) {
        const layer = playbackState.annotationLayer;
        if (!layer) {
            return;
        }

        const activeCues = playbackState.annotationCues
            .filter((cue) => time >= cue.start && time <= cue.end)
            .sort((a, b) => a.layer - b.layer || a.start - b.start);
        const activeKeys = activeCues.map((cue) => cue.id).join('|');

        const activeKeysChanged = activeKeys !== playbackState.lastAnnotationKeys;
        if (activeKeysChanged) {
            for (const [key, node] of playbackState.annotationNodes.entries()) {
                if (!activeCues.some((cue) => cue.id === key)) {
                    node.remove();
                    playbackState.annotationNodes.delete(key);
                }
            }

            activeCues.forEach((cue) => {
                if (!playbackState.annotationNodes.has(cue.id)) {
                    const node = document.createElement('div');
                    node.className = 'crsr-generated-annotation';
                    node.textContent = cue.text;
                    layer.appendChild(node);
                    playbackState.annotationNodes.set(cue.id, node);
                }
            });

            playbackState.lastAnnotationKeys = activeKeys;
        }

        activeCues.forEach((cue) => {
            const node = playbackState.annotationNodes.get(cue.id);
            if (node && (activeKeysChanged || geometryChanged || cue.overrides.move)) {
                applyGeneratedAnnotationStyle(node, cue, time);
            }
        });
    }

    function clearGeneratedAnnotationNodes() {
        playbackState.annotationNodes.forEach((node) => node.remove());
        playbackState.annotationNodes.clear();
        if (playbackState.annotationLayer) {
            playbackState.annotationLayer.textContent = '';
        }
    }

    function applyGeneratedAnnotationStyle(node, cue, time) {
        const overlay = playbackState.overlay;
        if (!overlay) {
            return;
        }

        const rect = overlay.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return;
        }

        const style = cue.style || getAssStyle(new Map(), cue.styleName);
        const scaleX = rect.width / (cue.playResX || 1920);
        const scaleY = rect.height / (cue.playResY || 1080);
        const scale = Math.min(scaleX, scaleY);
        const alignment = cue.overrides.alignment || style.alignment || 2;
        const position = getAssAnnotationPosition(cue, rect, scaleX, scaleY, time, alignment);
        const fontSize = (cue.overrides.fontSize || style.fontSize) * scale;
        const outline = Math.max(0, (cue.overrides.outline ?? style.outline) * scale);
        const shadow = Math.max(0, (cue.overrides.shadow ?? style.shadow) * scale);
        const scaleOverrideX = (cue.overrides.scaleX ?? style.scaleX ?? 100) / 100;
        const scaleOverrideY = (cue.overrides.scaleY ?? style.scaleY ?? 100) / 100;
        const angle = cue.overrides.angle ?? style.angle ?? 0;
        const anchor = getAssAlignmentAnchor(alignment);

        node.style.left = `${round(position.x, 3)}px`;
        node.style.top = `${round(position.y, 3)}px`;
        node.style.zIndex = String(10 + (cue.layer || 0));
        node.style.color = cue.overrides.primaryColor || style.primaryColor;
        node.style.fontFamily = cssString(cue.overrides.fontName || style.fontName || 'Arial');
        node.style.fontSize = `${round(fontSize, 3)}px`;
        node.style.fontWeight = cue.overrides.bold ?? style.bold ? '700' : '400';
        node.style.fontStyle = cue.overrides.italic ?? style.italic ? 'italic' : 'normal';
        node.style.textDecoration = style.underline ? 'underline' : 'none';
        node.style.letterSpacing = `${round((style.spacing || 0) * scale, 3)}px`;
        node.style.textShadow = buildAssTextShadow(outline, cue.overrides.outlineColor || style.outlineColor, shadow, cue.overrides.backColor || style.backColor);
        node.style.transformOrigin = getAssTransformOrigin(anchor);
        node.style.transform = `translate(${anchor.translateX}, ${anchor.translateY}) rotate(${round(angle, 3)}deg) scale(${round(scaleOverrideX, 3)}, ${round(scaleOverrideY, 3)})`;
    }

    function getAssAnnotationPosition(cue, rect, scaleX, scaleY, time, alignment) {
        if (cue.overrides.move) {
            const move = cue.overrides.move;
            const duration = Math.max(0.001, (move.t2 ?? (cue.end - cue.start)) - (move.t1 ?? 0));
            const elapsed = Math.min(duration, Math.max(0, time - cue.start - (move.t1 ?? 0)));
            const progress = elapsed / duration;
            return {
                x: (move.x1 + (move.x2 - move.x1) * progress) * scaleX,
                y: (move.y1 + (move.y2 - move.y1) * progress) * scaleY
            };
        }

        if (cue.overrides.position) {
            return {
                x: cue.overrides.position.x * scaleX,
                y: cue.overrides.position.y * scaleY
            };
        }

        const anchor = getAssAlignmentAnchor(alignment);
        const marginLeft = cue.margins.left * scaleX;
        const marginRight = cue.margins.right * scaleX;
        const marginVertical = cue.margins.vertical * scaleY;

        return {
            x: anchor.horizontal === 'left'
                ? marginLeft
                : anchor.horizontal === 'right'
                    ? rect.width - marginRight
                    : rect.width / 2,
            y: anchor.vertical === 'top'
                ? marginVertical
                : anchor.vertical === 'bottom'
                    ? rect.height - marginVertical
                    : rect.height / 2
        };
    }

    function getAssAlignmentAnchor(alignment) {
        const normalized = Number(alignment) || 2;
        const horizontal = [1, 4, 7].includes(normalized)
            ? 'left'
            : [3, 6, 9].includes(normalized)
                ? 'right'
                : 'center';
        const vertical = [7, 8, 9].includes(normalized)
            ? 'top'
            : [4, 5, 6].includes(normalized)
                ? 'middle'
                : 'bottom';

        return {
            horizontal,
            vertical,
            translateX: horizontal === 'left' ? '0' : horizontal === 'right' ? '-100%' : '-50%',
            translateY: vertical === 'top' ? '0' : vertical === 'bottom' ? '-100%' : '-50%'
        };
    }

    function getAssTransformOrigin(anchor) {
        const x = anchor.horizontal === 'left'
            ? 'left'
            : anchor.horizontal === 'right'
                ? 'right'
                : 'center';
        const y = anchor.vertical === 'top'
            ? 'top'
            : anchor.vertical === 'bottom'
                ? 'bottom'
                : 'center';

        return `${x} ${y}`;
    }

    function buildAssTextShadow(outline, outlineColor, shadow, shadowColor) {
        const shadows = [];
        const roundedOutline = Math.round(outline);
        for (let offsetX = -roundedOutline; offsetX <= roundedOutline; offsetX += 1) {
            for (let offsetY = -roundedOutline; offsetY <= roundedOutline; offsetY += 1) {
                if (offsetX || offsetY) {
                    shadows.push(`${offsetX}px ${offsetY}px 0 ${outlineColor}`);
                }
            }
        }

        if (shadow > 0) {
            shadows.push(`${round(shadow, 3)}px ${round(shadow, 3)}px 0 ${shadowColor}`);
        }

        return shadows.length ? shadows.join(', ') : 'none';
    }

    function syncGeneratedSubtitleOverlayToVideo(video) {
        const overlay = playbackState.overlay;
        const container = overlay?.parentElement;
        if (!overlay || !container) {
            return false;
        }

        const videoRect = video.getBoundingClientRect();
        const fullscreenElement = getFullscreenElement();
        const useViewportCoordinates = container === document.body && !fullscreenElement;
        const containerRect = useViewportCoordinates ? null : container.getBoundingClientRect();
        if (!videoRect.width || !videoRect.height ||
            (!useViewportCoordinates && (!containerRect.width || !containerRect.height))) {
            return false;
        }

        const nextGeometry = {
            mode: useViewportCoordinates ? 'fixed' : 'absolute',
            left: round(useViewportCoordinates ? videoRect.left : videoRect.left - containerRect.left, 3),
            top: round(useViewportCoordinates ? videoRect.top : videoRect.top - containerRect.top, 3),
            width: round(videoRect.width, 3),
            height: round(videoRect.height, 3)
        };
        if (!hasOverlayGeometryChanged(nextGeometry)) {
            return false;
        }

        playbackState.lastOverlayGeometry = nextGeometry;
        overlay.style.setProperty('--crsr-generated-overlay-position', nextGeometry.mode);
        overlay.style.setProperty('--crsr-generated-video-left', `${nextGeometry.left}px`);
        overlay.style.setProperty('--crsr-generated-video-top', `${nextGeometry.top}px`);
        overlay.style.setProperty('--crsr-generated-video-width', `${nextGeometry.width}px`);
        overlay.style.setProperty('--crsr-generated-video-height', `${nextGeometry.height}px`);
        return true;
    }

    function hasOverlayGeometryChanged(nextGeometry) {
        const previous = playbackState.lastOverlayGeometry;
        if (!previous) {
            return true;
        }

        return Math.abs(previous.left - nextGeometry.left) > 0.25 ||
            Math.abs(previous.top - nextGeometry.top) > 0.25 ||
            Math.abs(previous.width - nextGeometry.width) > 0.25 ||
            Math.abs(previous.height - nextGeometry.height) > 0.25 ||
            previous.mode !== nextGeometry.mode;
    }

    function getGeneratedSubtitleGeometry() {
        const video = getPrimaryVideo();
        const overlay = playbackState.overlay;
        const anchor = playbackState.overlayAnchor;
        const text = playbackState.overlayText;
        const videoRect = video?.getBoundingClientRect();
        const overlayRect = overlay?.getBoundingClientRect();
        const anchorRect = anchor?.getBoundingClientRect();
        const textRect = text?.getBoundingClientRect();

        return {
            video: summarizeRect(videoRect),
            overlay: summarizeRect(overlayRect),
            anchor: summarizeRect(anchorRect),
            text: summarizeRect(textRect),
            deltas: {
                overlayVsVideoCenterX: centerDeltaX(overlayRect, videoRect),
                anchorVsVideoCenterX: centerDeltaX(anchorRect, videoRect),
                textVsVideoCenterX: centerDeltaX(textRect, videoRect)
            }
        };
    }

    function summarizeRect(rect) {
        if (!rect) {
            return null;
        }

        return {
            x: round(rect.x, 3),
            y: round(rect.y, 3),
            width: round(rect.width, 3),
            height: round(rect.height, 3),
            centerX: round(rect.left + rect.width / 2, 3),
            centerY: round(rect.top + rect.height / 2, 3)
        };
    }

    function centerDeltaX(rect, referenceRect) {
        if (!rect || !referenceRect) {
            return null;
        }

        return round((rect.left + rect.width / 2) - (referenceRect.left + referenceRect.width / 2), 3);
    }

    function getActiveGeneratedDialogue(time) {
        const cues = playbackState.cues;
        const activeCues = [];

        for (let index = 0; index < cues.length; index += 1) {
            const cue = cues[index];
            if (cue.start > time + 0.05) {
                break;
            }
            if (time >= cue.start && time <= cue.end) {
                activeCues.push(cue);
            }
        }

        if (!activeCues.length) {
            return getEmptyGeneratedDialogue(time);
        }

        const sortedCues = activeCues.sort((a, b) => {
            return (a.layer || 0) - (b.layer || 0) ||
                a.start - b.start ||
                String(a.id || '').localeCompare(String(b.id || ''));
        });
        const text = uniqueStrings(sortedCues.map((cue) => cue.text).filter(Boolean)).join('\n');
        const key = sortedCues.map((cue) => cue.id || `${cue.start}-${cue.end}-${cue.text}`).join('|');

        playbackState.lastNonEmptyDialogueText = text;
        playbackState.lastNonEmptyDialogueAt = performance.now();
        playbackState.lastNonEmptyDialogueVideoTime = time;

        return {
            text,
            key
        };
    }

    function getEmptyGeneratedDialogue(time) {
        const localHoldMs = playbackState.localSubtitleOverride ? 120 : 0;
        const localBridgeGapSeconds = playbackState.localSubtitleOverride ? 0.28 : 0;
        if (localHoldMs && playbackState.lastNonEmptyDialogueText &&
            performance.now() - playbackState.lastNonEmptyDialogueAt <= localHoldMs) {
            return {
                text: playbackState.lastNonEmptyDialogueText,
                key: playbackState.lastRenderedDialogueKey || 'local-hold'
            };
        }

        const previousGapSeconds = time - playbackState.lastNonEmptyDialogueVideoTime;
        const nextGapSeconds = getNextGeneratedCueStart(time) - time;
        if (localBridgeGapSeconds && playbackState.lastNonEmptyDialogueText &&
            previousGapSeconds >= 0 && previousGapSeconds <= localBridgeGapSeconds &&
            nextGapSeconds >= 0 && nextGapSeconds <= localBridgeGapSeconds) {
            return {
                text: playbackState.lastNonEmptyDialogueText,
                key: playbackState.lastRenderedDialogueKey || 'local-bridge'
            };
        }

        return {
            text: '',
            key: ''
        };
    }

    function getNextGeneratedCueStart(time) {
        const nextCue = playbackState.cues.find((cue) => cue.start > time);
        return nextCue ? nextCue.start : Number.POSITIVE_INFINITY;
    }

    function installFullscreenHooks() {
        document.addEventListener('fullscreenchange', handleGeneratedFullscreenChange, true);
        document.addEventListener('webkitfullscreenchange', handleGeneratedFullscreenChange, true);
    }

    function handleGeneratedFullscreenChange() {
        if (!GENERATED_SUBTITLE_OVERLAY) {
            return;
        }

        playbackState.lastOverlayGeometry = null;
        requestAnimationFrame(() => refreshGeneratedSubtitleOverlay('fullscreenchange'));
        setTimeout(() => refreshGeneratedSubtitleOverlay('fullscreenchange-settled'), 180);
    }

    function refreshGeneratedSubtitleOverlay(reason) {
        if (!GENERATED_SUBTITLE_OVERLAY || (!playbackState.cues.length && !playbackState.annotationCues.length)) {
            return null;
        }

        const previousOverlay = playbackState.overlay;
        const overlay = ensureGeneratedSubtitleOverlay();
        const video = getPrimaryVideo();
        const geometryChanged = video ? syncGeneratedSubtitleOverlayToVideo(video) : false;

        if (video) {
            renderGeneratedAnnotations(video.currentTime, true);
        }

        debugLog('generated subtitle overlay refreshed', {
            reason,
            fullscreen: Boolean(getFullscreenElement()),
            overlayMoved: Boolean(previousOverlay && overlay && previousOverlay !== overlay),
            geometryChanged
        });

        return overlay;
    }

    function ensureGeneratedSubtitleOverlay() {
        const video = getPrimaryVideo();
        if (!video) {
            return null;
        }

        const container = getVideoOverlayContainer(video);
        if (!container) {
            return null;
        }

        if (playbackState.overlay?.parentNode !== container) {
            playbackState.overlay?.remove();
            resetGeneratedOverlayReferences();
        }

        if (playbackState.overlay && (
            playbackState.dialogueCanvas?.parentNode !== playbackState.overlay ||
            playbackState.annotationLayer?.parentNode !== playbackState.overlay ||
            playbackState.overlayAnchor?.parentNode !== playbackState.overlay ||
            playbackState.overlayText?.parentNode !== playbackState.overlayAnchor
        )) {
            playbackState.overlay.remove();
            resetGeneratedOverlayReferences();
        }

        if (!playbackState.overlay) {
            if (container !== document.body && getComputedStyle(container).position === 'static') {
                container.style.setProperty('position', 'relative', 'important');
            }

            const overlay = document.createElement('div');
            overlay.id = 'crsr-generated-subtitle-overlay';
            const dialogueCanvas = document.createElement('canvas');
            dialogueCanvas.id = 'crsr-generated-dialogue-canvas';
            const annotationLayer = document.createElement('div');
            annotationLayer.id = 'crsr-generated-annotation-layer';
            const anchor = document.createElement('div');
            anchor.id = 'crsr-generated-subtitle-anchor';
            const text = document.createElement('div');
            text.id = 'crsr-generated-subtitle-text';
            text.style.setProperty('visibility', 'hidden', 'important');
            anchor.appendChild(text);
            overlay.appendChild(dialogueCanvas);
            overlay.appendChild(annotationLayer);
            overlay.appendChild(anchor);
            container.appendChild(overlay);
            playbackState.overlay = overlay;
            playbackState.dialogueCanvas = dialogueCanvas;
            playbackState.dialogueCanvasContext = dialogueCanvas.getContext('2d');
            playbackState.annotationLayer = annotationLayer;
            playbackState.overlayAnchor = anchor;
            playbackState.overlayText = text;
            playbackState.lastRenderedText = null;
            playbackState.lastRenderedDialogueKey = null;
            playbackState.lastDialogueCanvasSignature = null;
            playbackState.lastOverlayGeometry = null;
            playbackState.lastAnnotationKeys = '';
            debugLog('generated subtitle overlay attached', describeElement(container));
        }

        return playbackState.overlay;
    }

    function resetGeneratedOverlayReferences() {
        clearGeneratedAnnotationNodes();
        playbackState.overlay = null;
        playbackState.dialogueCanvas = null;
        playbackState.dialogueCanvasContext = null;
        playbackState.annotationLayer = null;
        playbackState.overlayAnchor = null;
        playbackState.overlayText = null;
        playbackState.lastRenderedText = null;
        playbackState.lastRenderedDialogueKey = null;
        playbackState.lastDialogueCanvasSignature = null;
        playbackState.lastOverlayGeometry = null;
        playbackState.lastAnnotationKeys = '';
    }

    function getVideoOverlayContainer(video) {
        const fullscreenElement = getFullscreenElement();
        if (fullscreenElement && fullscreenElement !== video && fullscreenElement.contains(video)) {
            return fullscreenElement;
        }

        return document.body ||
            getPositionedVideoOverlayContainer(video) ||
            video.parentElement ||
            getVisiblePlayers()[0]?.element;
    }

    function getPositionedVideoOverlayContainer(video) {
        const videoRect = video.getBoundingClientRect();
        if (!videoRect.width || !videoRect.height) {
            return null;
        }

        let current = video.parentElement;
        let fallback = null;

        while (current && current !== document.body && current !== document.documentElement) {
            const rect = current.getBoundingClientRect();
            if (!rectMostlyInside(videoRect, rect)) {
                current = current.parentElement;
                continue;
            }

            const isReasonableSize = rect.width <= videoRect.width * 1.5 &&
                rect.height <= videoRect.height * 1.5 + 120;
            if (!isReasonableSize) {
                current = current.parentElement;
                continue;
            }

            const computed = getComputedStyle(current);
            if (computed.position !== 'static') {
                return current;
            }

            fallback = fallback || current;
            current = current.parentElement;
        }

        return fallback;
    }

    function getFullscreenElement() {
        return document.fullscreenElement ||
            document.webkitFullscreenElement ||
            null;
    }

    function getPrimaryVideo() {
        return deepQueryAll('video')
            .find((video) => video instanceof HTMLVideoElement && video.readyState >= 1) ||
            deepQueryAll('video')[0] ||
            null;
    }

    function recordPlaybackError(message, error, data) {
        const safeData = data ? {
            ...data,
            url: data.url ? redactUrl(data.url) : data.url
        } : null;
        const entry = {
            message,
            error: {
                name: error?.name,
                message: error?.message
            },
            data: safeData
        };
        pushLimited(playbackState.errors, entry, DEBUG_MAX_ITEMS);
        debugError(message, error, safeData);
    }

    function isPlaybackV3Url(url) {
        return PLAYBACK_V3_PATTERN.test(String(url || ''));
    }

    function cloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function installNetworkHooks() {
        patchFetch(window, 'window');
        patchXhr(window, 'window');
        installPerformanceObserver();

        if (DEBUG_WINDOW !== window) {
            patchFetch(DEBUG_WINDOW, 'unsafeWindow');
            patchXhr(DEBUG_WINDOW, 'unsafeWindow');
        }

        debugLog('network hooks installed', {
            fetchPatched: networkState.fetchPatched,
            xhrPatched: networkState.xhrPatched,
            performanceObserved: networkState.performanceObserved
        });
    }

    function installPerformanceObserver() {
        if (networkState.performanceObserved || typeof PerformanceObserver !== 'function') {
            return;
        }

        try {
            const observer = new PerformanceObserver((list) => {
                list.getEntries().forEach(recordPerformanceResource);
            });
            observer.observe({
                type: 'resource',
                buffered: true
            });
            networkState.performanceObserved = true;
        } catch (error) {
            recordNetworkError('performance observer failed', error);
        }
    }

    function recordPerformanceResource(entry) {
        if (!entry?.name) {
            return;
        }

        recordNetworkUrl(entry.name, {
            source: 'performance',
            context: entry.initiatorType || null,
            method: null,
            status: null,
            contentType: null
        });
    }

    function patchFetch(target, context) {
        try {
            const originalFetch = target?.fetch;
            if (typeof originalFetch !== 'function' || originalFetch.__crsrPatched) {
                return;
            }

            const wrappedFetch = function crsrFetch(input, init) {
                const requestUrl = getFetchInputUrl(input);
                const method = init?.method || input?.method || 'GET';

                let fetchResult;
                try {
                    fetchResult = originalFetch.apply(this, arguments);
                } catch (error) {
                    recordNetworkError('fetch threw', error, { url: requestUrl, context });
                    throw error;
                }

                return Promise.resolve(fetchResult).then(async (response) => {
                    const responseUrl = normalizeNetworkUrl(response?.url || requestUrl);
                    const contentType = getResponseHeader(response, 'content-type');
                    const status = typeof response?.status === 'number' ? response.status : null;
                    const meta = {
                        source: 'fetch',
                        context,
                        method,
                        status,
                        contentType
                    };

                    recordNetworkUrl(responseUrl, meta);
                    captureFetchBodyIfUseful(response, responseUrl, meta);

                    if (response?.ok && String(method).toUpperCase() === 'GET' && isPlaybackV3Url(responseUrl)) {
                        const playbackResponse = await handlePlaybackV3FetchResponse(response, responseUrl, meta);
                        if (playbackResponse) {
                            return playbackResponse;
                        }
                    }

                    return response;
                }, (error) => {
                    recordNetworkError('fetch rejected', error, { url: requestUrl, context });
                    throw error;
                });
            };

            Object.defineProperty(wrappedFetch, '__crsrPatched', { value: true });
            Object.defineProperty(wrappedFetch, '__crsrOriginal', { value: originalFetch });
            target.fetch = wrappedFetch;
            networkState.fetchPatched = true;
        } catch (error) {
            recordNetworkError('fetch patch failed', error, { context });
        }
    }

    function patchXhr(target, context) {
        try {
            const XhrCtor = target?.XMLHttpRequest;
            const proto = XhrCtor?.prototype;
            if (!proto || proto.__crsrPatched) {
                return;
            }

            const originalOpen = proto.open;
            const originalSend = proto.send;

            proto.open = function crsrOpen(method, url) {
                this.__crsrRequest = {
                    method: method || 'GET',
                    url: normalizeNetworkUrl(url),
                    context
                };

                return originalOpen.apply(this, arguments);
            };

            proto.send = function crsrSend() {
                const xhr = this;
                const request = xhr.__crsrRequest || {};

                const onLoadEnd = () => {
                    const responseUrl = normalizeNetworkUrl(xhr.responseURL || request.url);
                    const contentType = getXhrHeader(xhr, 'content-type');
                    const status = typeof xhr.status === 'number' ? xhr.status : null;

                    recordNetworkUrl(responseUrl, {
                        source: 'xhr',
                        context,
                        method: request.method,
                        status,
                        contentType
                    });

                    if (shouldCaptureResponseBody(responseUrl, contentType)) {
                        captureXhrBodyIfUseful(xhr, responseUrl, {
                            source: 'xhr',
                            context,
                            method: request.method,
                            status,
                            contentType
                        });
                    }
                };

                try {
                    xhr.addEventListener('loadend', onLoadEnd, { once: true });
                } catch (error) {
                    recordNetworkError('xhr loadend listener failed', error, { url: request.url, context });
                }

                try {
                    return originalSend.apply(this, arguments);
                } catch (error) {
                    recordNetworkError('xhr send threw', error, { url: request.url, context });
                    throw error;
                }
            };

            Object.defineProperty(proto, '__crsrPatched', { value: true });
            networkState.xhrPatched = true;
        } catch (error) {
            recordNetworkError('xhr patch failed', error, { context });
        }
    }

    function getFetchInputUrl(input) {
        return normalizeNetworkUrl(input?.url || input);
    }

    function getResponseHeader(response, name) {
        try {
            return response?.headers?.get?.(name) || null;
        } catch (error) {
            return null;
        }
    }

    function getXhrHeader(xhr, name) {
        try {
            return xhr.getResponseHeader(name) || null;
        } catch (error) {
            return null;
        }
    }

    function captureFetchBodyIfUseful(response, url, meta) {
        if (!response?.clone || !shouldCaptureResponseBody(url, meta.contentType)) {
            return;
        }

        let clone;
        try {
            clone = response.clone();
        } catch (error) {
            recordNetworkError('fetch response clone failed', error, { url, source: meta.source });
            return;
        }

        clone.text().then((text) => {
            recordNetworkBody(url, text, meta);
        }).catch((error) => {
            recordNetworkError('fetch body capture failed', error, { url, source: meta.source });
        });
    }

    function captureXhrBodyIfUseful(xhr, url, meta) {
        const responseType = xhr.responseType || '';
        if (responseType && responseType !== 'text') {
            return;
        }

        try {
            if (typeof xhr.responseText === 'string') {
                recordNetworkBody(url, xhr.responseText, meta);
            }
        } catch (error) {
            recordNetworkError('xhr body capture failed', error, { url, source: meta.source });
        }
    }

    function shouldCaptureResponseBody(url, contentType) {
        const classification = classifyNetworkResource(url, contentType);

        return classification.isManifest ||
            classification.isSubtitleLike ||
            classification.isRelevantJson;
    }

    function recordNetworkUrl(url, meta = {}) {
        const normalizedUrl = normalizeNetworkUrl(url);
        if (!normalizedUrl) {
            return;
        }

        const classification = classifyNetworkResource(normalizedUrl, meta.contentType);
        const hardsubLocale = getHardsubLocaleFromUrl(normalizedUrl);
        const record = {
            at: new Date().toISOString(),
            source: meta.source || null,
            context: meta.context || null,
            method: meta.method || null,
            status: meta.status ?? null,
            contentType: meta.contentType || null,
            url: normalizedUrl,
            isManifest: classification.isManifest,
            isSubtitleLike: classification.isSubtitleLike,
            isRelevantJson: classification.isRelevantJson,
            hardsubLocale
        };

        pushLimited(networkState.requests, record, NETWORK_MAX_RECORDS);

        const addedManifestUrl = classification.isManifest && addUniqueLimited(networkState.manifestUrls, normalizedUrl, NETWORK_MAX_RECORDS);
        const addedSubtitleUrl = classification.isSubtitleLike && addUniqueLimited(networkState.subtitleLikeUrls, normalizedUrl, NETWORK_MAX_RECORDS);
        if (hardsubLocale) {
            addUniqueLimited(networkState.hardsubLocales, hardsubLocale, NETWORK_MAX_RECORDS);
        }

        syncNetworkCounters();

        if (addedManifestUrl) {
            debugLog('network manifest captured', sanitizeNetworkRecord(record));
        } else if (addedSubtitleUrl) {
            debugLog('network subtitle-like resource captured', sanitizeNetworkRecord(record));
        } else {
            debugVerbose('network resource', sanitizeNetworkRecord(record));
        }
    }

    function recordNetworkBody(url, text, meta = {}) {
        const normalizedUrl = normalizeNetworkUrl(url);
        if (!normalizedUrl || typeof text !== 'string') {
            return;
        }

        const classification = classifyNetworkResource(normalizedUrl, meta.contentType, text);
        const hardsubLocale = getHardsubLocaleFromUrl(normalizedUrl);
        const bodyRecord = {
            at: new Date().toISOString(),
            source: meta.source || null,
            context: meta.context || null,
            method: meta.method || null,
            status: meta.status ?? null,
            ok: typeof meta.status === 'number' ? meta.status >= 200 && meta.status < 400 : null,
            contentType: meta.contentType || null,
            url: normalizedUrl,
            hardsubLocale,
            length: text.length,
            snippet: sanitizeBodySnippet(text, NETWORK_BODY_SNIPPET_MAX_CHARS)
        };

        if (classification.isManifest) {
            bodyRecord.summary = parseManifestSummary(text);
            upsertNetworkBody(networkState.manifestBodies, bodyRecord);
            recordNetworkUrl(normalizedUrl, meta);
            warnHardSubManifest(bodyRecord);
            debugLog('network manifest body captured', sanitizeNetworkBodyRecord(bodyRecord));
        } else if (classification.isSubtitleLike) {
            upsertNetworkBody(networkState.subtitleBodies, bodyRecord);
            recordNetworkUrl(normalizedUrl, meta);
            debugLog('network subtitle body captured', sanitizeNetworkBodyRecord(bodyRecord));
        } else if (classification.isRelevantJson) {
            upsertNetworkBody(networkState.jsonBodies, bodyRecord);
            if (isPlaybackV3Url(normalizedUrl)) {
                try {
                    recordPlaybackResponse(JSON.parse(text), normalizedUrl, meta);
                    queueGeneratedSubtitleLoad('network-json');
                } catch (error) {
                    recordPlaybackError('captured playback json parse failed', error, { url: normalizedUrl });
                }
            }
            debugVerbose('network playback json captured', sanitizeNetworkBodyRecord(bodyRecord));
        }

        syncNetworkCounters();
    }

    function classifyNetworkResource(url, contentType = '', text = '') {
        const value = String(url || '');
        const type = String(contentType || '');
        const sample = String(text || '').slice(0, 1000);
        const isManifest = MANIFEST_URL_PATTERN.test(value) ||
            MANIFEST_CONTENT_TYPE_PATTERN.test(type) ||
            /<MPD\b|^\s*#EXTM3U/im.test(sample);
        const isSubtitleLike = SUBTITLE_RESOURCE_PATTERN.test(value) ||
            SUBTITLE_CONTENT_TYPE_PATTERN.test(type) ||
            /WEBVTT|<tt\b|<tt\s|^\d+\r?\n\d\d:\d\d:\d\d/i.test(sample);
        const isRelevantJson = /json/i.test(type) &&
            /\/playback\/|manifest|stream|media|vilos|watch|content\/v\d|cms\/v\d/i.test(value);

        return {
            isManifest,
            isSubtitleLike,
            isRelevantJson
        };
    }

    function findCapturedManifestBody(url) {
        const normalizedUrl = normalizeNetworkUrl(url);
        return networkState.manifestBodies.find((body) => body.url === normalizedUrl) || null;
    }

    function normalizeNetworkUrl(value) {
        if (!value) {
            return null;
        }

        try {
            return new URL(String(value), location.href).href;
        } catch (error) {
            return String(value);
        }
    }

    function pushLimited(list, item, limit) {
        list.push(item);
        while (list.length > limit) {
            list.shift();
        }
    }

    function addUniqueLimited(list, item, limit) {
        if (!item || list.includes(item)) {
            return false;
        }

        pushLimited(list, item, limit);
        return true;
    }

    function upsertNetworkBody(list, record) {
        const existingIndex = list.findIndex((item) => item.url === record.url);
        if (existingIndex >= 0) {
            list.splice(existingIndex, 1, record);
            return;
        }

        pushLimited(list, record, NETWORK_MAX_RECORDS);
    }

    function syncNetworkCounters() {
        debugState.networkRequests = networkState.requests.length;
        debugState.networkManifestUrls = networkState.manifestUrls.length;
        debugState.networkSubtitleLikeUrls = networkState.subtitleLikeUrls.length;
        debugState.networkManifestBodies = networkState.manifestBodies.length;
    }

    function recordNetworkError(message, error, data) {
        const safeData = data ? {
            ...data,
            url: data.url ? redactUrl(data.url) : data.url
        } : null;
        const entry = {
            message,
            error: {
                name: error?.name,
                message: error?.message
            },
            data: safeData
        };
        pushLimited(networkState.errors, entry, DEBUG_MAX_ITEMS);
        if (!safeData?.url || /crunchyroll|playback|manifest|subtitle|caption|timedtext|texttrack/i.test(safeData.url)) {
            debugError(message, error, safeData);
        } else {
            debugVerbose('network error suppressed', entry);
        }
    }

    function warnHardSubManifest(record) {
        const summary = record.summary || {};
        const key = record.url || record.hardsubLocale || 'unknown';
        const hasSoftSubtitleSignal = summary.hasTextAdaptationSet ||
            summary.hasTextTrackCodecs ||
            summary.hasVttText ||
            summary.hasHlsSubtitles;

        if (!record.hardsubLocale || hasSoftSubtitleSignal || warnedHardsubManifests.has(key)) {
            return;
        }

        warnedHardsubManifests.add(key);
        console.warn(DEBUG_PREFIX, 'hard-subbed playback detected; CSS cannot resize subtitles burned into the video', {
            hardsubLocale: record.hardsubLocale,
            url: redactUrl(record.url),
            manifestKind: summary.manifestKind,
            adaptationSets: summary.adaptationSets,
            codecs: summary.codecs
        });
    }

    function warnHardSubPlayback(result) {
        console.warn(DEBUG_PREFIX, 'confirmed hard-subbed playback; no DOM, canvas, textTracks, VTT, TTML, or subtitle adaptation set was detected', {
            hardsubLocales: result.resources?.network?.hardsubLocales || [],
            manifests: result.manifests?.map((manifest) => ({
                url: manifest.url,
                hardsubLocale: manifest.hardsubLocale,
                manifestKind: manifest.manifestKind,
                adaptationSets: manifest.adaptationSets,
                hasTextAdaptationSet: manifest.hasTextAdaptationSet,
                hasTextTrackCodecs: manifest.hasTextTrackCodecs,
                hasVttText: manifest.hasVttText,
                hasHlsSubtitles: manifest.hasHlsSubtitles
            })) || []
        });
    }

    function parseManifestSummary(text) {
        const manifestText = String(text || '');

        if (/^\s*#EXTM3U/im.test(manifestText)) {
            return parseHlsManifestSummary(manifestText);
        }

        const adaptationSets = Array.from(manifestText.matchAll(/<AdaptationSet\b([^>]*)>/gi)).map((match) => {
            const attrs = match[1];
            return {
                mimeType: getXmlAttr(attrs, 'mimeType'),
                lang: getXmlAttr(attrs, 'lang'),
                codecs: getXmlAttr(attrs, 'codecs')
            };
        });
        const representationCodecs = Array.from(manifestText.matchAll(/<Representation\b([^>]*)>/gi))
            .map((match) => getXmlAttr(match[1], 'codecs'))
            .filter(Boolean);
        const mimeTypes = adaptationSets.map((set) => set.mimeType).filter(Boolean);
        const allCodecs = [
            ...adaptationSets.map((set) => set.codecs),
            ...representationCodecs
        ].filter(Boolean);
        const textMimePattern = /^(text\/|application\/(?:ttml|x-subrip|cea|mp4))/i;
        const textCodecPattern = /\b(wvtt|stpp|ttml|tx3g|c608|c708)\b/i;

        return {
            manifestKind: 'dash',
            adaptationSetCount: adaptationSets.length,
            adaptationSets,
            mimeTypes,
            codecs: allCodecs,
            hasTextAdaptationSet: mimeTypes.some((mimeType) => textMimePattern.test(mimeType)),
            hasTextTrackCodecs: allCodecs.some((codecs) => textCodecPattern.test(codecs)),
            hasHlsSubtitles: false,
            hasVttText: /WEBVTT|\.vtt|text\/vtt/i.test(manifestText),
            manifestSnippet: sanitizeBodySnippet(manifestText, 500)
        };
    }

    function parseHlsManifestSummary(text) {
        const mediaLines = Array.from(text.matchAll(/^#EXT-X-MEDIA:([^\n\r]*)/gim)).map((match) => match[1]);
        const subtitleLines = mediaLines.filter((line) => /TYPE=SUBTITLES/i.test(line));
        const closedCaptionLines = mediaLines.filter((line) => /TYPE=CLOSED-CAPTIONS/i.test(line));
        const streamInfLines = Array.from(text.matchAll(/^#EXT-X-STREAM-INF:([^\n\r]*)/gim)).map((match) => match[1]);
        const subtitleGroups = streamInfLines
            .map((line) => getM3u8Attr(line, 'SUBTITLES'))
            .filter(Boolean)
            .filter(uniqueFilter);
        const closedCaptionGroups = streamInfLines
            .map((line) => getM3u8Attr(line, 'CLOSED-CAPTIONS'))
            .filter(Boolean)
            .filter(uniqueFilter);

        return {
            manifestKind: 'hls',
            adaptationSetCount: 0,
            adaptationSets: [],
            mimeTypes: [],
            codecs: Array.from(text.matchAll(/CODECS="([^"]+)"/gi)).map((match) => match[1]),
            hasTextAdaptationSet: subtitleLines.length > 0 || closedCaptionLines.length > 0,
            hasTextTrackCodecs: false,
            hasHlsSubtitles: subtitleLines.length > 0 || subtitleGroups.length > 0,
            hasHlsClosedCaptions: closedCaptionLines.length > 0 || closedCaptionGroups.length > 0,
            hasVttText: /WEBVTT|\.vtt|text\/vtt/i.test(text),
            hlsSubtitleLines: subtitleLines.map((line) => sanitizeBodySnippet(line, 500)).slice(0, DEBUG_MAX_ITEMS),
            hlsClosedCaptionLines: closedCaptionLines.map((line) => sanitizeBodySnippet(line, 500)).slice(0, DEBUG_MAX_ITEMS),
            hlsSubtitleGroups: subtitleGroups,
            hlsClosedCaptionGroups: closedCaptionGroups,
            manifestSnippet: sanitizeBodySnippet(text, 500)
        };
    }

    function getManifestUrls() {
        return [
            ...networkState.manifestUrls,
            ...getPerformanceResourceUrls().filter((url) => MANIFEST_URL_PATTERN.test(url))
        ]
            .filter(uniqueFilter);
    }

    function getSubtitleLikeResourceUrls() {
        return [
            ...networkState.subtitleLikeUrls,
            ...getPerformanceResourceUrls().filter((url) => SUBTITLE_RESOURCE_PATTERN.test(url))
        ]
            .filter((url) => !/\/subs\/v2\/products\//i.test(url))
            .filter(uniqueFilter);
    }

    function getPerformanceResourceUrls() {
        return performance.getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter(Boolean);
    }

    function getHardsubLocaleFromUrl(url) {
        const match = String(url).match(/\/static\/[^/]+\/\d+\/([^/?#]+)\/(?:dash|hls)\//i);
        if (!match) {
            return null;
        }

        const locale = decodeURIComponent(match[1]);
        return locale && locale.toLowerCase() !== 'none' ? locale : null;
    }

    function getXmlAttr(attrs, name) {
        const match = String(attrs).match(new RegExp(`${name}="([^"]*)"`, 'i'));
        return match ? match[1] : null;
    }

    function getM3u8Attr(attrs, name) {
        const match = String(attrs).match(new RegExp(`${name}=("[^"]*"|[^,]*)`, 'i'));
        if (!match) {
            return null;
        }

        return match[1].replace(/^"|"$/g, '');
    }

    function uniqueFilter(value, index, array) {
        return array.indexOf(value) === index;
    }

    function getPlayerTextProbeItems(players = getVisiblePlayers()) {
        if (!players.length) {
            return [];
        }

        const seen = new Set();

        return deepQueryAll('*').reduce((items, element) => {
            if (!(element instanceof HTMLElement) || seen.has(element)) {
                return items;
            }

            seen.add(element);

            const rect = element.getBoundingClientRect();
            const player = players.find(({ rect: playerRect }) => rectMostlyInside(rect, playerRect));
            if (!player) {
                return items;
            }

            const computed = getComputedStyle(element);
            if (!isVisibleTextElement(rect, computed)) {
                return items;
            }

            const text = getElementDebugText(element);
            if (!text) {
                return items;
            }

            const rejectReason = getHeuristicRejectReason(element, rect, computed, player.rect, true);
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            items.push({
                rejectReason,
                text: text.slice(0, 180),
                selector: describeElement(element).selector,
                tag: element.tagName.toLowerCase(),
                id: element.id || null,
                className: element.className?.toString() || null,
                directText: getDirectText(element).slice(0, 180),
                player: describeElement(player.element).selector,
                rect: {
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    verticalRatio: round((centerY - player.rect.top) / player.rect.height, 3),
                    horizontalRatio: round((centerX - player.rect.left) / player.rect.width, 3)
                },
                style: {
                    display: computed.display,
                    visibility: computed.visibility,
                    opacity: computed.opacity,
                    position: computed.position,
                    fontSize: computed.fontSize,
                    zIndex: computed.zIndex,
                    transform: computed.transform,
                    scale: computed.scale
                }
            });

            return items;
        }, []);
    }

    function getElementDebugText(element) {
        const before = getPseudoText(element, '::before');
        const after = getPseudoText(element, '::after');
        return normalizeText([
            element.textContent,
            before,
            after
        ].filter(Boolean).join(' '));
    }

    function getPseudoText(element, pseudo) {
        let content = '';
        try {
            content = getComputedStyle(element, pseudo).content;
        } catch (error) {
            return '';
        }

        if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") {
            return '';
        }

        return normalizeText(content.replace(/^['"]|['"]$/g, ''));
    }

    function round(value, digits) {
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
    }

    function installDebugApi() {
        const api = {
            settings: {
                DEBUG,
                DEBUG_VERBOSE,
                SUBTITLE_SCALE,
                VERTICAL_POSITION,
                FORCE_CLEAN_STREAM_FOR_HARDSUBS,
                GENERATED_SUBTITLE_OVERLAY,
                GENERATED_SUBTITLE_LANGUAGE,
                GENERATED_SUBTITLE_VERTICAL_POSITION
            },
            selectors: {
                PLAYER_SELECTORS,
                SUBTITLE_SELECTORS,
                INTERACTIVE_SELECTORS,
                CONTROLISH_SELECTORS,
                HEURISTIC_TEXT_SELECTOR,
                PLAYER_SUBTITLE_SELECTOR_LIST
            },
            state: debugState,
            scan,
            probe,
            sample,
            analyzePlayback,
            summary: () => cloneDebugState(),
            network: () => cloneNetworkState(),
            generatedSubtitles: () => cloneGeneratedSubtitleState(),
            generatedSubtitleGeometry: () => getGeneratedSubtitleGeometry(),
            downloadCurrentSubtitleFile,
            reloadGeneratedSubtitles: () => loadGeneratedSubtitleFromPlayback('manual-reload', { forceRemote: true }),
            setGeneratedSubtitlePosition,
            setGeneratedSubtitleScale,
            setGeneratedSubtitleLanguage,
            setGeneratedSubtitleStyle,
            loadRequestedFontStylesheet,
            loadGeneratedFontStylesheet,
            resetGeneratedSubtitleSettings,
            rescan: () => {
                registerExistingShadowRoots(document);
                processRoot(document);
                processHeuristicTextOverlays('manual-rescan');
                const result = scan();
                debugLog('manual rescan', result);
                return result;
            }
        };
        window.__CRSR_DEBUG__ = api;
        DEBUG_WINDOW.__CRSR_DEBUG__ = api;
        debugLog('debug API ready: window.__CRSR_DEBUG__.scan()');
    }

    function scan() {
        registerExistingShadowRoots(document);

        const players = getVisiblePlayers();
        const configuredSubtitleMatches = deepQueryAll(PLAYER_SUBTITLE_SELECTOR_LIST);
        const broadSelector = '[id*="subtitle" i], [class*="subtitle" i], [id*="caption" i], [class*="caption" i], [id*="cue" i], [class*="cue" i], [id*="text" i], [class*="text" i], [class*="bmpui" i], [class*="bitmovin" i]';
        const heuristicCandidates = pruneNestedCandidates(getHeuristicTextCandidates(players, true));
        const playerTextProbeItems = getPlayerTextProbeItems(players);
        const manifestUrls = getManifestUrls();
        const subtitleLikeUrls = getSubtitleLikeResourceUrls();
        const playerTextRejectReasonCounts = playerTextProbeItems.reduce((counts, item) => {
            if (item.rejectReason) {
                counts[item.rejectReason] = (counts[item.rejectReason] || 0) + 1;
            }
            return counts;
        }, {});
        const videoDetails = deepQueryAll('video').map((video) => ({
            element: describeElement(video),
            textTracks: Array.from(video.textTracks || []).map((track) => ({
                kind: track.kind,
                label: track.label,
                language: track.language,
                mode: track.mode,
                cues: track.cues ? track.cues.length : null,
                activeCues: track.activeCues ? track.activeCues.length : null
            }))
        }));

        return {
            href: location.href,
            readyState: document.readyState,
            title: document.title,
            counts: {
                players: players.length,
                configuredSubtitleMatches: configuredSubtitleMatches.length,
                heuristicTextCandidates: heuristicCandidates.length,
                playerVisibleText: playerTextProbeItems.length,
                openShadowRoots: knownShadowRoots.size,
                videos: videoDetails.length,
                canvases: deepQueryAll('canvas').length,
                iframes: deepQueryAll('iframe').length,
                manifests: manifestUrls.length,
                subtitleLikeResources: subtitleLikeUrls.length,
                playbackV3Responses: playbackState.responses.length,
                generatedSubtitleCues: playbackState.cues.length,
                generatedAnnotationCues: playbackState.annotationCues.length,
                cleanStreamRewrites: playbackState.cleanStreamRewrites,
                ariaLive: deepQueryAll('[aria-live]').length,
                broadSubtitleLike: deepQueryAll(broadSelector).length,
                playerTextRejectReasonCounts
            },
            players: players.map(({ element }) => describeElement(element)).slice(0, DEBUG_MAX_ITEMS),
            configuredSubtitleMatches: configuredSubtitleMatches.map(describeElement).slice(0, DEBUG_MAX_ITEMS),
            heuristicTextCandidates: heuristicCandidates.map(({ element, player, text }) => ({
                text,
                element: describeElement(element),
                player: describeElement(player).selector
            })).slice(0, DEBUG_MAX_ITEMS),
            playerVisibleText: playerTextProbeItems.slice(0, DEBUG_MAX_ITEMS),
            broadSubtitleLike: deepQueryAll(broadSelector).map(describeElement).slice(0, DEBUG_MAX_ITEMS),
            canvases: deepQueryAll('canvas').map(describeElement).slice(0, DEBUG_MAX_ITEMS),
            iframes: deepQueryAll('iframe').map(describeElement).slice(0, DEBUG_MAX_ITEMS),
            ariaLive: deepQueryAll('[aria-live]').map(describeElement).slice(0, DEBUG_MAX_ITEMS),
            openShadowRoots: Array.from(knownShadowRoots).map(describeRoot).slice(0, DEBUG_MAX_ITEMS),
            playbackResources: {
                manifestUrls: manifestUrls.map(redactUrl).slice(0, DEBUG_MAX_ITEMS),
                subtitleLikeUrls: subtitleLikeUrls.map(redactUrl).slice(0, DEBUG_MAX_ITEMS),
                hardsubLocales: manifestUrls.map(getHardsubLocaleFromUrl).filter(Boolean).filter(uniqueFilter),
                networkRequests: networkState.requests.length,
                capturedManifestBodies: networkState.manifestBodies.length,
                playbackV3Responses: playbackState.responses.length
            },
            generatedSubtitles: cloneGeneratedSubtitleState(),
            videos: videoDetails,
            state: cloneDebugState()
        };
    }

    function safeQueryAll(selector, root = document) {
        try {
            return Array.from(root.querySelectorAll(selector));
        } catch (error) {
            debugError('querySelectorAll failed', error, { selector });
            return [];
        }
    }

    function deepQueryAll(selector, root = document) {
        const results = [];
        const seen = new Set();
        const roots = root === document ? [document, ...knownShadowRoots] : [root];

        roots.forEach((searchRoot) => {
            if (!searchRoot?.querySelectorAll) {
                return;
            }

            if (searchRoot.nodeType === Node.ELEMENT_NODE && searchRoot.matches?.(selector) && !seen.has(searchRoot)) {
                seen.add(searchRoot);
                results.push(searchRoot);
            }

            safeQueryAll(selector, searchRoot).forEach((element) => {
                if (!seen.has(element)) {
                    seen.add(element);
                    results.push(element);
                }
            });
        });

        return results;
    }

    function countMatches(selector, root = document) {
        return deepQueryAll(selector, root).length;
    }

    function rememberCandidate(action, element) {
        const item = {
            action,
            at: new Date().toISOString(),
            element: describeElement(element)
        };
        debugState.lastCandidates.push(item);
        if (debugState.lastCandidates.length > DEBUG_MAX_ITEMS) {
            debugState.lastCandidates.shift();
        }
    }

    let summaryTimer = null;
    function printSummarySoon() {
        if (!DEBUG || summaryTimer) {
            return;
        }

        summaryTimer = setTimeout(() => {
            summaryTimer = null;
            debugLog('summary', cloneDebugState());
        }, 500);
    }

    function cloneDebugState() {
        return JSON.parse(JSON.stringify(debugState));
    }

    function cloneNetworkState() {
        return {
            fetchPatched: networkState.fetchPatched,
            xhrPatched: networkState.xhrPatched,
            performanceObserved: networkState.performanceObserved,
            counts: {
                requests: networkState.requests.length,
                manifestUrls: networkState.manifestUrls.length,
                subtitleLikeUrls: networkState.subtitleLikeUrls.length,
                hardsubLocales: networkState.hardsubLocales.length,
                manifestBodies: networkState.manifestBodies.length,
                subtitleBodies: networkState.subtitleBodies.length,
                jsonBodies: networkState.jsonBodies.length,
                errors: networkState.errors.length
            },
            manifestUrls: networkState.manifestUrls.map(redactUrl),
            subtitleLikeUrls: networkState.subtitleLikeUrls.map(redactUrl),
            hardsubLocales: networkState.hardsubLocales.slice(),
            recentRequests: networkState.requests.map(sanitizeNetworkRecord),
            manifestBodies: networkState.manifestBodies.map(sanitizeNetworkBodyRecord),
            subtitleBodies: networkState.subtitleBodies.map(sanitizeNetworkBodyRecord),
            jsonBodies: networkState.jsonBodies.map(sanitizeNetworkBodyRecord),
            errors: networkState.errors.slice()
        };
    }

    function ensureSettingsUi() {
        if (settingsUiState.root?.isConnected || !document.body) {
            updateSettingsUiValues();
            updateSettingsLanguageOptions();
            return settingsUiState.root;
        }

        const root = document.createElement('div');
        root.id = 'crsr-settings-root';
        root.dataset.open = generatedSubtitleSettings.panelOpen ? 'true' : 'false';

        const toggle = document.createElement('button');
        toggle.id = 'crsr-settings-toggle';
        toggle.type = 'button';
        toggle.textContent = 'CRSR';

        const panel = document.createElement('div');
        panel.id = 'crsr-settings-panel';

        const header = document.createElement('div');
        header.className = 'crsr-settings-header';
        const title = document.createElement('div');
        title.className = 'crsr-settings-title';
        title.textContent = 'Subtitles';
        const close = document.createElement('button');
        close.className = 'crsr-settings-close';
        close.type = 'button';
        close.textContent = 'x';
        header.append(title, close);

        const grid = document.createElement('div');
        grid.className = 'crsr-settings-grid';

        settingsUiState.controls = {};
        grid.append(
            createSelectField('Idioma', 'language'),
            createTextField('CSS fuente', 'fontStylesheetUrl'),
            createSelectField('Fuente', 'fontFamily'),
            createRangeField('Tamano px', 'fontSize', 18, 72, 1),
            createRangeField('Escala', 'scale', 0.4, 1.6, 0.05),
            createRangeField('Posicion', 'verticalPositionPct', 0, 24, 0.5),
            createSelectField('Peso', 'fontWeight'),
            createColorField('Texto', 'textColor'),
            createColorField('Fondo', 'backgroundColor'),
            createRangeField('Fondo %', 'backgroundOpacityPct', 0, 100, 1),
            createColorField('Borde', 'outlineColor'),
            createRangeField('Borde px', 'outlineWidth', 0, 8, 0.5),
            createColorField('Sombra', 'shadowColor'),
            createRangeField('Sombra px', 'shadowBlur', 0, 24, 1),
            createRangeField('Linea', 'lineHeight', 0.8, 1.8, 0.01),
            createRangeField('Tracking', 'letterSpacing', -1, 3, 0.1),
            createRangeField('Pad X', 'paddingX', 0, 36, 1),
            createRangeField('Pad Y', 'paddingY', 0, 24, 1),
            createRangeField('Radio', 'borderRadius', 0, 24, 1)
        );

        const actions = document.createElement('div');
        actions.className = 'crsr-settings-actions';
        const reload = document.createElement('button');
        reload.className = 'crsr-settings-action';
        reload.type = 'button';
        reload.textContent = 'Recargar';
        const downloadSubtitle = document.createElement('button');
        downloadSubtitle.className = 'crsr-settings-action';
        downloadSubtitle.type = 'button';
        downloadSubtitle.textContent = 'Descargar ASS';
        const loadLocalSubtitle = document.createElement('button');
        loadLocalSubtitle.className = 'crsr-settings-action';
        loadLocalSubtitle.type = 'button';
        loadLocalSubtitle.textContent = 'Cargar ASS';
        const loadFont = document.createElement('button');
        loadFont.className = 'crsr-settings-action';
        loadFont.type = 'button';
        loadFont.textContent = 'Cargar CSS';
        const localSubtitleInput = document.createElement('input');
        localSubtitleInput.type = 'file';
        localSubtitleInput.accept = '.ass,.ssa,.vtt,.srt,text/plain,text/vtt';
        localSubtitleInput.hidden = true;
        const reset = document.createElement('button');
        reset.className = 'crsr-settings-action';
        reset.type = 'button';
        reset.textContent = 'Reset';
        actions.append(loadLocalSubtitle, downloadSubtitle, loadFont, reload, reset);

        panel.append(header, grid, actions, localSubtitleInput);
        root.append(panel, toggle);
        document.body.appendChild(root);

        settingsUiState.root = root;
        settingsUiState.toggle = toggle;
        settingsUiState.panel = panel;

        toggle.addEventListener('click', () => setSettingsPanelOpen(root.dataset.open !== 'true'));
        close.addEventListener('click', () => setSettingsPanelOpen(false));
        loadFont.addEventListener('click', () => loadRequestedFontStylesheet(loadFont));
        downloadSubtitle.addEventListener('click', () => downloadCurrentSubtitleFile());
        loadLocalSubtitle.addEventListener('click', () => localSubtitleInput.click());
        localSubtitleInput.addEventListener('change', () => {
            const file = localSubtitleInput.files?.[0];
            localSubtitleInput.value = '';
            if (file) {
                loadLocalSubtitleFile(file);
            }
        });
        reload.addEventListener('click', () => loadGeneratedSubtitleFromPlayback('settings-panel-reload', { forceRemote: true }));
        reset.addEventListener('click', () => resetGeneratedSubtitleSettings());

        bindSettingsUiEvents();
        populateStaticSettingsOptions();
        updateSettingsLanguageOptions();
        updateSettingsUiValues();
        return root;
    }

    function createRangeField(labelText, key, min, max, step) {
        const field = createFieldShell(labelText);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        const output = document.createElement('output');
        field.append(input, output);
        settingsUiState.controls[key] = { input, output };
        return field;
    }

    function createColorField(labelText, key) {
        const field = createFieldShell(labelText);
        const input = document.createElement('input');
        input.type = 'color';
        const output = document.createElement('output');
        field.append(input, output);
        settingsUiState.controls[key] = { input, output };
        return field;
    }

    function createTextField(labelText, key) {
        const field = createFieldShell(labelText);
        field.classList.add('crsr-wide');
        const input = document.createElement('input');
        input.type = 'url';
        input.placeholder = 'https://.../fonts.css';
        field.appendChild(input);
        settingsUiState.controls[key] = { input };
        return field;
    }

    function createSelectField(labelText, key) {
        const field = createFieldShell(labelText);
        field.classList.add('crsr-wide');
        const select = document.createElement('select');
        field.appendChild(select);
        settingsUiState.controls[key] = { input: select };
        return field;
    }

    function createFieldShell(labelText) {
        const field = document.createElement('div');
        field.className = 'crsr-settings-field';
        const label = document.createElement('label');
        label.textContent = labelText;
        field.appendChild(label);
        return field;
    }

    function bindSettingsUiEvents() {
        const controls = settingsUiState.controls;
        controls.language.input.addEventListener('change', () => setGeneratedSubtitleLanguage(controls.language.input.value));
        controls.fontStylesheetUrl.input.addEventListener('change', () => loadRequestedFontStylesheet());
        controls.fontStylesheetUrl.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                loadRequestedFontStylesheet();
            }
        });
        controls.fontSize.input.addEventListener('input', () => setGeneratedSubtitleStyle({ fontSize: Number(controls.fontSize.input.value) }));
        controls.scale.input.addEventListener('input', () => setGeneratedSubtitleScale(controls.scale.input.value));
        controls.verticalPositionPct.input.addEventListener('input', () => setGeneratedSubtitlePosition(`${controls.verticalPositionPct.input.value}%`));
        controls.fontFamily.input.addEventListener('change', () => setGeneratedSubtitleStyle({ fontFamily: controls.fontFamily.input.value }));
        controls.fontWeight.input.addEventListener('change', () => setGeneratedSubtitleStyle({ fontWeight: Number(controls.fontWeight.input.value) }));
        controls.textColor.input.addEventListener('input', () => setGeneratedSubtitleStyle({ textColor: controls.textColor.input.value }));
        controls.backgroundColor.input.addEventListener('input', () => setGeneratedSubtitleStyle({ backgroundColor: controls.backgroundColor.input.value }));
        controls.backgroundOpacityPct.input.addEventListener('input', () => setGeneratedSubtitleStyle({ backgroundOpacity: Number(controls.backgroundOpacityPct.input.value) / 100 }));
        controls.outlineColor.input.addEventListener('input', () => setGeneratedSubtitleStyle({ outlineColor: controls.outlineColor.input.value }));
        controls.outlineWidth.input.addEventListener('input', () => setGeneratedSubtitleStyle({ outlineWidth: Number(controls.outlineWidth.input.value) }));
        controls.shadowColor.input.addEventListener('input', () => setGeneratedSubtitleStyle({ shadowColor: controls.shadowColor.input.value }));
        controls.shadowBlur.input.addEventListener('input', () => setGeneratedSubtitleStyle({ shadowBlur: Number(controls.shadowBlur.input.value) }));
        controls.lineHeight.input.addEventListener('input', () => setGeneratedSubtitleStyle({ lineHeight: Number(controls.lineHeight.input.value) }));
        controls.letterSpacing.input.addEventListener('input', () => setGeneratedSubtitleStyle({ letterSpacing: Number(controls.letterSpacing.input.value) }));
        controls.paddingX.input.addEventListener('input', () => setGeneratedSubtitleStyle({ paddingX: Number(controls.paddingX.input.value) }));
        controls.paddingY.input.addEventListener('input', () => setGeneratedSubtitleStyle({ paddingY: Number(controls.paddingY.input.value) }));
        controls.borderRadius.input.addEventListener('input', () => setGeneratedSubtitleStyle({ borderRadius: Number(controls.borderRadius.input.value) }));
    }

    function populateStaticSettingsOptions() {
        updateFontFamilyOptions();

        const weightSelect = settingsUiState.controls.fontWeight?.input;
        if (weightSelect && !weightSelect.options.length) {
            weightSelect.replaceChildren(...[
                [400, '400'],
                [500, '500'],
                [600, '600'],
                [700, '700'],
                [800, '800'],
                [900, '900']
            ].map(([value, label]) => {
                const option = document.createElement('option');
                option.value = String(value);
                option.textContent = label;
                return option;
            }));
        }
    }

    function getFontLabel(fontFamily) {
        return String(fontFamily).split(',')[0].replace(/["']/g, '');
    }

    function updateFontFamilyOptions() {
        const fontSelect = settingsUiState.controls.fontFamily?.input;
        if (!fontSelect) {
            return;
        }

        const current = generatedSubtitleSettings.fontFamily;
        const values = uniqueStrings([
            ...FONT_OPTIONS,
            ...settingsUiState.remoteFontFamilies.map(formatFontStack),
            current
        ].filter(Boolean));

        fontSelect.replaceChildren(...values.map((fontFamily) => {
            const option = document.createElement('option');
            option.value = fontFamily;
            option.textContent = getFontLabel(fontFamily);
            return option;
        }));
        fontSelect.value = current;
    }

    function updateSettingsUiValues() {
        const controls = settingsUiState.controls;
        if (!controls.scale) {
            return;
        }

        setControlValue('language', generatedSubtitleSettings.language);
        setControlValue('fontStylesheetUrl', generatedSubtitleSettings.fontStylesheetUrl);
        setControlValue('fontSize', generatedSubtitleSettings.fontSize, `${generatedSubtitleSettings.fontSize}px`);
        setControlValue('scale', generatedSubtitleSettings.scale, formatScale(generatedSubtitleSettings.scale));
        setControlValue('verticalPositionPct', parseCssPercent(generatedSubtitleSettings.verticalPosition), generatedSubtitleSettings.verticalPosition);
        updateFontFamilyOptions();
        setControlValue('fontFamily', generatedSubtitleSettings.fontFamily);
        setControlValue('fontWeight', generatedSubtitleSettings.fontWeight);
        setControlValue('textColor', generatedSubtitleSettings.textColor, generatedSubtitleSettings.textColor);
        setControlValue('backgroundColor', generatedSubtitleSettings.backgroundColor, generatedSubtitleSettings.backgroundColor);
        setControlValue('backgroundOpacityPct', Math.round(generatedSubtitleSettings.backgroundOpacity * 100), `${Math.round(generatedSubtitleSettings.backgroundOpacity * 100)}%`);
        setControlValue('outlineColor', generatedSubtitleSettings.outlineColor, generatedSubtitleSettings.outlineColor);
        setControlValue('outlineWidth', generatedSubtitleSettings.outlineWidth, `${generatedSubtitleSettings.outlineWidth}px`);
        setControlValue('shadowColor', generatedSubtitleSettings.shadowColor, generatedSubtitleSettings.shadowColor);
        setControlValue('shadowBlur', generatedSubtitleSettings.shadowBlur, `${generatedSubtitleSettings.shadowBlur}px`);
        setControlValue('lineHeight', generatedSubtitleSettings.lineHeight, formatNumber(generatedSubtitleSettings.lineHeight));
        setControlValue('letterSpacing', generatedSubtitleSettings.letterSpacing, `${generatedSubtitleSettings.letterSpacing}px`);
        setControlValue('paddingX', generatedSubtitleSettings.paddingX, `${generatedSubtitleSettings.paddingX}px`);
        setControlValue('paddingY', generatedSubtitleSettings.paddingY, `${generatedSubtitleSettings.paddingY}px`);
        setControlValue('borderRadius', generatedSubtitleSettings.borderRadius, `${generatedSubtitleSettings.borderRadius}px`);
    }

    function setControlValue(key, value, outputValue = value) {
        const control = settingsUiState.controls[key];
        if (!control?.input) {
            return;
        }

        control.input.value = String(value);
        if (control.output) {
            control.output.textContent = String(outputValue);
        }
    }

    function updateSettingsLanguageOptions() {
        const select = settingsUiState.controls.language?.input;
        if (!select) {
            return;
        }

        const languages = getAvailableSubtitleLanguages();
        const current = generatedSubtitleSettings.language;
        const values = ['auto', ...languages];
        if (current && !values.includes(current)) {
            values.splice(1, 0, current);
        }

        const previous = select.value;
        select.replaceChildren(...values.map((language) => {
            const option = document.createElement('option');
            option.value = language;
            option.textContent = language === 'auto' ? 'auto' : language;
            return option;
        }));
        select.value = values.includes(current) ? current : previous;
    }

    function getAvailableSubtitleLanguages() {
        const subtitles = playbackState.lastPlayback?.subtitles || {};
        return Object.keys(subtitles)
            .filter((language) => subtitles[language]?.url)
            .filter((language) => language !== 'none')
            .sort((a, b) => a.localeCompare(b));
    }

    async function loadRequestedFontStylesheet(button = null) {
        const input = settingsUiState.controls.fontStylesheetUrl?.input;
        const rawUrl = input?.value ?? generatedSubtitleSettings.fontStylesheetUrl;
        const normalizedUrl = sanitizeFontStylesheetUrl(rawUrl, '');
        const previousText = button?.textContent || '';

        if (String(rawUrl || '').trim() && !normalizedUrl) {
            const error = new Error('Invalid CSS URL. Use an http(s) stylesheet URL.');
            if (button) {
                setTemporaryButtonState(button, 'Error CSS', error.message, previousText);
            }
            debugError('font stylesheet load failed', error, { url: String(rawUrl || '').trim() });
            return [];
        }

        if (button) {
            button.disabled = true;
            button.textContent = 'Cargando...';
            button.title = normalizedUrl || 'Quitar CSS de fuente';
        }

        setGeneratedSubtitleStyle({ fontStylesheetUrl: normalizedUrl }, {
            loadFont: false
        });

        try {
            const families = await loadGeneratedFontStylesheet(normalizedUrl, {
                selectFirstFamily: true
            });

            if (button) {
                const label = !normalizedUrl
                    ? 'CSS quitado'
                    : families.length
                        ? 'CSS cargado'
                        : 'CSS enlazado';
                const title = families.length
                    ? `Fuentes detectadas: ${families.join(', ')}`
                    : normalizedUrl
                        ? 'CSS enlazado. Si la fuente no aparece en la lista, el navegador aun puede usarla si ya esta seleccionada por nombre.'
                        : 'CSS de fuente removido';
                setTemporaryButtonState(button, label, title, previousText);
            }

            return families;
        } catch (error) {
            if (button) {
                setTemporaryButtonState(button, 'Error CSS', error?.message || 'No se pudo cargar el CSS', previousText);
            }
            debugError('font stylesheet load failed', error, { url: redactUrl(normalizedUrl) });
            return [];
        } finally {
            if (button) {
                button.disabled = false;
            }
        }
    }

    function setTemporaryButtonState(button, text, title, fallbackText) {
        button.textContent = text;
        button.title = title || '';
        setTimeout(() => {
            if (button.isConnected) {
                button.textContent = fallbackText || 'Cargar CSS';
            }
        }, 1600);
    }

    async function loadGeneratedFontStylesheet(rawUrl, options = {}) {
        const normalizedUrl = sanitizeFontStylesheetUrl(rawUrl, '');
        const quiet = Boolean(options.quiet);
        const selectFirstFamily = options.selectFirstFamily !== false;

        generatedSubtitleSettings.fontStylesheetUrl = normalizedUrl;
        saveGeneratedSubtitleSettings();

        if (!normalizedUrl) {
            document.getElementById(FONT_STYLESHEET_LINK_ID)?.remove();
            settingsUiState.remoteFontFamilies = [];
            updateFontFamilyOptions();
            updateSettingsUiValues();
            if (!quiet) {
                debugLog('font stylesheet removed');
            }
            return [];
        }

        let cssText = '';
        let fetchError = null;
        try {
            const response = await fetch(normalizedUrl, {
                cache: 'force-cache',
                credentials: 'omit'
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            cssText = await response.text();
        } catch (error) {
            fetchError = error;
        }

        const families = cssText ? extractFontFamilies(cssText) : inferFontFamiliesFromStylesheetUrl(normalizedUrl);
        settingsUiState.remoteFontFamilies = families;

        if (cssText) {
            injectGeneratedFontCss(absolutizeCssUrls(cssText, normalizedUrl), normalizedUrl);
        } else {
            attachGeneratedFontStylesheetLink(normalizedUrl);
        }

        if (selectFirstFamily && families.length > 0) {
            setGeneratedSubtitleStyle({
                fontFamily: formatFontStack(families[0])
            }, {
                loadFont: false
            });
        }

        updateFontFamilyOptions();
        updateSettingsUiValues();
        debugVerbose('font stylesheet loaded', {
            url: redactUrl(normalizedUrl),
            families,
            parsedCss: Boolean(cssText),
            fetchError: fetchError ? {
                name: fetchError.name,
                message: fetchError.message
            } : null
        });

        return families;
    }

    function extractFontFamilies(cssText) {
        const families = new Set();
        const matches = String(cssText || '').matchAll(/font-family\s*:\s*['"]?([^;'"}]+)['"]?/gi);

        for (const match of matches) {
            const family = match[1]?.trim();
            if (family) {
                families.add(family);
            }
        }

        return Array.from(families);
    }

    function inferFontFamiliesFromStylesheetUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, location.href);
            return uniqueStrings(url.searchParams.getAll('family')
                .map((value) => value.split(':')[0])
                .map((value) => value.replace(/\+/g, ' ').trim())
                .filter(Boolean));
        } catch (error) {
            return [];
        }
    }

    function injectGeneratedFontCss(cssText, sourceUrl) {
        document.getElementById(FONT_STYLESHEET_LINK_ID)?.remove();

        let style = null;
        if (typeof GM_addStyle === 'function') {
            style = GM_addStyle(cssText);
        }

        if (!style) {
            const host = document.head || document.documentElement;
            if (!host) {
                return;
            }
            style = document.createElement('style');
            style.textContent = cssText;
            host.appendChild(style);
        }

        style.id = FONT_STYLESHEET_LINK_ID;
        style.dataset.sourceUrl = sourceUrl;
    }

    function attachGeneratedFontStylesheetLink(sourceUrl) {
        const host = document.head || document.documentElement;
        if (!host) {
            return;
        }

        let link = document.getElementById(FONT_STYLESHEET_LINK_ID);
        if (link?.tagName !== 'LINK') {
            link?.remove();
            link = document.createElement('link');
            link.id = FONT_STYLESHEET_LINK_ID;
            link.rel = 'stylesheet';
            host.appendChild(link);
        }

        if (link.getAttribute('href') !== sourceUrl) {
            link.setAttribute('href', sourceUrl);
        }
    }

    function absolutizeCssUrls(cssText, sourceUrl) {
        return String(cssText || '').replace(/url\(\s*(['"]?)(?!data:|blob:|https?:|\/\/|#)([^'")]+)\1\s*\)/gi, (match, quote, rawUrl) => {
            try {
                const absoluteUrl = new URL(rawUrl.trim(), sourceUrl).href;
                return `url(${quote}${absoluteUrl}${quote})`;
            } catch (error) {
                return match;
            }
        });
    }

    function formatFontStack(rawValue) {
        const trimmed = String(rawValue || '').trim();
        if (!trimmed) {
            return DEFAULT_GENERATED_SUBTITLE_SETTINGS.fontFamily;
        }

        if (trimmed.includes(',')) {
            return sanitizeFontFamily(trimmed, DEFAULT_GENERATED_SUBTITLE_SETTINGS.fontFamily);
        }

        const familyName = /[\s"]/u.test(trimmed)
            ? `"${trimmed.replace(/"/g, '\\"')}"`
            : trimmed;

        return sanitizeFontFamily(`${familyName}, sans-serif`, DEFAULT_GENERATED_SUBTITLE_SETTINGS.fontFamily);
    }

    function setSettingsPanelOpen(open) {
        generatedSubtitleSettings.panelOpen = Boolean(open);
        saveGeneratedSubtitleSettings();
        if (settingsUiState.root) {
            settingsUiState.root.dataset.open = generatedSubtitleSettings.panelOpen ? 'true' : 'false';
        }
    }

    function setGeneratedSubtitlePosition(value) {
        const position = String(value || '').trim();
        if (!/^-?\d+(?:\.\d+)?(?:px|%|vh|vw|rem|em)$/i.test(position)) {
            throw new Error('Use a CSS length like "8%", "80px", or "10vh".');
        }

        return setGeneratedSubtitleStyle({ verticalPosition: position });
    }

    function setGeneratedSubtitleScale(value) {
        const scale = Number(value);
        if (!Number.isFinite(scale) || scale <= 0 || scale > 3) {
            throw new Error('Use a numeric scale between 0 and 3, for example 0.8.');
        }

        return setGeneratedSubtitleStyle({ scale });
    }

    function setGeneratedSubtitleLanguage(language) {
        const nextLanguage = normalizeLocale(language) || 'auto';
        const changed = generatedSubtitleSettings.language !== nextLanguage;
        setGeneratedSubtitleStyle({ language: nextLanguage }, { reload: changed });
        return cloneGeneratedSubtitleState();
    }

    function setGeneratedSubtitleStyle(partial, options = {}) {
        const fontStylesheetUrlChanged = Object.prototype.hasOwnProperty.call(partial || {}, 'fontStylesheetUrl')
            && String(partial.fontStylesheetUrl || '').trim() !== generatedSubtitleSettings.fontStylesheetUrl;
        Object.assign(generatedSubtitleSettings, sanitizeGeneratedSubtitleSettings(partial, generatedSubtitleSettings));
        applyGeneratedSubtitleSettings();
        updateSettingsUiValues();
        if (fontStylesheetUrlChanged && options.loadFont !== false) {
            loadGeneratedFontStylesheet(generatedSubtitleSettings.fontStylesheetUrl, {
                quiet: true,
                selectFirstFamily: false
            });
        }
        if (options.reload) {
            resetGeneratedSubtitleState('settings-language-changed');
            loadGeneratedSubtitleFromPlayback('settings-language-changed', { forceRemote: true });
        }
        return cloneGeneratedSubtitleState();
    }

    function resetGeneratedSubtitleSettings() {
        Object.assign(generatedSubtitleSettings, cloneJson(DEFAULT_GENERATED_SUBTITLE_SETTINGS), {
            panelOpen: generatedSubtitleSettings.panelOpen
        });
        applyGeneratedSubtitleSettings();
        loadGeneratedFontStylesheet(generatedSubtitleSettings.fontStylesheetUrl, {
            quiet: true,
            selectFirstFamily: false
        });
        updateSettingsLanguageOptions();
        updateSettingsUiValues();
        resetGeneratedSubtitleState('settings-reset');
        loadGeneratedSubtitleFromPlayback('settings-reset', { forceRemote: true });
        return cloneGeneratedSubtitleState();
    }

    function applyGeneratedSubtitleSettings(options = {}) {
        Object.assign(generatedSubtitleSettings, sanitizeGeneratedSubtitleSettings(generatedSubtitleSettings, DEFAULT_GENERATED_SUBTITLE_SETTINGS));
        runtimeGeneratedSubtitleScale = generatedSubtitleSettings.scale;
        runtimeGeneratedSubtitleVerticalPosition = generatedSubtitleSettings.verticalPosition;
        runtimeGeneratedSubtitleLanguage = generatedSubtitleSettings.language;

        const root = document.documentElement;
        if (root?.style) {
            root.style.setProperty('--crsr-generated-subtitle-scale', String(generatedSubtitleSettings.scale));
            root.style.setProperty('--crsr-generated-vertical-position', generatedSubtitleSettings.verticalPosition);
            root.style.setProperty('--crsr-generated-text-color', generatedSubtitleSettings.textColor);
            root.style.setProperty('--crsr-generated-bg-rgb', hexToRgbTuple(generatedSubtitleSettings.backgroundColor));
            root.style.setProperty('--crsr-generated-bg-opacity', String(generatedSubtitleSettings.backgroundOpacity));
            root.style.setProperty('--crsr-generated-font-size', `${generatedSubtitleSettings.fontSize}px`);
            root.style.setProperty('--crsr-generated-font-family', generatedSubtitleSettings.fontFamily);
            root.style.setProperty('--crsr-generated-font-weight', String(generatedSubtitleSettings.fontWeight));
            root.style.setProperty('--crsr-generated-line-height', String(generatedSubtitleSettings.lineHeight));
            root.style.setProperty('--crsr-generated-letter-spacing', `${generatedSubtitleSettings.letterSpacing}px`);
            root.style.setProperty('--crsr-generated-padding-x', `${generatedSubtitleSettings.paddingX}px`);
            root.style.setProperty('--crsr-generated-padding-y', `${generatedSubtitleSettings.paddingY}px`);
            root.style.setProperty('--crsr-generated-radius', `${generatedSubtitleSettings.borderRadius}px`);
            root.style.setProperty('--crsr-generated-text-shadow', buildGeneratedTextShadow(generatedSubtitleSettings));
        }

        if (options.save !== false) {
            saveGeneratedSubtitleSettings();
        }
    }

    function loadGeneratedSubtitleSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
            if (!raw) {
                return cloneJson(DEFAULT_GENERATED_SUBTITLE_SETTINGS);
            }

            return sanitizeGeneratedSubtitleSettings(JSON.parse(raw), DEFAULT_GENERATED_SUBTITLE_SETTINGS);
        } catch (error) {
            return cloneJson(DEFAULT_GENERATED_SUBTITLE_SETTINGS);
        }
    }

    function saveGeneratedSubtitleSettings() {
        try {
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(generatedSubtitleSettings));
        } catch (error) {
            debugVerbose('settings save failed', {
                name: error?.name,
                message: error?.message
            });
        }
    }

    function sanitizeGeneratedSubtitleSettings(input = {}, fallback = DEFAULT_GENERATED_SUBTITLE_SETTINGS) {
        const next = {
            ...fallback,
            ...input
        };

        next.language = normalizeLocale(next.language) || fallback.language;
        next.scale = clampNumber(next.scale, 0.25, 3, fallback.scale);
        next.fontSize = clampNumber(next.fontSize, 12, 96, fallback.fontSize);
        next.verticalPosition = sanitizeCssLength(next.verticalPosition, fallback.verticalPosition);
        next.textColor = sanitizeHexColor(next.textColor, fallback.textColor);
        next.backgroundColor = sanitizeHexColor(next.backgroundColor, fallback.backgroundColor);
        next.backgroundOpacity = clampNumber(next.backgroundOpacity, 0, 1, fallback.backgroundOpacity);
        next.fontFamily = sanitizeFontFamily(next.fontFamily, fallback.fontFamily);
        next.fontStylesheetUrl = sanitizeFontStylesheetUrl(next.fontStylesheetUrl, fallback.fontStylesheetUrl);
        next.fontWeight = [400, 500, 600, 700, 800, 900].includes(Number(next.fontWeight)) ? Number(next.fontWeight) : fallback.fontWeight;
        next.outlineColor = sanitizeHexColor(next.outlineColor, fallback.outlineColor);
        next.outlineWidth = clampNumber(next.outlineWidth, 0, 12, fallback.outlineWidth);
        next.shadowColor = sanitizeHexColor(next.shadowColor, fallback.shadowColor);
        next.shadowBlur = clampNumber(next.shadowBlur, 0, 40, fallback.shadowBlur);
        next.lineHeight = clampNumber(next.lineHeight, 0.7, 2.5, fallback.lineHeight);
        next.letterSpacing = clampNumber(next.letterSpacing, -3, 8, fallback.letterSpacing);
        next.paddingX = clampNumber(next.paddingX, 0, 80, fallback.paddingX);
        next.paddingY = clampNumber(next.paddingY, 0, 60, fallback.paddingY);
        next.borderRadius = clampNumber(next.borderRadius, 0, 60, fallback.borderRadius);
        next.panelOpen = Boolean(next.panelOpen);

        return next;
    }

    function sanitizeCssLength(value, fallback) {
        const length = String(value || '').trim();
        return /^-?\d+(?:\.\d+)?(?:px|%|vh|vw|rem|em)$/i.test(length) ? length : fallback;
    }

    function sanitizeHexColor(value, fallback) {
        const color = String(value || '').trim();
        return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
    }

    function sanitizeFontFamily(value, fallback) {
        const fontFamily = String(value || '').trim().replace(/[;{}<>]/g, '');
        return fontFamily.length > 0 && fontFamily.length <= 180 ? fontFamily : fallback;
    }

    function sanitizeFontStylesheetUrl(value, fallback) {
        const url = String(value || '').trim();
        if (!url) {
            return '';
        }

        try {
            const parsedUrl = new URL(url, location.href);
            return /^https?:$/i.test(parsedUrl.protocol) ? parsedUrl.href : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, number));
    }

    function parseCssPercent(value) {
        const match = String(value || '').match(/^(-?\d+(?:\.\d+)?)%$/);
        return match ? Number(match[1]) : parseCssFloat(value, 9);
    }

    function parseCssFloat(value, fallback) {
        const number = Number.parseFloat(String(value || ''));
        return Number.isFinite(number) ? number : fallback;
    }

    function formatScale(value) {
        return `${Math.round(Number(value) * 100)}%`;
    }

    function formatNumber(value) {
        return String(Number(value).toFixed(2)).replace(/\.?0+$/, '');
    }

    function buildGeneratedTextShadow(settings) {
        const outlineWidth = Number(settings.outlineWidth) || 0;
        const shadowBlur = Number(settings.shadowBlur) || 0;
        const shadows = [];

        if (outlineWidth > 0) {
            const width = `${outlineWidth}px`;
            shadows.push(
                `-${width} -${width} 0 ${settings.outlineColor}`,
                `${width} -${width} 0 ${settings.outlineColor}`,
                `-${width} ${width} 0 ${settings.outlineColor}`,
                `${width} ${width} 0 ${settings.outlineColor}`,
                `0 -${width} 0 ${settings.outlineColor}`,
                `0 ${width} 0 ${settings.outlineColor}`,
                `-${width} 0 0 ${settings.outlineColor}`,
                `${width} 0 0 ${settings.outlineColor}`
            );
        }

        if (shadowBlur > 0) {
            const shadowRgb = hexToRgbTuple(settings.shadowColor);
            shadows.push(
                `rgb(${shadowRgb}) 0 0 ${shadowBlur}px`,
                `rgb(${shadowRgb} / 0.8) 0 0 ${Math.round(shadowBlur * 18 / 7)}px`
            );
        }

        return shadows.length ? shadows.join(', ') : 'none';
    }

    function hexToRgbTuple(color) {
        const normalized = sanitizeHexColor(color, '#000000');
        return [
            Number.parseInt(normalized.slice(1, 3), 16),
            Number.parseInt(normalized.slice(3, 5), 16),
            Number.parseInt(normalized.slice(5, 7), 16)
        ].join(' ');
    }

    function cssString(value) {
        return String(value || '').replace(/[;{}]/g, '');
    }

    function uniqueStrings(values) {
        const seen = new Set();
        const result = [];

        for (const value of values) {
            const normalized = String(value || '').trim();
            if (!normalized || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            result.push(normalized);
        }

        return result;
    }

    function cloneGeneratedSubtitleState() {
        return {
            enabled: GENERATED_SUBTITLE_OVERLAY,
            forceCleanStream: FORCE_CLEAN_STREAM_FOR_HARDSUBS,
            configuredLanguage: GENERATED_SUBTITLE_LANGUAGE,
            configuredVerticalPosition: GENERATED_SUBTITLE_VERTICAL_POSITION,
            runtimeScale: runtimeGeneratedSubtitleScale,
            runtimeVerticalPosition: runtimeGeneratedSubtitleVerticalPosition,
            runtimeLanguage: runtimeGeneratedSubtitleLanguage,
            style: {
                fontSize: generatedSubtitleSettings.fontSize,
                textColor: generatedSubtitleSettings.textColor,
                backgroundColor: generatedSubtitleSettings.backgroundColor,
                backgroundOpacity: generatedSubtitleSettings.backgroundOpacity,
                fontFamily: generatedSubtitleSettings.fontFamily,
                fontStylesheetUrl: generatedSubtitleSettings.fontStylesheetUrl,
                fontWeight: generatedSubtitleSettings.fontWeight,
                outlineColor: generatedSubtitleSettings.outlineColor,
                outlineWidth: generatedSubtitleSettings.outlineWidth,
                shadowColor: generatedSubtitleSettings.shadowColor,
                shadowBlur: generatedSubtitleSettings.shadowBlur,
                lineHeight: generatedSubtitleSettings.lineHeight,
                letterSpacing: generatedSubtitleSettings.letterSpacing,
                paddingX: generatedSubtitleSettings.paddingX,
                paddingY: generatedSubtitleSettings.paddingY,
                borderRadius: generatedSubtitleSettings.borderRadius
            },
            availableLanguages: getAvailableSubtitleLanguages(),
            status: playbackState.subtitleStatus,
            selectedSubtitle: playbackState.selectedSubtitle,
            subtitleUrl: playbackState.subtitleUrl ? redactUrl(playbackState.subtitleUrl) : null,
            subtitleFormat: playbackState.subtitleFormat,
            subtitleSource: playbackState.subtitleSource,
            subtitleFileName: playbackState.subtitleFileName,
            subtitleBytes: playbackState.subtitleRawText.length,
            localSubtitleOverride: playbackState.localSubtitleOverride,
            cues: playbackState.cues.length,
            annotationCues: playbackState.annotationCues.length,
            renderedTextChanges: playbackState.renderedTextChanges,
            recentRenderedTextChanges: playbackState.recentRenderedTextChanges.slice(),
            activeAnnotations: playbackState.annotationNodes.size,
            annotationSamples: playbackState.annotationCues.slice(0, DEBUG_MAX_ITEMS).map((cue) => ({
                start: cue.start,
                end: cue.end,
                text: cue.text,
                styleName: cue.styleName,
                layer: cue.layer,
                positioned: Boolean(cue.overrides.position || cue.overrides.move),
                alignment: cue.overrides.alignment || cue.style?.alignment || null
            })),
            cleanStreamRewrites: playbackState.cleanStreamRewrites,
            playbackResponses: playbackState.responses.slice(),
            lastPlaybackSummary: playbackState.lastPlaybackSummary,
            overlayAttached: Boolean(playbackState.overlay?.isConnected),
            dialogueCanvasAttached: Boolean(playbackState.dialogueCanvas?.isConnected),
            dialogueCanvasSize: playbackState.dialogueCanvas ? {
                width: playbackState.dialogueCanvas.width,
                height: playbackState.dialogueCanvas.height
            } : null,
            rendering: Boolean(playbackState.renderRaf),
            dualSubsExtensionDetected: Boolean(document.querySelector('#cr-dual-subs-root, #cr-dual-subs-secondary, #cr-dual-subs-control-casing')),
            errors: playbackState.errors.slice()
        };
    }

    function sanitizeNetworkRecord(record) {
        return {
            ...record,
            url: redactUrl(record.url)
        };
    }

    function sanitizeNetworkBodyRecord(record) {
        return {
            ...record,
            url: redactUrl(record.url),
            snippet: sanitizeBodySnippet(record.snippet || '', NETWORK_BODY_SNIPPET_MAX_CHARS)
        };
    }

    function describeRoot(root) {
        if (root === document) {
            return 'document';
        }

        if (root instanceof ShadowRoot) {
            return `shadowRoot(${describeElement(root.host).selector})`;
        }

        return describeElement(root).selector;
    }

    function describeElement(element) {
        if (!element || !element.tagName) {
            return {
                selector: String(element)
            };
        }

        const rect = element.getBoundingClientRect?.();
        const computed = element instanceof HTMLElement ? getComputedStyle(element) : null;

        return {
            selector: getElementPath(element),
            tag: element.tagName.toLowerCase(),
            id: element.id || null,
            className: element.className?.toString() || null,
            dataTestId: element.getAttribute?.('data-testid'),
            ariaLive: element.getAttribute?.('aria-live'),
            processed: element.getAttribute?.(PROCESSED_ATTR),
            textSnippet: normalizeText(element.textContent).slice(0, 120),
            rect: rect ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                bottom: Math.round(rect.bottom)
            } : null,
            style: computed ? {
                display: computed.display,
                visibility: computed.visibility,
                position: computed.position,
                bottom: computed.bottom,
                transform: computed.transform,
                scale: computed.scale,
                fontSize: computed.fontSize,
                zIndex: computed.zIndex
            } : null
        };
    }

    function getElementPath(element) {
        if (element.id) {
            return `#${cssEscape(element.id)}`;
        }

        const parts = [];
        let current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
            let part = current.tagName.toLowerCase();
            const className = current.className?.toString().trim();
            if (className) {
                part += `.${className.split(/\s+/).slice(0, 3).map(cssEscape).join('.')}`;
            }
            parts.unshift(part);
            current = current.parentElement;
        }

        return parts.join(' > ');
    }

    function cssEscape(value) {
        if (window.CSS?.escape) {
            return CSS.escape(value);
        }

        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function sanitizeBodySnippet(value, limit = NETWORK_BODY_SNIPPET_MAX_CHARS) {
        return normalizeText(redactSensitiveText(value)).slice(0, limit);
    }

    function redactUrl(value) {
        if (!value) {
            return value;
        }

        try {
            const url = new URL(String(value), location.href);
            url.searchParams.forEach((_, key) => {
                url.searchParams.set(key, 'redacted');
            });
            return url.href;
        } catch (error) {
            return String(value).replace(/([?&][^=\s&?#]+)=([^&\s"'<>]+)/g, '$1=redacted');
        }
    }

    function redactSensitiveText(value) {
        return String(value || '')
            .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url))
            .replace(/([?&][^=\s&?#]+)=([^&\s"'<>]+)/g, '$1=redacted')
            .replace(/("(?:access_?token|refresh_?token|token|signature|policy|authorization|cookie|session|jwt|credential|secret|key-?pair-?id)"\s*:\s*")([^"]*)(")/gi, '$1redacted$3')
            .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1redacted');
    }

    function debugLog(message, data) {
        if (DEBUG) {
            console.log(DEBUG_PREFIX, message, data || '');
        }
    }

    function debugVerbose(message, data) {
        if (DEBUG && DEBUG_VERBOSE) {
            console.debug(DEBUG_PREFIX, message, data || '');
        }
    }

    function debugError(message, error, data) {
        const entry = {
            message,
            error: {
                name: error?.name,
                message: error?.message,
                stack: error?.stack
            },
            data
        };
        debugState.errors.push(entry);
        if (debugState.errors.length > DEBUG_MAX_ITEMS) {
            debugState.errors.shift();
        }
        if (DEBUG) {
            console.error(DEBUG_PREFIX, message, entry);
        }
    }

})();

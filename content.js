/**
 * YTMusic Stay — content.js
 *
 * 1. Blocks navigation to /watch?v=... song pages, keeping playback in the mini-player.
 * 2. Removes the album-art overlay that appears at the bottom-right of the screen.
 */

(function () {
  "use strict";

  /* ─── Settings (synced via chrome.storage.sync) ─── */
  let settings = {
    blockNavigation: true,
    removeAlbumArt: true,
  };

  chrome.storage.sync.get(["blockNavigation", "removeAlbumArt"], (stored) => {
    if (stored.blockNavigation !== undefined)
      settings.blockNavigation = stored.blockNavigation;
    if (stored.removeAlbumArt !== undefined)
      settings.removeAlbumArt = stored.removeAlbumArt;
    init();
  });

  /* ─── Listen for settings updates from popup ─── */
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.blockNavigation)
      settings.blockNavigation = changes.blockNavigation.newValue;
    if (changes.removeAlbumArt)
      settings.removeAlbumArt = changes.removeAlbumArt.newValue;
    applyAlbumArtRemoval();
  });

  /* ══════════════════════════════════════════════════
     1.  BLOCK SONG-PAGE NAVIGATION
     ══════════════════════════════════════════════════ */

  /**
   * YouTube Music uses the YouTube player internally.
   * When a track is clicked it pushes a /watch?v= URL via the History API
   * AND sometimes via a full anchor click.
   * We intercept both routes.
   */
  function interceptNavigation() {
    let allowNextNavigation = false;

    /* --- History API patch --- */
    const originalPushState = history.pushState.bind(history);
    const originalReplaceState = history.replaceState.bind(history);

    history.pushState = function (state, title, url) {
      if (settings.blockNavigation && shouldBlock(url) && !allowNextNavigation) {
        // Let the player start but don't change the visible URL / page
        return;
      }
      return originalPushState(state, title, url);
    };

    history.replaceState = function (state, title, url) {
      if (settings.blockNavigation && shouldBlock(url) && !allowNextNavigation) {
        return;
      }
      return originalReplaceState(state, title, url);
    };

    /* --- Click interception for anchor tags and player bar --- */
    document.addEventListener(
      "click",
      (e) => {
        if (!settings.blockNavigation) return;

        let target = e.target;
        
        // 1. Check if click is inside the player bar (e.g. expanding lyrics/queue)
        let node = target;
        while (node && node !== document.body) {
          if (node.tagName === "YTMUSIC-PLAYER-BAR") {
            allowNextNavigation = true;
            setTimeout(() => { allowNextNavigation = false; }, 100);
            return; // Allow the default behavior for player bar elements
          }
          node = node.parentElement;
        }

        // 2. Otherwise, intercept anchor clicks strictly outside the player bar
        node = target;
        while (node && node !== document.body) {
          if (node.tagName === "A" && node.href && shouldBlock(node.href)) {
            e.preventDefault();
            e.stopImmediatePropagation();

            // Trigger playback without navigating
            triggerPlayback(node);
            return;
          }
          node = node.parentElement;
        }
      },
      true // capture phase — fires before YTM's own listeners
    );

    /* --- ytd-app / yt-navigate-start guard --- */
    document.addEventListener("yt-navigate-start", (e) => {
      if (!settings.blockNavigation || allowNextNavigation) return;
      const url = e?.detail?.endpoint?.commandMetadata?.webCommandMetadata?.url;
      if (url && shouldBlock(url)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    }, true);
  }

  /** Returns true for URLs that would open a /watch song page */
  function shouldBlock(url) {
    if (!url) return false;
    try {
      const u = new URL(url, location.href);
      // Block /watch pages on music.youtube.com
      return (
        u.hostname === "music.youtube.com" &&
        u.pathname === "/watch"
      );
    } catch {
      return false;
    }
  }

  /**
   * When an anchor click to /watch is blocked we still want the song to play.
   * YTM rows have a data-index or aria-rowindex. The most reliable way is to
   * find and click the invisible "play" overlay on the row itself, or
   * dispatch a custom yt-navigate-finish to just update the queue.
   */
  function triggerPlayback(anchor) {
    // 1. Try finding and clicking the play button within the item row
    let row = anchor;
    while (row && row !== document.body) {
      if (
        row.tagName?.toLowerCase().startsWith("ytmusic-") ||
        row.classList.contains("ytmusic-player-queue-item")
      ) {
        break;
      }
      row = row.parentElement;
    }

    if (row) {
      const playBtn =
        row.querySelector('[aria-label*="play" i]') ||
        row.querySelector(".play-button") ||
        row.querySelector("tp-yt-paper-icon-button") ||
        row.querySelector('.yt-spec-button-shape-next') ||
        row.querySelector('ytmusic-play-button-renderer'); // Catch more modern button shapes

      if (playBtn && typeof playBtn.click === 'function') {
        playBtn.click();
        return;
      }
    }

    // 2. Fallback: dispatch yt-navigate-finish 
    // This is required for videos or elements where the play button isn't easily selectable
    try {
      const watchUrl = new URL(anchor.href, location.href);
      const videoId = watchUrl.searchParams.get("v");
      const playlistId = watchUrl.searchParams.get("list");
      
      if (videoId) {
        
        let endpoint = {
          watchEndpoint: { videoId }
        };

        if (playlistId) {
            endpoint.watchEndpoint.playlistId = playlistId;
        }

        document.dispatchEvent(
          new CustomEvent("yt-navigate-finish", {
            bubbles: true,
            detail: {
              endpoint: endpoint,
            },
          })
        );
      }
    } catch (err) {
      console.error("YTMusic Stay: Failed to trigger playback fallback", err);
    }
  }

  /* ══════════════════════════════════════════════════
     2.  REMOVE ALBUM-ART OVERLAY
     ══════════════════════════════════════════════════ */

  const ALBUM_ART_SELECTORS = [
    // The large thumbnail that floats bottom-right over the queue/lyrics panel
    "ytmusic-player-page",               // entire song-detail page (backup)
    ".ytmusic-player-page",
    "ytmusic-large-image-banner-renderer",
    ".large-image-banner-renderer",
    // Bottom-right cover art widget
    "#song-image",
    ".song-image",
    "ytmusic-thumbnail-overlay-toggle-button-renderer",
    // The pip / fullscreen album art thumbnail
    "#thumbnail-image-wrapper",
    ".thumbnail-image-wrapper",
    // Queue panel album art hero
    "#queue-panel-header-thumbnail",
    // Side panel now-playing image
    "#side-panel ytmusic-player-queue #header-thumbnail",
    // Mini-player background art (the blurred one behind controls)
    "ytmusic-player #song-image",
    "ytmusic-player .image-wrapper",
  ];

  let styleTag = null;

  function applyAlbumArtRemoval() {
    if (settings.removeAlbumArt) {
      if (!styleTag) {
        styleTag = document.createElement("style");
        styleTag.id = "ytmusic-stay-styles";
        document.documentElement.appendChild(styleTag);
      }
      styleTag.textContent = buildCSS();
    } else {
      if (styleTag) {
        styleTag.textContent = "";
      }
    }
  }

  function buildCSS() {
    return `
      /* YTMusic Stay — Album art removal */

      /* Large album art image that floats bottom-right */
      ytmusic-player #song-image,
      ytmusic-player .image-wrapper,
      #song-image,
      .song-image,
      ytmusic-large-image-banner-renderer,
      .ytmusic-large-image-banner-renderer,

      /* Queue / side-panel hero thumbnail */
      #queue-panel-header-thumbnail,
      #header-thumbnail.ytmusic-player-queue,

      /* The "now playing" large art beside lyrics */
      #side-panel #thumbnail-image,
      ytmusic-player-page #song-image,

      /* Blurred background behind controls */
      ytmusic-player #player-page-body .image-wrapper,

      /* Full-screen art overlay */
      ytmusic-fullscreen-player #song-image,
      ytmusic-fullscreen-player .image-container,

      /* Thumbnail overlay toggle (the little expand icon on art) */
      ytmusic-thumbnail-overlay-toggle-button-renderer {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* Keep the bottom bar always visible */
      ytmusic-player-bar {
        display: flex !important;
        visibility: visible !important;
      }
    `;
  }

  /* ══════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════ */
  function init() {
    interceptNavigation();
    applyAlbumArtRemoval();
    // Removed observeDOM() because static CSS via <style> automatically applies 
    // to dynamically added DOM elements. Re-parsing CSS on every YouTube Music 
    // mutation was freezing the browser.
  }
})();

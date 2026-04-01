const KEYS = ["blockNavigation", "removeAlbumArt"];
const TOGGLE_IDS = {
  blockNavigation: "toggle-nav",
  removeAlbumArt: "toggle-art",
};

let needsReload = false;

// Load saved settings and apply to toggles
chrome.storage.sync.get(KEYS, (stored) => {
  KEYS.forEach((key) => {
    const val = stored[key] !== undefined ? stored[key] : true; // default ON
    document.getElementById(TOGGLE_IDS[key]).checked = val;
  });
});

function toggleSetting(key) {
  const checkbox = document.getElementById(TOGGLE_IDS[key]);
  // If click came from row, flip the checkbox first
  if (document.activeElement !== checkbox) {
    checkbox.checked = !checkbox.checked;
  }
  const newVal = checkbox.checked;
  chrome.storage.sync.set({ [key]: newVal }, () => {
    showReloadHint();
  });
}

function showReloadHint() {
  const status = document.getElementById("status");
  status.classList.add("visible");
}

// Make row clicks work correctly
document.querySelectorAll(".row").forEach((row) => {
  row.addEventListener("click", () => {
    const key = row.id === "row-nav" ? "blockNavigation" : "removeAlbumArt";
    toggleSetting(key);
  });
});

// ── Accent colour presets & helpers ──────────────────────────────────────────
// Kept in a separate file so both App.jsx and SettingsPage.jsx can import
// without creating a circular dependency.

export const ACCENT_PRESETS = [
  {
    id: "red",
    label: "Red",
    color: "#e50914",
    color2: "#ff1a24",
    dim: "rgba(229,9,20,0.15)",
    glow: "0 0 30px rgba(229,9,20,0.3)",
  },
  {
    id: "blue",
    label: "Blue",
    color: "#2563eb",
    color2: "#3b82f6",
    dim: "rgba(37,99,235,0.15)",
    glow: "0 0 30px rgba(37,99,235,0.3)",
  },
  {
    id: "purple",
    label: "Purple",
    color: "#7c3aed",
    color2: "#8b5cf6",
    dim: "rgba(124,58,237,0.15)",
    glow: "0 0 30px rgba(124,58,237,0.3)",
  },
  {
    id: "green",
    label: "Green",
    color: "#059669",
    color2: "#10b981",
    dim: "rgba(5,150,105,0.15)",
    glow: "0 0 30px rgba(5,150,105,0.3)",
  },
  {
    id: "orange",
    label: "Orange",
    color: "#d97706",
    color2: "#f59e0b",
    dim: "rgba(217,119,6,0.15)",
    glow: "0 0 30px rgba(217,119,6,0.3)",
  },
  {
    id: "pink",
    label: "Pink",
    color: "#db2777",
    color2: "#ec4899",
    dim: "rgba(219,39,119,0.15)",
    glow: "0 0 30px rgba(219,39,119,0.3)",
  },
];

export function applyAccentColor(presetId) {
  const preset =
    ACCENT_PRESETS.find((p) => p.id === presetId) ?? ACCENT_PRESETS[0];
  const root = document.documentElement;
  root.style.setProperty("--red", preset.color);
  root.style.setProperty("--red2", preset.color2);
  root.style.setProperty("--red-dim", preset.dim);
  root.style.setProperty("--red-glow", preset.glow);
}

// ── Theme presets ─────────────────────────────────────────────────────────────

/**
 * Each theme defines the background/surface/text CSS variables.
 * The accent colour (--red / --red2 / ...) is applied via applyAccentColor.
 */
export const THEME_PRESETS = [
  {
    id: "dark",
    label: "Dark",
    description: "Default dark theme",
    vars: {
      "--bg": "#0a0a0a",
      "--surface": "#111111",
      "--surface2": "#1a1a1a",
      "--surface3": "#222222",
      "--border": "#2a2a2a",
      "--text": "#f0f0f0",
      "--text2": "#c0c0c0",
      "--text3": "#909090",
    },
  },
  {
    id: "amoled",
    label: "AMOLED",
    description: "Very black :) (for OLED displays)",
    vars: {
      "--bg": "#000000",
      "--surface": "#080808",
      "--surface2": "#111111",
      "--surface3": "#181818",
      "--border": "#1f1f1f",
      "--text": "#ffffff",
      "--text2": "#cccccc",
      "--text3": "#888888",
    },
  },
  {
    id: "mocha",
    label: "Mocha",
    description: "Warm dark brown tones",
    vars: {
      "--bg": "#0e0b09",
      "--surface": "#1a1410",
      "--surface2": "#231c16",
      "--surface3": "#2e251d",
      "--border": "#3a2e24",
      "--text": "#f0e8df",
      "--text2": "#c4b09a",
      "--text3": "#8a7060",
    },
  },
  {
    id: "slate",
    label: "Slate",
    description: "Cool blue-grey tones",
    vars: {
      "--bg": "#0d1117",
      "--surface": "#161b22",
      "--surface2": "#1f2937",
      "--surface3": "#273344",
      "--border": "#30363d",
      "--text": "#e6edf3",
      "--text2": "#8b949e",
      "--text3": "#6e7681",
    },
  },
  {
    id: "light",
    label: "Light",
    description: "Very white (basic light theme)",
    vars: {
      "--bg": "#ebebed",
      "--surface": "#f8f8fa",
      "--surface2": "#eeeef0",
      "--surface3": "#e2e2e5",
      "--border": "#c8c8cc",
      "--text": "#111113",
      "--text2": "#3a3a40",
      "--text3": "#6b6b74",
    },
  },
  {
    id: "custom",
    label: "Custom",
    description: "Your own colours",
    vars: null,
  },
];

/** Default custom theme vars (used when user first opens the custom editor). */
export const DEFAULT_CUSTOM_VARS = {
  "--bg": "#0a0a0a",
  "--surface": "#111111",
  "--surface2": "#1a1a1a",
  "--surface3": "#222222",
  "--border": "#2a2a2a",
  "--text": "#f0f0f0",
  "--text2": "#c0c0c0",
  "--text3": "#909090",
};

/**
 * Apply a theme by id.
 * @param {string} themeId  - id from THEME_PRESETS
 * @param {object|null} customVars - only used when themeId === "custom"
 */
export function applyTheme(themeId, customVars = null) {
  const preset =
    THEME_PRESETS.find((t) => t.id === themeId) ?? THEME_PRESETS[0];
  const vars =
    themeId === "custom" ? (customVars ?? DEFAULT_CUSTOM_VARS) : preset.vars;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(vars)) {
    root.style.setProperty(prop, value);
  }
}

// ── Shared subtitle helpers ───────────────────────────────────────────────────

export const SUBTITLE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh-CN", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "tr", label: "Turkish" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "cs", label: "Czech" },
  { code: "hu", label: "Hungarian" },
];

export const LANG_LABEL = Object.fromEntries(
  SUBTITLE_LANGUAGES.map((l) => [l.code, l.label]),
);

/** Return the style props for a source badge (SubDL / Wyzie) */
export function sourceBadgeStyle(sub) {
  const isSubDL = sub.via_subdl;
  return {
    fontSize: 9,
    fontWeight: 700,
    padding: "1px 5px",
    borderRadius: 3,
    background: isSubDL ? "rgba(99,149,255,0.15)" : "rgba(180,130,255,0.15)",
    color: isSubDL ? "#6395ff" : "#b482ff",
    border: `1px solid ${isSubDL ? "rgba(99,149,255,0.3)" : "rgba(180,130,255,0.3)"}`,
    textTransform: "uppercase",
    flexShrink: 0,
  };
}

export function sourceBadgeLabel(sub) {
  if (sub.via_subdl) return "SubDL";
  return "Wyzie";
}

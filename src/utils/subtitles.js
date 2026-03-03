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

/** Return the style props for a source badge (SubDL / Wyzie / OpenSubs) */
export function sourceBadgeStyle(sub) {
  const isSubDL = sub.via_subdl;
  const isWyzie = sub.via_wyzie;
  return {
    fontSize: 9,
    fontWeight: 700,
    padding: "1px 5px",
    borderRadius: 3,
    background: isSubDL
      ? "rgba(99,149,255,0.15)"
      : isWyzie
        ? "rgba(180,130,255,0.15)"
        : "rgba(229,9,20,0.12)",
    color: isSubDL ? "#6395ff" : isWyzie ? "#b482ff" : "var(--red)",
    border: `1px solid ${isSubDL ? "rgba(99,149,255,0.3)" : isWyzie ? "rgba(180,130,255,0.3)" : "rgba(229,9,20,0.3)"}`,
    textTransform: "uppercase",
    flexShrink: 0,
  };
}

export function sourceBadgeLabel(sub) {
  if (sub.via_subdl) return "SubDL";
  if (sub.via_wyzie) return "Wyzie";
  return "OpenSubs";
}

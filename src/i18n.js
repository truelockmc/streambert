import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { storage, STORAGE_KEYS } from "./utils/storage";
import en from "./locales/en/translation.json";
import de from "./locales/de/translation.json";

// Add a new language here after creating src/locales/<code>/translation.json.
// The label is shown in its own language and is intentionally not translated.
export const UI_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
];

const SUPPORTED = UI_LANGUAGES.map((l) => l.value);

/** Resolve the stored preference ("system" or a language code) to a supported code. */
export function resolveLanguage(pref) {
  const wanted =
    !pref || pref === "system"
      ? (navigator.language || "en").split("-")[0].toLowerCase()
      : pref;
  return SUPPORTED.includes(wanted) ? wanted : "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: resolveLanguage(storage.get(STORAGE_KEYS.UI_LANG)),
  fallbackLng: "en",
  returnEmptyString: false, // untranslated (empty) strings fall back to English
  interpolation: { escapeValue: false }, // React already escapes
});

// Keep <html lang> in sync (helps spellcheck, hyphenation, screen readers)
document.documentElement.lang = i18n.language;
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

export default i18n;

// localStorage-based persistence (works in both Vite dev and prod)

const PREFIX = "streambert_";

export const storage = {
  get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  },
};

export const getApiKey = () => storage.get("apikey");

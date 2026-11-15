/** Browser-only preference migration. Historical keys remain readable during upgrade. */
export function readPreference(key: string): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;
    const legacy = localStorage.getItem(key.replace(/^uap\./, 'grokbot.'));
    if (legacy !== null) localStorage.setItem(key, legacy);
    return legacy;
  } catch { return null; }
}

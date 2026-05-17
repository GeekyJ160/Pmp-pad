export interface ApiConfig {
  xaiKey: string;
  hfKey: string;
  provider: 'grok' | 'hf';
  model: string;
  hfModel: string;
  temperature: number;
}

export interface BeatData {
  bpm: number | null;
  key: string | null;
  chord: string | null;
}

export const Storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : fallback;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("localStorage not available");
    }
  }
};

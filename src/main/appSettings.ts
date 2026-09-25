import * as fs from 'fs';
import * as path from 'path';

export interface AppSettings {
  keepInTray: boolean;
  launchAtLogin: boolean;
}

const DEFAULTS: AppSettings = { keepInTray: true, launchAtLogin: false };

export class AppSettingsStore {
  private readonly filePath: string;
  private value: AppSettings;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'app-settings.json');
    let stored: Partial<AppSettings> = {};
    try { stored = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch { /* 初回は既定値 */ }
    this.value = {
      keepInTray: typeof stored.keepInTray === 'boolean' ? stored.keepInTray : DEFAULTS.keepInTray,
      launchAtLogin: typeof stored.launchAtLogin === 'boolean' ? stored.launchAtLogin : DEFAULTS.launchAtLogin,
    };
  }

  get(): AppSettings {
    return { ...this.value };
  }

  set(change: Partial<AppSettings>): AppSettings {
    this.value = { ...this.value, ...change };
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.value, null, 2));
    fs.renameSync(temporary, this.filePath);
    return this.get();
  }
}

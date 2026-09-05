import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export async function readSystemAppearance({ platform = process.platform, run = execute } = {}) {
  try {
    if (platform === 'darwin') {
      const { stdout } = await run('/usr/bin/defaults', ['read', '-g', 'AppleInterfaceStyle'], { timeout: 1500 });
      return stdout.trim().toLowerCase() === 'dark' ? 'dark' : 'light';
    }
    if (platform === 'win32') {
      const { stdout } = await run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'], { timeout: 1500 });
      const match = stdout.match(/AppsUseLightTheme\s+REG_DWORD\s+0x([01])/i);
      return match ? (match[1] === '0' ? 'dark' : 'light') : null;
    }
    if (platform === 'linux') {
      const { stdout } = await run('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'], { timeout: 1500 });
      if (/prefer-dark/.test(stdout)) return 'dark';
      if (/prefer-light|default/.test(stdout)) return 'light';
    }
  } catch (error) {
    // macOS removes this preference in Light mode; other failures retain the last reading.
    if (platform === 'darwin' && error.code === 1 && /does not exist/.test(error.stderr || '')) return 'light';
  }
  return null;
}

export class SystemAppearance {
  constructor(onChange, { read = readSystemAppearance, interval = 3000 } = {}) {
    this.onChange = onChange; this.read = read; this.interval = interval; this.stopped = true;
  }
  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    await this.poll();
    if (!this.stopped) this.timer = setInterval(() => void this.poll(), this.interval);
  }
  async poll() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const appearance = await this.read();
      if (!this.stopped && ['light', 'dark'].includes(appearance)) this.onChange(appearance);
    } catch { /* Retain the last known appearance if the OS query fails. */ }
    finally { this.busy = false; }
  }
  stop() { this.stopped = true; clearInterval(this.timer); }
}

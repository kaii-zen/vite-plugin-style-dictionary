import { describe, expect, it, vi } from 'vitest';
import { normalizeViteIdForPlatform } from '../src/path-utils';

if (process.platform === 'win32') {
  describe('normalizeViteIdForPlatform (win32)', () => {
    it('strips windows namespace prefix from /@fs/ ids', () => {
      const realpathSync = vi.fn((value: string) => value) as (value: string) => string;
      const id = '/@fs//?/C:/Users/Runner/AppData/Local/Temp/vite-sd/tokens.ts';

      const normalized = normalizeViteIdForPlatform(id, 'win32', realpathSync);

      expect(normalized).toBe(
        '/@fs/C:/Users/Runner/AppData/Local/Temp/vite-sd/tokens.ts',
      );
      expect(realpathSync).toHaveBeenCalledWith(
        'C:\\Users\\Runner\\AppData\\Local\\Temp\\vite-sd\\tokens.ts',
      );
    });
  });
} else {
  describe('normalizeViteIdForPlatform (non-win32)', () => {
    it('returns the input unchanged', () => {
      const realpathSync = vi.fn((value: string) => value) as (value: string) => string;
      const id = '/@fs/home/runner/project/tokens.ts';

      const normalized = normalizeViteIdForPlatform(id, 'linux', realpathSync);

      expect(normalized).toBe(id);
      expect(realpathSync).not.toHaveBeenCalled();
    });
  });
}

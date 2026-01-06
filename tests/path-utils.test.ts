import { describe, expect, it, vi } from 'vitest';
import { normalizeViteIdForPlatform } from '../src/path-utils';

describe('normalizeViteIdForPlatform', () => {
  it('strips windows namespace prefix from /@fs/ ids', () => {
    const realpathSync = vi.fn((value: string) => value);
    const id = '/@fs//?/C:/Users/Runner/AppData/Local/Temp/vite-sd/tokens.ts';

    const normalized = normalizeViteIdForPlatform(id, 'win32', realpathSync);

    expect(normalized).toBe(
      '/@fs/C:/Users/Runner/AppData/Local/Temp/vite-sd/tokens.ts',
    );
    expect(realpathSync).toHaveBeenCalledWith(
      'C:\\Users\\Runner\\AppData\\Local\\Temp\\vite-sd\\tokens.ts',
    );
  });

  it('returns the input unchanged on non-windows platforms', () => {
    const realpathSync = vi.fn((value: string) => value);
    const id = '/@fs//?/C:/Users/Runner/AppData/Local/Temp/vite-sd/tokens.ts';

    const normalized = normalizeViteIdForPlatform(id, 'linux', realpathSync);

    expect(normalized).toBe(id);
    expect(realpathSync).not.toHaveBeenCalled();
  });
});

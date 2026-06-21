import { describe, expect, it } from 'vitest';

import {
  buildBrowserLoginResult,
  cookiesToHeader,
  toBrowserLoginError,
} from '../src/note/browser-login.js';

describe('cookiesToHeader', () => {
  it('serializes note.com cookies into a Cookie header', () => {
    expect(
      cookiesToHeader([
        { name: '_note_session_v5', value: 'abc', domain: '.note.com' },
        { name: 'other', value: 'def', domain: 'example.com' },
        { name: 'XSRF-TOKEN', value: 'ghi', domain: 'note.com' },
      ]),
    ).toBe('_note_session_v5=abc; XSRF-TOKEN=ghi');
  });

  it('throws when no note.com cookie exists', () => {
    expect(() => cookiesToHeader([{ name: 'other', value: 'def', domain: 'example.com' }])).toThrow(
      /No note\.com cookies/,
    );
  });
});

describe('toBrowserLoginError', () => {
  it('turns missing Playwright browser errors into actionable install guidance', () => {
    const error = toBrowserLoginError(
      new Error(
        'browserType.launch: Executable doesn\'t exist at /Users/new-village/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing\nPlease run the following command to download new browsers:\n    npx playwright install',
      ),
    );

    expect(error.message).toContain('Playwright browser is not installed');
    expect(error.message).toContain('npx playwright install chromium');
    expect(error.message).not.toContain('/Users/new-village');
  });
});

describe('buildBrowserLoginResult', () => {
  it('includes the config file path when the cookie is saved', () => {
    expect(
      buildBrowserLoginResult('fp=browser-cookie-value', true, {
        configPath: '/Users/kazu/.config/note-mcp/config.json',
        cookiePreview: 'fp=b…alue',
      }),
    ).toEqual({
      authenticated: true,
      saved: true,
      configPath: '/Users/kazu/.config/note-mcp/config.json',
      cookiePreview: 'fp=b…alue',
      message:
        'note.com authentication configured from browser login. Cookie saved to /Users/kazu/.config/note-mcp/config.json.',
    });
  });
});

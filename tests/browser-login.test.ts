import { describe, expect, it } from 'vitest';

import { cookiesToHeader } from '../src/note/browser-login.js';

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

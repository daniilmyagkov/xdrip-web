import { describe, expect, it } from 'vitest';
import { parseConnectLink, toBase64Url } from '../src/state/session';

// the same vector as WebAccessLinkTest.linkCarriesAddressAndToken on Android
const CODE = 'eyJ1IjoiaHR0cHM6Ly9ucy5leGFtcGxlIiwidCI6Inhkcmlwd2ViLTAxMjM0NTY3ODlhYmNkZWYifQ';

describe('onboarding link', () => {
  it('encodes like the Android app', () => {
    expect(toBase64Url('{"u":"https://ns.example","t":"xdripweb-0123456789abcdef"}')).toBe(CODE);
  });

  it('accepts the full link, the fragment and the bare code', () => {
    const want = { baseUrl: 'https://ns.example', token: 'xdripweb-0123456789abcdef' };
    expect(parseConnectLink(`https://daniilmyagkov.github.io/xdrip-web/#connect=${CODE}`)).toEqual(want);
    expect(parseConnectLink(`#connect=${CODE}`)).toEqual(want);
    expect(parseConnectLink(`  ${CODE}\n`)).toEqual(want);
  });

  it('rejects anything else', () => {
    expect(parseConnectLink('')).toBeNull();
    expect(parseConnectLink('https://example.com/')).toBeNull();
    expect(parseConnectLink('connect=!!!')).toBeNull();
    expect(parseConnectLink(`connect=${toBase64Url('{"t":"x"}')}`)).toBeNull();
  });
});

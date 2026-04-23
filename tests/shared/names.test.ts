import { splitName, looksLikeEmail, looksLikePhone } from '../../src/shared/names';

describe('splitName', () => {
  it.each([
    ['', { first: '', last: '' }],
    [null, { first: '', last: '' }],
    [undefined, { first: '', last: '' }],
    ['Prince', { first: 'Prince', last: '' }],
    ['Jane Doe', { first: 'Jane', last: 'Doe' }],
    ['Mary Ann Jones Smith', { first: 'Mary', last: 'Ann Jones Smith' }],
    ['María García López', { first: 'María', last: 'García López' }],
    ['  extra  spaces  ', { first: 'extra', last: 'spaces' }],
    ['山田太郎', { first: '山田太郎', last: '' }],
    ['山田 太郎', { first: '山田', last: '太郎' }],
  ])('splitName(%p)', (input, expected) => {
    expect(splitName(input as string | undefined | null)).toEqual(expected);
  });
});

describe('looksLikeEmail', () => {
  it.each([
    ['user@example.com', true],
    ['first.last+tag@sub.example.co.uk', true],
    ['carolcoder@users.noreply.github.com', true],
    ['', false],
    [null, false],
    [undefined, false],
    ['user@', false],
    ['@example.com', false],
    ['no-at-sign.com', false],
    ['Prince', false],
    ['Jane Doe', false],
  ])('looksLikeEmail(%p) = %p', (input, expected) => {
    expect(looksLikeEmail(input as string | undefined | null)).toBe(expected);
  });
});

describe('looksLikePhone', () => {
  it.each([
    ['+15551234567', true],
    ['5551234567', true],
    ['+44 20 7946 0958', true],
    ['(555) 123-4567', true],
    ['', false],
    [null, false],
    [undefined, false],
    ['not a phone', false],
    ['()---', false],
    ['Jane Doe', false],
    ['user@example.com', false],
  ])('looksLikePhone(%p) = %p', (input, expected) => {
    expect(looksLikePhone(input as string | undefined | null)).toBe(expected);
  });
});

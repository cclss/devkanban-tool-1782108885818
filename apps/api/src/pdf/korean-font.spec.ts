import { PDFDocument } from 'pdf-lib';
import { embedKoreanFont, loadKoreanFontBytes } from './korean-font';

describe('korean-font util', () => {
  it('loads the bundled TTF bytes (and caches the same instance)', () => {
    const a = loadKoreanFontBytes();
    const b = loadKoreanFontBytes();
    expect(a.byteLength).toBeGreaterThan(100_000); // a real TTF, not a stub
    expect(a).toBe(b); // cached
  });

  it('embeds a Hangul-capable font with positive glyph widths', async () => {
    const doc = await PDFDocument.create();
    const font = await embedKoreanFont(doc);
    // Korean text must measure to a real (non-zero) width — i.e. the glyphs
    // exist in the font, so they will not render as tofu.
    expect(font.widthOfTextAtSize('서명 계약 완료', 12)).toBeGreaterThan(0);
  });

  it('drawing Hangul does not throw and produces a valid PDF', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const font = await embedKoreanFont(doc);
    page.drawText('홍길동 — 서명 완료 (계약)', { x: 20, y: 100, size: 16, font });
    const bytes = await doc.save();
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it('reuses the embedded font per document', async () => {
    const doc = await PDFDocument.create();
    const first = await embedKoreanFont(doc);
    const second = await embedKoreanFont(doc);
    expect(first).toBe(second);
  });
});

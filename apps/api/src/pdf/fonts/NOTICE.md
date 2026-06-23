# Bundled fonts

## NanumGothic-Regular.ttf

- **Family**: Nanum Gothic (나눔고딕)
- **Role**: Korean gothic (sans) face embedded into server-generated PDFs
  (signed final document overlays + audit-trail certificate). It is the
  embeddable representative of the Design Spec `typography` gothic role
  (`font-family-sans-pdf`), and stays consistent with the Nanum family already
  used by the serif/script roles (`font-family-serif` = Nanum Myeongjo,
  `font-family-script` = Nanum Pen Script).
- **Why bundled**: `pdf-lib` cannot reference system/web fonts, so a static TTF
  must be embedded for Hangul to render without tofu. A bundled file keeps PDF
  generation deterministic and offline (no runtime font fetch).
- **License**: SIL Open Font License 1.1 (OFL). Author: Sandoll Communications,
  Inc. Source: Google Fonts (`github.com/google/fonts`, `ofl/nanumgothic`).
  The OFL permits embedding in documents. See <https://scripts.sil.org/OFL>.

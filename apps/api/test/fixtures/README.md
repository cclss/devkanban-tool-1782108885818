# e2e test fixtures

## `korean-contract.docx`

A minimal but valid OOXML WordprocessingML (`.docx`) package containing a short
Korean contract body. Used by `test/docx-upload.e2e-spec.ts` to exercise the
real DOCX→PDF conversion path (LibreOffice headless) end-to-end.

It is a real ZIP container (`PK` magic) with the three parts a `.docx` needs:
`[Content_Types].xml`, `_rels/.rels`, and `word/document.xml`.

Regenerate with:

```bash
python3 - <<'PY'
import zipfile

content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''

rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''

def para(text, bold=False):
    b = '<w:rPr><w:b/></w:rPr>' if bold else ''
    return '<w:p><w:r>%s<w:t xml:space="preserve">%s</w:t></w:r></w:p>' % (b, text)

body = ''.join([
    para('계약서', bold=True),
    para('본 계약은 갑과 을 사이에 체결된 전자 서명 계약입니다.'),
    para('제1조 (목적) 본 계약은 한글 문서의 PDF 변환 왕복을 검증하기 위한 것입니다.'),
    para('제2조 (효력) 서명이 완료되면 본 계약은 즉시 효력을 발생합니다.'),
    para('갑: 홍길동    을: 김철수'),
])

document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:body>%s'
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
    '</w:body></w:document>' % body)

with zipfile.ZipFile('korean-contract.docx', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', rels)
    z.writestr('word/document.xml', document)
PY
```

The corrupt/unsupported `.docx` for the failure scenario is built inline in the
spec (a `PK`-prefixed non-ZIP buffer) — no fixture file needed.

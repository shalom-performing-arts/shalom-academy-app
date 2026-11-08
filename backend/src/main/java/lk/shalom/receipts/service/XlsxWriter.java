package lk.shalom.receipts.service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Writes one sheet of text as an Excel workbook (.xlsx), with a bold, frozen header row. Small
 * enough not to need a spreadsheet library: an .xlsx file is a zip of a few XML files.
 */
final class XlsxWriter {

    private XlsxWriter() {
    }

    static byte[] write(String sheetName, List<List<String>> rows) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            put(zip, "[Content_Types].xml", """
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                    <Default Extension="xml" ContentType="application/xml"/>
                    <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                    <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                    <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
                    </Types>""");
            put(zip, "_rels/.rels", """
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                    </Relationships>""");
            put(zip, "xl/workbook.xml", """
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                    <sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets>
                    </workbook>""".formatted(esc(sheetName)));
            put(zip, "xl/_rels/workbook.xml.rels", """
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                    <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
                    </Relationships>""");
            put(zip, "xl/styles.xml", """
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                    <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
                    <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
                    <fill><patternFill patternType="solid"><fgColor rgb="FF8E2B52"/><bgColor indexed="64"/></patternFill></fill></fills>
                    <borders count="1"><border/></borders>
                    <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
                    <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
                    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
                    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
                    </styleSheet>""");
            StringBuilder s = new StringBuilder("""
                    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                    <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
                    """);
            int cols = rows.isEmpty() ? 0 : rows.getFirst().size();
            if (cols > 0) s.append("<cols><col min=\"1\" max=\"").append(cols).append("\" width=\"20\" customWidth=\"1\"/></cols>");
            s.append("<sheetData>");
            for (int r = 0; r < rows.size(); r++) {
                s.append("<row r=\"").append(r + 1).append("\">");
                List<String> row = rows.get(r);
                for (int c = 0; c < row.size(); c++) {
                    String v = row.get(c) == null ? "" : row.get(c);
                    s.append("<c r=\"").append(column(c)).append(r + 1).append("\" t=\"inlineStr\" s=\"")
                            .append(r == 0 ? 1 : 2).append("\"><is><t xml:space=\"preserve\">")
                            .append(esc(v)).append("</t></is></c>");
                }
                s.append("</row>");
            }
            s.append("</sheetData>");
            if (rows.size() > 1 && cols > 0) {
                s.append("<autoFilter ref=\"A1:").append(column(cols - 1)).append(rows.size()).append("\"/>");
            }
            s.append("</worksheet>");
            put(zip, "xl/worksheets/sheet1.xml", s.toString());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return bytes.toByteArray();
    }

    /** 0 → A, 25 → Z, 26 → AA */
    static String column(int i) {
        StringBuilder b = new StringBuilder();
        for (int n = i + 1; n > 0; n = (n - 1) / 26) b.insert(0, (char) ('A' + (n - 1) % 26));
        return b.toString();
    }

    private static void put(ZipOutputStream zip, String name, String xml) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(xml.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    /** XML-safe, dropping characters XML cannot hold at all */
    private static String esc(String v) {
        StringBuilder b = new StringBuilder(v.length());
        v.codePoints().forEach(cp -> {
            switch (cp) {
                case '&' -> b.append("&amp;");
                case '<' -> b.append("&lt;");
                case '>' -> b.append("&gt;");
                case '"' -> b.append("&quot;");
                default -> {
                    if (cp == 0x9 || cp == 0xA || cp == 0xD || (cp >= 0x20 && cp != 0xFFFE && cp != 0xFFFF)) b.appendCodePoint(cp);
                }
            }
        });
        return b.toString();
    }
}

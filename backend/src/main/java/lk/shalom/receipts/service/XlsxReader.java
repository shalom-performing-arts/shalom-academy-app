package lk.shalom.receipts.service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Reads the values out of an .xlsx file: every sheet as rows of text, the way the cells show
 * their stored values (numbers as Excel keeps them, "8000" or "8000.0"). Formulas are not
 * worked out; Excel saves each formula's last result, which is what is read.
 *
 * <p>Small on purpose: the fee workbook is plain cells, so a zip reader and a few patterns do.
 */
public final class XlsxReader {

    private static final Pattern SHEET = Pattern.compile("<sheet\\b[^>]*?name=\"([^\"]*)\"[^>]*?r:id=\"([^\"]+)\"");
    // an empty row is written short, <row r="5"/>: matched as such, so it never runs on into the next row
    private static final Pattern ROW = Pattern.compile("<row\\b[^>]*?(?:/>|>(.*?)</row>)", Pattern.DOTALL);
    private static final Pattern CELL = Pattern.compile("<c\\b([^>]*?)(?:/>|>(.*?)</c>)", Pattern.DOTALL);
    private static final Pattern REF = Pattern.compile("\\br=\"([A-Z]+)\\d+\"");
    private static final Pattern TYPE = Pattern.compile("\\bt=\"([^\"]+)\"");
    private static final Pattern VALUE = Pattern.compile("<v>(.*?)</v>", Pattern.DOTALL);
    private static final Pattern TEXT = Pattern.compile("<t\\b[^>]*>(.*?)</t>", Pattern.DOTALL);
    private static final Pattern SI = Pattern.compile("<si>(.*?)</si>", Pattern.DOTALL);

    private XlsxReader() {}

    /** Sheet name → its rows, each row the cells from column A (blank cells are ""). */
    public static Map<String, List<List<String>>> read(byte[] xlsx) {
        Map<String, byte[]> parts = unzip(xlsx);
        if (!parts.containsKey("xl/workbook.xml")) {
            throw ApiException.badRequest("That file is not an Excel workbook (.xlsx).");
        }
        List<String> shared = new ArrayList<>();
        Matcher si = SI.matcher(text(parts, "xl/sharedStrings.xml"));
        while (si.find()) {
            StringBuilder sb = new StringBuilder();
            Matcher t = TEXT.matcher(si.group(1));
            while (t.find()) sb.append(t.group(1));
            shared.add(unescape(sb.toString()));
        }
        String rels = text(parts, "xl/_rels/workbook.xml.rels");
        Map<String, List<List<String>>> out = new LinkedHashMap<>();
        Matcher sheet = SHEET.matcher(text(parts, "xl/workbook.xml"));
        while (sheet.find()) {
            String target = target(rels, sheet.group(2));
            if (target == null) continue;
            String path = target.startsWith("/") ? target.substring(1) : "xl/" + target.replaceFirst("^xl/", "");
            out.put(unescape(sheet.group(1)), rows(text(parts, path), shared));
        }
        return out;
    }

    private static List<List<String>> rows(String xml, List<String> shared) {
        List<List<String>> rows = new ArrayList<>();
        Matcher row = ROW.matcher(xml);
        while (row.find()) {
            Map<Integer, String> cells = new HashMap<>();
            int last = -1;
            if (row.group(1) == null) { rows.add(new ArrayList<>()); continue; }
            Matcher c = CELL.matcher(row.group(1));
            while (c.find()) {
                String attrs = c.group(1), body = c.group(2) == null ? "" : c.group(2);
                Matcher ref = REF.matcher(attrs);
                if (!ref.find()) continue;
                int col = column(ref.group(1));
                Matcher type = TYPE.matcher(attrs);
                String t = type.find() ? type.group(1) : "";
                String value;
                if ("inlineStr".equals(t)) {
                    Matcher tx = TEXT.matcher(body);
                    value = tx.find() ? unescape(tx.group(1)) : "";
                } else {
                    Matcher v = VALUE.matcher(body);
                    value = v.find() ? unescape(v.group(1)) : "";
                    if ("s".equals(t) && !value.isEmpty()) {
                        int i = Integer.parseInt(value.trim());
                        value = i >= 0 && i < shared.size() ? shared.get(i) : "";
                    }
                }
                cells.put(col, value);
                last = Math.max(last, col);
            }
            List<String> r = new ArrayList<>();
            for (int i = 0; i <= last; i++) r.add(cells.getOrDefault(i, ""));
            rows.add(r);
        }
        return rows;
    }

    private static int column(String letters) {
        int n = 0;
        for (char ch : letters.toCharArray()) n = n * 26 + (ch - 'A' + 1);
        return n - 1;
    }

    private static String target(String rels, String id) {
        Matcher m = Pattern.compile("<Relationship\\b[^>]*>").matcher(rels);
        while (m.find()) {
            String tag = m.group();
            if (tag.contains("Id=\"" + id + "\"")) {
                Matcher t = Pattern.compile("Target=\"([^\"]+)\"").matcher(tag);
                if (t.find()) return t.group(1);
            }
        }
        return null;
    }

    private static Map<String, byte[]> unzip(byte[] xlsx) {
        Map<String, byte[]> parts = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(xlsx))) {
            ZipEntry e;
            while ((e = zip.getNextEntry()) != null) {
                if (!e.isDirectory()) parts.put(e.getName(), readAll(zip));
            }
        } catch (IOException e) {
            throw ApiException.badRequest("That file could not be opened as an Excel workbook.");
        }
        return parts;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        return in.readAllBytes();
    }

    private static String text(Map<String, byte[]> parts, String name) {
        byte[] b = parts.get(name);
        return b == null ? "" : new String(b, StandardCharsets.UTF_8);
    }

    private static String unescape(String s) {
        return s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'")
                .replace("&#10;", "\n").replace("&amp;", "&");
    }
}

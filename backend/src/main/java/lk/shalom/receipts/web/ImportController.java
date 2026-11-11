package lk.shalom.receipts.web;

import lk.shalom.receipts.service.ApiException;
import lk.shalom.receipts.service.WorkbookImport;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;

/**
 * Brings in the office's monthly fee workbook (.xlsx). Without {@code apply} nothing is saved:
 * the answer lists every change, for the office to check first. Office only.
 */
@RestController
@RequestMapping("/api/import")
public class ImportController {

    private final WorkbookImport workbook;

    public ImportController(WorkbookImport workbook) {
        this.workbook = workbook;
    }

    @PostMapping(value = "/workbook", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public WorkbookImport.Preview workbook(@RequestPart("file") MultipartFile file,
                                           @RequestParam(defaultValue = "false") boolean apply) throws IOException {
        if (file == null || file.isEmpty()) throw ApiException.badRequest("Choose the workbook file first.");
        if (file.getSize() > 10 * 1024 * 1024) throw ApiException.badRequest("That file is too big for a fee workbook.");
        byte[] bytes = file.getBytes();
        return apply ? workbook.apply(bytes) : workbook.preview(bytes);
    }
}

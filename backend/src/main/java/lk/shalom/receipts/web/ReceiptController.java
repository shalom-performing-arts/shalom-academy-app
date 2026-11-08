package lk.shalom.receipts.web;

import lk.shalom.receipts.model.Receipt;
import lk.shalom.receipts.service.ReceiptService;
import lk.shalom.receipts.service.ReceiptService.MonthTotal;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/receipts")
public class ReceiptController {

    private final ReceiptService service;

    public ReceiptController(ReceiptService service) {
        this.service = service;
    }

    @GetMapping
    public List<Receipt> list() {
        return service.list();
    }

    @GetMapping("/{id}")
    public Receipt get(@PathVariable String id) {
        return service.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Receipt create(@RequestBody Receipt receipt) {
        return service.create(receipt);
    }

    @PutMapping("/{id}")
    public Receipt update(@PathVariable String id, @RequestBody Receipt receipt) {
        return service.update(id, receipt);
    }

    /** Body: {"to": "94710407740"}. Called once the person confirms the WhatsApp message went. */
    @PostMapping("/{id}/sent")
    public Receipt sent(@PathVariable String id, @RequestBody Map<String, String> body) {
        return service.markSent(id, body == null ? null : body.get("to"));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id,
                       @RequestParam(defaultValue = "false") boolean removePayments) {
        service.delete(id, removePayments);
    }

    @DeleteMapping
    public Map<String, Integer> deleteAll() {
        return Map.of("deleted", service.deleteAll());
    }

    @GetMapping("/summary")
    public List<MonthTotal> summary() {
        return service.monthlyTotals();
    }

    @GetMapping(value = "/export.csv", produces = "text/csv")
    public ResponseEntity<byte[]> exportCsv() {
        String name = "shalom-receipts-" + LocalDate.now() + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(service.csv().getBytes(StandardCharsets.UTF_8));
    }
}

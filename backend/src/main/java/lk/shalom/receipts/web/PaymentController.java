package lk.shalom.receipts.web;

import lk.shalom.receipts.model.Payment;
import lk.shalom.receipts.service.MonthService;
import lk.shalom.receipts.service.MonthService.DueUpdate;
import lk.shalom.receipts.service.MonthService.MonthView;
import lk.shalom.receipts.service.PaymentService;
import lk.shalom.receipts.service.PaymentService.PaymentInput;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api")
public class PaymentController {

    private final MonthService months;
    private final PaymentService payments;

    public PaymentController(MonthService months, PaymentService payments) {
        this.months = months;
        this.payments = payments;
    }

    /** Everyone's fee and payments for the month, with the dashboard totals. */
    @GetMapping("/months/{month}")
    public MonthView month(@PathVariable String month) {
        return months.view(month);
    }

    /** Starts the month: copies every active student's fee and session into it. */
    @PostMapping("/months/{month}")
    public MonthView start(@PathVariable String month) {
        months.start(month);
        return months.view(month);
    }

    /** This month's fee for one student (fee, or reset=true for the usual fee) and their remark. */
    @PatchMapping("/months/{month}/students/{studentId}")
    public MonthView updateDue(@PathVariable String month, @PathVariable String studentId, @RequestBody DueUpdate update) {
        months.updateDue(month, studentId, update);
        return months.view(month);
    }

    @GetMapping(value = "/months/{month}/export.csv", produces = "text/csv")
    public ResponseEntity<byte[]> exportCsv(@PathVariable String month) {
        String name = "shalom-payments-" + MonthService.check(month) + ".csv";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + name + "\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(months.csv(month).getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/payments")
    @ResponseStatus(HttpStatus.CREATED)
    public Payment create(@RequestBody PaymentInput in) {
        return payments.create(in);
    }

    @PatchMapping("/payments/{id}")
    public Payment update(@PathVariable String id, @RequestBody PaymentInput in) {
        return payments.update(id, in);
    }

    @DeleteMapping("/payments/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        payments.delete(id);
    }
}

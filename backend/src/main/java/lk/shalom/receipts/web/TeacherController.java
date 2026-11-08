package lk.shalom.receipts.web;

import lk.shalom.receipts.service.TeacherService;
import lk.shalom.receipts.service.TeacherService.SalaryOut;
import lk.shalom.receipts.service.TeacherService.SetupInput;
import lk.shalom.receipts.service.TeacherService.SetupOut;
import lk.shalom.receipts.service.TeacherService.SheetOut;
import lk.shalom.receipts.service.TeacherService.TeacherInput;
import lk.shalom.receipts.service.TeacherService.TeacherOut;
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

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** The office's side of teacher attendance and salary. */
@RestController
@RequestMapping("/api/teachers")
public class TeacherController {

    private final TeacherService service;

    public TeacherController(TeacherService service) {
        this.service = service;
    }

    /** The attendance sheet and salary for a pay period ("2026-11" = paid 25 Nov 2026); default the current one. */
    @GetMapping("/sheet")
    public SheetOut sheet(@RequestParam(required = false) String period) {
        return service.sheet(period == null || period.isBlank() ? service.currentPeriod() : period);
    }

    public record MarkInput(String date, String slotId, String teacherId, boolean on) {}

    @PutMapping("/mark")
    public SheetOut mark(@RequestBody MarkInput in) {
        return service.setMark(in.date(), in.slotId(), in.teacherId(), in.on());
    }

    public record AdjustmentInput(String period, String teacherId, BigDecimal amount, String note) {}

    @PutMapping("/adjustment")
    public SalaryOut adjustment(@RequestBody AdjustmentInput in) {
        return service.setAdjustment(in.period(), in.teacherId(), in.amount(), in.note());
    }

    public record PaidInput(String period, String teacherId, boolean paid) {}

    @PutMapping("/paid")
    public SalaryOut paid(@RequestBody PaidInput in) {
        return service.setPaid(in.period(), in.teacherId(), in.paid());
    }

    @GetMapping(value = "/salary.csv", produces = "text/csv")
    public ResponseEntity<byte[]> salaryCsv(@RequestParam String period) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"teacher-salary-" + period + ".csv\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(service.salaryCsv(period).getBytes(StandardCharsets.UTF_8));
    }

    @GetMapping("/setup")
    public SetupOut setup() {
        return service.setup();
    }

    @PutMapping("/setup")
    public SetupOut saveSetup(@RequestBody SetupInput in) {
        return service.saveSetup(in);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TeacherOut create(@RequestBody TeacherInput in) {
        return service.saveTeacher(null, in);
    }

    @PutMapping("/{id}")
    public TeacherOut update(@PathVariable String id, @RequestBody TeacherInput in) {
        return service.saveTeacher(id, in);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        service.deleteTeacher(id);
    }

    /** Body {"pin": "1234"}, or blank for a random one. The answer holds the PIN to give the teacher. */
    @PostMapping("/{id}/pin")
    public Map<String, String> pin(@PathVariable String id, @RequestBody(required = false) Map<String, String> body) {
        return Map.of("pin", service.setPin(id, body == null ? null : body.get("pin")));
    }
}

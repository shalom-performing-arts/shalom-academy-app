package lk.shalom.receipts.web;

import jakarta.servlet.http.HttpServletRequest;
import lk.shalom.receipts.service.RegistrationService;
import lk.shalom.receipts.service.RegistrationService.FormInput;
import lk.shalom.receipts.service.RegistrationService.FormView;
import lk.shalom.receipts.service.RegistrationService.PlaceInput;
import lk.shalom.receipts.service.RegistrationService.PublicForm;
import lk.shalom.receipts.service.RegistrationService.RegistrationInput;
import lk.shalom.receipts.service.RegistrationService.Row;
import lk.shalom.receipts.service.RegistrationService.Submitted;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

/**
 * The online registration form. {@code /api/public/register/**} is the parents' side and needs
 * no sign-in (see WebConfig); everything under {@code /api/registrations} is the office's.
 */
@RestController
public class RegistrationController {

    private final RegistrationService service;

    public RegistrationController(RegistrationService service) {
        this.service = service;
    }

    /* ---------------- parents: no sign-in ---------------- */

    @GetMapping("/api/public/register/{token}")
    public PublicForm publicForm(@PathVariable String token) {
        return service.publicForm(token);
    }

    @PostMapping("/api/public/register/{token}")
    @ResponseStatus(HttpStatus.CREATED)
    public Submitted submit(@PathVariable String token, @RequestBody RegistrationInput in, HttpServletRequest request) {
        return service.submit(token, in, request.getRemoteAddr());
    }

    /* ---------------- the office: the registration pool ---------------- */

    @GetMapping("/api/registrations")
    public List<Row> list() {
        return service.list();
    }

    @GetMapping("/api/registrations/{id}")
    public Row get(@PathVariable String id) {
        return service.get(id);
    }

    @PutMapping("/api/registrations/{id}")
    public Row update(@PathVariable String id, @RequestBody RegistrationInput in) {
        return service.update(id, in);
    }

    @DeleteMapping("/api/registrations/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        service.delete(id);
    }

    /** Places the child in a class: creates the student, as the Students page would. */
    @PostMapping("/api/registrations/{id}/place")
    public Row place(@PathVariable String id, @RequestBody PlaceInput in) {
        return service.place(id, in);
    }

    /* ---------------- the office: the form itself ---------------- */

    @GetMapping("/api/registration-form")
    public FormView form() {
        return service.form();
    }

    @PutMapping("/api/registration-form")
    public FormView saveForm(@RequestBody FormInput in) {
        return service.saveForm(in);
    }

    @PostMapping("/api/registration-form/new-link")
    public FormView newLink() {
        return service.newLink();
    }

    @GetMapping(value = "/api/registration-form/export.csv", produces = "text/csv")
    public ResponseEntity<byte[]> csv() {
        return file("csv", new MediaType("text", "csv", StandardCharsets.UTF_8), service.csv().getBytes(StandardCharsets.UTF_8));
    }

    @GetMapping("/api/registration-form/export.xlsx")
    public ResponseEntity<byte[]> xlsx() {
        return file("xlsx", MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), service.xlsx());
    }

    private static ResponseEntity<byte[]> file(String ext, MediaType type, byte[] body) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"shalom-registrations-" + LocalDate.now() + "." + ext + "\"")
                .contentType(type)
                .body(body);
    }
}

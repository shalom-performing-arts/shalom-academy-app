package lk.shalom.receipts.web;

import lk.shalom.receipts.service.RollService;
import lk.shalom.receipts.service.RollService.MarkInput;
import lk.shalom.receipts.service.RollService.RollClass;
import lk.shalom.receipts.service.RollService.RollDay;
import lk.shalom.receipts.service.RollService.RollMonth;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Student attendance for the office: any day, and the monthly register. */
@RestController
@RequestMapping("/api/roll")
public class RollController {

    private final RollService service;

    public RollController(RollService service) {
        this.service = service;
    }

    @GetMapping("/day")
    public RollDay day(@RequestParam(required = false) String date) {
        return service.day(date == null || date.isBlank() ? service.today() : LocalDate.parse(date));
    }

    @PutMapping("/mark")
    public RollClass mark(@RequestBody MarkInput in) {
        return service.mark(in, RollService.OFFICE, "Office");
    }

    @PostMapping("/all-present")
    public RollClass allPresent(@RequestBody Map<String, String> body) {
        return service.allPresent(body.get("date"), body.get("session"), RollService.OFFICE, "Office");
    }

    @GetMapping("/month")
    public RollMonth month(@RequestParam String session, @RequestParam String month) {
        return service.month(session, month);
    }

    /* ---- cover-up classes ---- */

    @GetMapping("/makeups")
    public List<RollService.MakeupOut> makeups(@RequestParam String month) {
        return service.makeups(month);
    }

    @PostMapping("/makeups")
    @ResponseStatus(HttpStatus.CREATED)
    public RollService.MakeupOut book(@RequestBody RollService.BookInput in) {
        return service.book(in, RollService.OFFICE, "Office");
    }

    @DeleteMapping("/makeups/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void cancel(@PathVariable String id) {
        service.cancel(id, RollService.OFFICE, "Office");
    }
}

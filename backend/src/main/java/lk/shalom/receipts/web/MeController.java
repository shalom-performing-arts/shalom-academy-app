package lk.shalom.receipts.web;

import jakarta.servlet.http.HttpServletRequest;
import lk.shalom.receipts.auth.AuthInterceptor;
import lk.shalom.receipts.service.ApiException;
import lk.shalom.receipts.service.RollService;
import org.springframework.web.bind.annotation.PutMapping;
import java.util.Map;
import lk.shalom.receipts.service.TeacherService;
import lk.shalom.receipts.service.TeacherService.CheckIn;
import lk.shalom.receipts.service.TeacherService.MeOut;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** A signed-in teacher's own day: today's classes, checking in, and their pay so far. */
@RestController
@RequestMapping("/api/me")
public class MeController {

    private final TeacherService service;
    private final RollService roll;

    public MeController(TeacherService service, RollService roll) {
        this.service = service;
        this.roll = roll;
    }

    /* ---- student attendance: a teacher marks today's classes ---- */

    @GetMapping("/roll")
    public RollService.RollDay rollToday(HttpServletRequest request) {
        teacher(request);
        return roll.day(roll.today());
    }

    @PutMapping("/roll/mark")
    public RollService.RollClass rollMark(@RequestBody RollService.MarkInput in, HttpServletRequest request) {
        String id = teacher(request);
        // teachers mark the day they are in; earlier days are the office's
        var today = new RollService.MarkInput(roll.today().toString(), in.session(), in.studentId(), in.status(), in.note());
        return roll.mark(today, id, service.teacher(id).name());
    }

    @PostMapping("/roll/all-present")
    public RollService.RollClass rollAllPresent(@RequestBody Map<String, String> body, HttpServletRequest request) {
        String id = teacher(request);
        return roll.allPresent(roll.today().toString(), body.get("session"), id, service.teacher(id).name());
    }

    @GetMapping
    public MeOut me(HttpServletRequest request) {
        return withInfo(service.me(teacher(request)));
    }

    @PostMapping("/checkin")
    public MeOut checkIn(@RequestBody CheckIn in, HttpServletRequest request) {
        return withInfo(service.checkIn(teacher(request), in));
    }

    /** The app was opened at the academy: the first time today is the teacher's reported time. */
    @PostMapping("/arrive")
    public MeOut arrive(@RequestBody TeacherService.Arrive in, HttpServletRequest request) {
        return withInfo(service.arrive(teacher(request), in));
    }

    /** Takes back the teacher's own mark for one of today's classes. */
    @PostMapping("/unmark")
    public MeOut unmark(@RequestBody TeacherService.Unmark in, HttpServletRequest request) {
        return withInfo(service.unmark(teacher(request), in));
    }

    /** After the class: the teacher confirms they taught it, with an optional note on what was covered. */
    @PostMapping("/done")
    public MeOut done(@RequestBody TeacherService.Finish in, HttpServletRequest request) {
        return withInfo(service.finish(teacher(request), in));
    }

    /** adds each class's session name, musical term and student numbers */
    private MeOut withInfo(MeOut me) {
        return me.withClassInfo(roll.classInfo(me.slots()));
    }

    private static String teacher(HttpServletRequest request) {
        Object id = request.getAttribute(AuthInterceptor.TEACHER);
        if (id == null) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Check-in is for teachers. Sign in with your name and PIN.");
        }
        return id.toString();
    }
}

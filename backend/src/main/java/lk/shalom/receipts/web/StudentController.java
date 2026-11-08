package lk.shalom.receipts.web;

import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.Category;
import lk.shalom.receipts.model.Roster.Session;
import lk.shalom.receipts.model.Roster.SessionInput;
import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.model.Roster.StudentInput;
import lk.shalom.receipts.service.StudentService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api")
public class StudentController {

    private final StudentService service;

    public StudentController(StudentService service) {
        this.service = service;
    }

    /** Students, sessions and class fees. Read fresh from data/students.json on every call. */
    @GetMapping("/roster")
    public Roster roster() {
        return service.roster();
    }

    @PostMapping("/students")
    @ResponseStatus(HttpStatus.CREATED)
    public Student create(@RequestBody StudentInput in) {
        return service.create(in);
    }

    @PutMapping("/students/{id}")
    public Student update(@PathVariable String id, @RequestBody StudentInput in) {
        return service.update(id, in);
    }

    @DeleteMapping("/students/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id) {
        service.delete(id);
    }

    @PostMapping("/sessions")
    @ResponseStatus(HttpStatus.CREATED)
    public Session createSession(@RequestBody SessionInput in) {
        return service.saveSession(in, true);
    }

    /** Changes a session; {@code "rename": "New name"} renames it, taking its students along. */
    @PutMapping("/sessions/{name}")
    public Session updateSession(@PathVariable String name, @RequestBody SessionInput in) {
        return service.saveSession(new SessionInput(name, in.category(), in.day(), in.time(), in.max(),
                in.meaning(), in.family(), in.symbol(), in.symbolStyle(), in.rename()), false);
    }

    @DeleteMapping("/sessions/{name}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteSession(@PathVariable String name) {
        service.deleteSession(name);
    }

    /** All the classes, in order. A class with "from" set is being renamed from that name. */
    @PutMapping("/categories")
    public List<Category> saveCategories(@RequestBody List<Roster.CategoryInput> in) {
        return service.saveCategories(in);
    }
}

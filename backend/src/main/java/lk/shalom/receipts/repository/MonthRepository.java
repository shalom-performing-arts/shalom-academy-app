package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.MonthSheet;

import java.util.List;
import java.util.Optional;

/** Where each fee month's list of dues is kept. */
public interface MonthRepository {

    /** Months that have been started, oldest first, as "2026-11". */
    List<String> months();

    Optional<MonthSheet> find(String month);

    MonthSheet save(MonthSheet sheet);

    List<MonthSheet> findAll();

    void replaceAll(List<MonthSheet> sheets);
}

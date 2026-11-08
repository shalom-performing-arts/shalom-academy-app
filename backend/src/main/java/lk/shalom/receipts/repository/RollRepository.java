package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.RollBook;

import java.util.function.UnaryOperator;

/** Student attendance and cover-up classes. */
public interface RollRepository {

    RollBook get();

    /** Applies a change and saves it as one step, so two people changing it at once cannot overwrite each other. */
    RollBook update(UnaryOperator<RollBook> change);
}

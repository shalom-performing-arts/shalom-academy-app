package lk.shalom.receipts.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * One fee month: who was expected to pay what. The app's version of copying the workbook for a
 * new month. The fees are copied in when the month starts, so changing a student's fee later
 * never rewrites a month that has gone.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record MonthSheet(String month, Instant createdAt, List<Due> dues) {

    /**
     * What one student owes for the month.
     *
     * @param fee           null = no set fee (online, pays as they go); 0 = free place
     * @param feeOverridden the fee was changed for this month only, so roster changes leave it alone
     * @param remark        a free note for the month, e.g. "Admission fee 5000 was given."
     * @param discount      sibling discount already taken off {@code fee}; null on older months
     * @param notBilled     a term-billed class charges nothing this month. A Boolean, not a boolean:
     *                      months saved before it existed have no value, and that must still load.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Due(
            String studentId,
            String name,
            String category,
            String session,
            BigDecimal fee,
            boolean active,
            boolean feeOverridden,
            String remark,
            BigDecimal discount,
            Boolean notBilled
    ) {
        /** Not named isNotBilled, which Jackson would take for a second "notBilled" property. */
        public boolean notDueThisMonth() {
            return Boolean.TRUE.equals(notBilled);
        }

        public Due withFee(BigDecimal fee, boolean overridden) {
            return new Due(studentId, name, category, session, fee, active, overridden, remark,
                    overridden ? BigDecimal.ZERO : discount, overridden ? Boolean.FALSE : notBilled);
        }

        public Due withRemark(String remark) {
            return new Due(studentId, name, category, session, fee, active, feeOverridden, remark, discount, notBilled);
        }

        public Due withPlace(String category, String session) {
            return new Due(studentId, name, category, session, fee, active, feeOverridden, remark, discount, notBilled);
        }
    }
}

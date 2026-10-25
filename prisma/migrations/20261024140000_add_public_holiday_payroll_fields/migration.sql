ALTER TABLE `employee_bonuses`
    ADD COLUMN `implementerEnJourFerie` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `payslips`
    ADD COLUMN `joursFeries` DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `baseFerie` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `joursFeriesAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

-- Existing non-taxable indemnities are included by default, like paid leave.
UPDATE employee_bonuses eb
INNER JOIN bonuses b ON b.id = eb.bonusId
SET eb.implementerEnJourFerie = true
WHERE b.taxable = false;

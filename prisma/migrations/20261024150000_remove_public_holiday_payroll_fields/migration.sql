DELETE FROM `rubrique_base`
WHERE `key` = 'public_holiday_days';

DELETE FROM `rubrique_imposable`
WHERE `calculationKey` = 'public_holiday_100';

UPDATE `employee_bonuses` eb
INNER JOIN `bonuses` b ON b.id = eb.bonusId
SET eb.implementerEnConge = false
WHERE b.taxable = false;

ALTER TABLE `employee_bonuses`
    DROP COLUMN `implementerEnJourFerie`;

ALTER TABLE `payslips`
    DROP COLUMN `joursFeries`,
    DROP COLUMN `baseFerie`,
    DROP COLUMN `joursFeriesAmount`;

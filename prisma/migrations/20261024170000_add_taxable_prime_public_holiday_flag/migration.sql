ALTER TABLE `employee_bonuses`
    ADD COLUMN `implementerEnJourFerie` BOOLEAN NOT NULL DEFAULT false;

UPDATE `employee_bonuses` eb
INNER JOIN `bonuses` b ON b.id = eb.bonusId
SET eb.`implementerEnJourFerie` = false
WHERE b.taxable = false;

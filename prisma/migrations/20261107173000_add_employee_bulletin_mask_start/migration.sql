ALTER TABLE `Employee`
    ADD COLUMN `bulletinMasqueDepuis` INTEGER NULL;

UPDATE `Employee`
SET `bulletinMasqueDepuis` = YEAR(CURRENT_DATE()) * 100 + MONTH(CURRENT_DATE())
WHERE `bulletinMasque` = true;

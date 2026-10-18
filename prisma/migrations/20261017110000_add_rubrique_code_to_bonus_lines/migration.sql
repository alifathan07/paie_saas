ALTER TABLE `bonuses`
    ADD COLUMN `code` VARCHAR(64) NULL;

UPDATE `bonuses`
SET `code` = CONCAT('RUB-', `id`)
WHERE `code` IS NULL OR `code` = '';

ALTER TABLE `bonuses`
    MODIFY COLUMN `code` VARCHAR(64) NOT NULL;

ALTER TABLE `payslip_bonuses`
    ADD COLUMN `code` VARCHAR(64) NOT NULL DEFAULT '';

INSERT INTO `rubrique_base` (`companyId`, `key`, `name`, `code`, `active`)
SELECT c.`id`, 'public_holiday_days', 'Nombre jours fériés', '1010', true
FROM `company` c
WHERE NOT EXISTS (
    SELECT 1 FROM `rubrique_base` rb
    WHERE rb.`companyId` = c.`id` AND rb.`key` = 'public_holiday_days'
);

ALTER TABLE `payslips`
    ADD COLUMN `joursFeries` DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `baseFerie` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `joursFeriesAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

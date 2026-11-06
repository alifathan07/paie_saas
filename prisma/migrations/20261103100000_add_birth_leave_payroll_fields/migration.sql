ALTER TABLE `employee_bonuses`
    ADD COLUMN `implementerEnCongeNaissance` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `payslips`
    ADD COLUMN `congeNaissanceDays` DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `baseCongeNaissance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `congeNaissanceAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

INSERT INTO `rubrique_base` (`companyId`, `key`, `name`, `code`, `active`)
SELECT c.`id`, 'birth_leave_days', 'Nombre jours congé de naissance', '1011', true
FROM `company` c
WHERE NOT EXISTS (
    SELECT 1 FROM `rubrique_base` rb
    WHERE rb.`companyId` = c.`id` AND rb.`key` = 'birth_leave_days'
);

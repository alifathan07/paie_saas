ALTER TABLE `payslips`
    ADD COLUMN `brutGlobal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

UPDATE `payslips`
SET `brutGlobal` = `sbg`;

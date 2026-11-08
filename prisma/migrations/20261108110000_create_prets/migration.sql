CREATE TABLE `prets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `monthlyAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `solde` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `date` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    INDEX `prets_employeeId_date_idx` (`employeeId`, `date`),
    CONSTRAINT `prets_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `pret_deductions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pretId` INTEGER NOT NULL,
    `payslipId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    UNIQUE INDEX `pret_deductions_pretId_payslipId_key` (`pretId`, `payslipId`),
    INDEX `pret_deductions_payslipId_idx` (`payslipId`),
    CONSTRAINT `pret_deductions_pretId_fkey` FOREIGN KEY (`pretId`) REFERENCES `prets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `pret_deductions_payslipId_fkey` FOREIGN KEY (`payslipId`) REFERENCES `payslips` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payslips`
    ADD COLUMN `pretDeduction` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    ADD COLUMN `pretDeductionConfigured` BOOLEAN NOT NULL DEFAULT false;

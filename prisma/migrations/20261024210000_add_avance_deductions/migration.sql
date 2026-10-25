ALTER TABLE `payslips`
    ADD COLUMN `avanceDeduction` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

CREATE TABLE `avance_deductions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `avanceId` INTEGER NOT NULL,
    `payslipId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    UNIQUE INDEX `avance_deductions_avanceId_payslipId_key` (`avanceId`, `payslipId`),
    INDEX `avance_deductions_payslipId_idx` (`payslipId`),
    CONSTRAINT `avance_deductions_avanceId_fkey` FOREIGN KEY (`avanceId`) REFERENCES `avances` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `avance_deductions_payslipId_fkey` FOREIGN KEY (`payslipId`) REFERENCES `payslips` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

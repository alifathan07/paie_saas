ALTER TABLE `rubrique_retenu`
    ADD COLUMN `entryType` VARCHAR(16) NOT NULL DEFAULT 'SYSTEM';

INSERT INTO `rubrique_retenu` (`companyId`, `key`, `name`, `code`, `entryType`, `active`, `createdAt`, `updatedAt`)
SELECT c.`id`, 'loan', 'Retenue prêt', '2008', 'MANUAL', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `company` c
WHERE NOT EXISTS (SELECT 1 FROM `rubrique_retenu` r WHERE r.`companyId` = c.`id` AND r.`key` = 'loan');

CREATE TABLE `payslip_retenus` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payslipId` INTEGER NOT NULL,
    `rubriqueRetenuId` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `payslip_retenus_payslipId_idx`(`payslipId`),
    INDEX `payslip_retenus_rubriqueRetenuId_idx`(`rubriqueRetenuId`),
    CONSTRAINT `payslip_retenus_payslipId_fkey` FOREIGN KEY (`payslipId`) REFERENCES `payslips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `payslip_retenus_rubriqueRetenuId_fkey` FOREIGN KEY (`rubriqueRetenuId`) REFERENCES `rubrique_retenu`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

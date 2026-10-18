CREATE TABLE `rubrique_base` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `rubrique_base_companyId_key_key`(`companyId`, `key`),
    UNIQUE INDEX `rubrique_base_companyId_code_key`(`companyId`, `code`),
    INDEX `rubrique_base_companyId_active_idx`(`companyId`, `active`),
    CONSTRAINT `rubrique_base_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rubrique_retenu` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `rubrique_retenu_companyId_key_key`(`companyId`, `key`),
    UNIQUE INDEX `rubrique_retenu_companyId_code_key`(`companyId`, `code`),
    INDEX `rubrique_retenu_companyId_active_idx`(`companyId`, `active`),
    CONSTRAINT `rubrique_retenu_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

RENAME TABLE `rubrique_imposable` TO `rubrique_imposable_legacy`;

CREATE TABLE `rubrique_imposable` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `defaultAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `entryType` VARCHAR(32) NOT NULL DEFAULT 'MANUAL_AMOUNT',
    `calculationKey` VARCHAR(64) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `rubrique_imposable_companyId_code_key`(`companyId`, `code`),
    UNIQUE INDEX `rubrique_imposable_companyId_name_key`(`companyId`, `name`),
    INDEX `rubrique_imposable_companyId_active_idx`(`companyId`, `active`),
    CONSTRAINT `rubrique_imposable_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payslip_bonuses`
    ADD COLUMN `rubriqueImposableId` INTEGER NULL,
    ADD INDEX `payslip_bonuses_rubriqueImposableId_idx`(`rubriqueImposableId`),
    ADD CONSTRAINT `payslip_bonuses_rubriqueImposableId_fkey` FOREIGN KEY (`rubriqueImposableId`) REFERENCES `rubrique_imposable`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO `rubrique_base` (`companyId`, `key`, `name`, `code`, `active`, `createdAt`, `updatedAt`)
SELECT c.`id`, defaults.`key`, defaults.`name`,
       CASE WHEN defaults.`key` = 'base_salary' AND old.`code` = '10001' THEN defaults.`code` ELSE COALESCE(old.`code`, defaults.`code`) END,
       true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `company` c
JOIN (
    SELECT 'base_salary' AS `key`, 'Salaire de base' AS `name`, '1001' AS `code`
    UNION ALL SELECT 'seniority_bonus', 'Prime d\'ancienneté', '1002'
    UNION ALL SELECT 'taxable_gross_salary', 'Salaire brut imposable', '1003'
    UNION ALL SELECT 'taxable_net_salary', 'Salaire net imposable', '1004'
    UNION ALL SELECT 'net_salary', 'Salaire net à payer', '1005'
) defaults
LEFT JOIN `bulletin_rubrique` old ON old.`name` = defaults.`name`;

INSERT INTO `rubrique_retenu` (`companyId`, `key`, `name`, `code`, `active`, `createdAt`, `updatedAt`)
SELECT c.`id`, defaults.`key`, defaults.`name`, defaults.`code`, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `company` c
JOIN (
    SELECT 'cnss' AS `key`, 'CNSS' AS `name`, '197' AS `code`
    UNION ALL SELECT 'amo', 'AMO', '196'
    UNION ALL SELECT 'cimr', 'CIMR', '199'
    UNION ALL SELECT 'income_tax', 'Impôt sur le revenu', '198'
    UNION ALL SELECT 'salary_advance', 'Avance sur salaire', '400'
    UNION ALL SELECT 'professional_expenses', 'Frais professionnels', '2010'
    UNION ALL SELECT 'rounding', 'Arrondi', '410'
) defaults;

INSERT INTO `rubrique_imposable` (`companyId`, `code`, `name`, `defaultAmount`, `entryType`, `calculationKey`, `active`, `createdAt`, `updatedAt`)
SELECT c.`id`, defaults.`code`, defaults.`name`, 0.00, 'CALCULATED', defaults.`calculationKey`, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `company` c
JOIN (
    SELECT '1006' AS `code`, 'Heures supplémentaires 25%' AS `name`, 'overtime_25' AS `calculationKey`
    UNION ALL SELECT '1007', 'Heures supplémentaires 50%', 'overtime_50'
    UNION ALL SELECT '1008', 'Heures supplémentaires 100%', 'overtime_100'
) defaults;

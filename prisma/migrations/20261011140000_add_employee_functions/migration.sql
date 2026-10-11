CREATE TABLE `employee_functions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `employee_functions_companyId_name_key`(`companyId`, `name`),
    UNIQUE INDEX `employee_functions_companyId_code_key`(`companyId`, `code`),
    INDEX `employee_functions_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `employee_functions` (`name`, `companyId`)
SELECT DISTINCT TRIM(`fonction`), `companyId`
FROM `Employee`
WHERE `fonction` IS NOT NULL AND TRIM(`fonction`) <> '';

UPDATE `employee_functions` f
LEFT JOIN (
    SELECT `companyId`, TRIM(`fonction`) AS `name`, MIN(NULLIF(TRIM(`codeService`), '')) AS `code`
    FROM `Employee`
    WHERE `fonction` IS NOT NULL AND TRIM(`fonction`) <> ''
    GROUP BY `companyId`, TRIM(`fonction`)
) e ON e.`companyId` = f.`companyId` AND e.`name` = f.`name`
SET f.`code` = COALESCE(e.`code`, CONCAT('FONCTION-', f.`id`));

ALTER TABLE `employee_functions` MODIFY `code` VARCHAR(64) NOT NULL;

ALTER TABLE `employee_functions`
    ADD CONSTRAINT `employee_functions_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `company`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Employee` ADD COLUMN `functionId` INTEGER NULL;

UPDATE `Employee` e
JOIN `employee_functions` f
  ON f.`companyId` = e.`companyId`
 AND f.`name` = TRIM(e.`fonction`)
SET e.`functionId` = f.`id`;

ALTER TABLE `Employee`
    ADD INDEX `Employee_functionId_idx`(`functionId`),
    ADD CONSTRAINT `Employee_functionId_fkey`
        FOREIGN KEY (`functionId`) REFERENCES `employee_functions`(`id`)
        ON DELETE SET NULL ON UPDATE CASCADE,
    DROP COLUMN `fonction`;

CREATE TABLE `employee_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `employee_categories_companyId_name_key`(`companyId`, `name`),
    INDEX `employee_categories_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `employee_categories` (`name`, `companyId`)
SELECT DISTINCT
    CASE `statut`
        WHEN 'NON_TITULAIRE' THEN 'Non Titulaire'
        WHEN 'VACATAIRE' THEN 'Vacataire'
        ELSE 'Titulaire'
    END,
    `companyId`
FROM `Employee`;

ALTER TABLE `employee_categories`
    ADD CONSTRAINT `employee_categories_companyId_fkey`
    FOREIGN KEY (`companyId`) REFERENCES `company`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Employee` ADD COLUMN `categoryId` INTEGER NULL;

UPDATE `Employee` e
JOIN `employee_categories` c
  ON c.`companyId` = e.`companyId`
 AND c.`name` = CASE e.`statut`
     WHEN 'NON_TITULAIRE' THEN 'Non Titulaire'
     WHEN 'VACATAIRE' THEN 'Vacataire'
     ELSE 'Titulaire'
 END
SET e.`categoryId` = c.`id`;

ALTER TABLE `Employee`
    MODIFY `categoryId` INTEGER NOT NULL,
    ADD INDEX `Employee_categoryId_idx`(`categoryId`),
    ADD CONSTRAINT `Employee_categoryId_fkey`
        FOREIGN KEY (`categoryId`) REFERENCES `employee_categories`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    DROP COLUMN `statut`;

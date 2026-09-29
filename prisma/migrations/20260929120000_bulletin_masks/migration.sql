ALTER TABLE `Employee`
    ADD COLUMN `bulletinMasque` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `bulletin_masks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `bulletin_masks_employeeId_month_year_key`(`employeeId`, `month`, `year`),
    INDEX `bulletin_masks_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bulletin_masks`
    ADD CONSTRAINT `bulletin_masks_employeeId_fkey`
    FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

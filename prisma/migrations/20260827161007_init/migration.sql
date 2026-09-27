/*
  Warnings:

  - You are about to drop the column `companyId` on the `users` table. All the data in the column will be lost.
  - You are about to drop the `companies` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `employee` DROP FOREIGN KEY `Employee_companyId_fkey`;

-- DropForeignKey
ALTER TABLE `users` DROP FOREIGN KEY `users_companyId_fkey`;

-- DropIndex
DROP INDEX `users_companyId_idx` ON `users`;

-- AlterTable
ALTER TABLE `users` DROP COLUMN `companyId`;

-- DropTable
DROP TABLE `companies`;

-- CreateTable
CREATE TABLE `company` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `ice` VARCHAR(191) NULL,
    `ifNumber` VARCHAR(191) NULL,
    `rc` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `company_ice_key`(`ice`),
    UNIQUE INDEX `company_ifNumber_key`(`ifNumber`),
    UNIQUE INDEX `company_rc_key`(`rc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `userCompanies` (
    `companyId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    PRIMARY KEY (`companyId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `userCompanies` ADD CONSTRAINT `userCompanies_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `userCompanies` ADD CONSTRAINT `userCompanies_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

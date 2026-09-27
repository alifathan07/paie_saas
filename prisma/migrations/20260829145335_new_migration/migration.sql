/*
  Warnings:

  - You are about to drop the column `amount` on the `bonuses` table. All the data in the column will be lost.
  - You are about to drop the column `employeeId` on the `bonuses` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[companyId,name]` on the table `bonuses` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `companyId` to the `bonuses` table without a default value. This is not possible if the table is not empty.
  - Added the required column `baseSalary` to the `Employee` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `bonuses` DROP FOREIGN KEY `bonuses_employeeId_fkey`;

-- DropIndex
DROP INDEX `bonuses_employeeId_idx` ON `bonuses`;

-- AlterTable
ALTER TABLE `bonuses` DROP COLUMN `amount`,
    DROP COLUMN `employeeId`,
    ADD COLUMN `companyId` INTEGER NOT NULL,
    MODIFY `taxable` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `employee` ADD COLUMN `baseSalary` DECIMAL(12, 2) NOT NULL,
    ADD COLUMN `cimrRate` DECIMAL(6, 4) NULL,
    ADD COLUMN `cimrReduitBaseImposable` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `employee_bonuses` (
    `employeeId` INTEGER NOT NULL,
    `bonusId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,

    PRIMARY KEY (`employeeId`, `bonusId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslips` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `workedDays` INTEGER NOT NULL DEFAULT 26,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    `validatedAt` DATETIME(3) NULL,
    `validatedById` INTEGER NULL,
    `baseSalary` DECIMAL(12, 2) NOT NULL,
    `primeAnciennete` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `bonusesIMP` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `bonusesNIMP` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `sbg` DECIMAL(12, 2) NOT NULL,
    `sbi` DECIMAL(12, 2) NOT NULL,
    `cnss` DECIMAL(12, 2) NOT NULL,
    `amo` DECIMAL(12, 2) NOT NULL,
    `cimr` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `fraisPro` DECIMAL(12, 2) NOT NULL,
    `sni` DECIMAL(12, 2) NOT NULL,
    `sniCumule` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `moisEcoules` INTEGER NOT NULL DEFAULT 1,
    `sniAnnuelEstime` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `irAnnuelEstime` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `irCumule` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `irPrecedent` DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
    `irNet` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `irBrut` DECIMAL(12, 2) NOT NULL,
    `irTheorique` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `sommeADeduire` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `chargesDeFamille` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `netAPayer` DECIMAL(12, 2) NOT NULL,
    `absenceDays` INTEGER NOT NULL DEFAULT 0,
    `absenceDeduction` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `heuresSup25` DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    `heuresSup50` DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    `heuresSup100` DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
    `avances` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `cnssRate` DECIMAL(6, 4) NULL,
    `amoRate` DECIMAL(6, 4) NULL,
    `cimrRate` DECIMAL(6, 4) NULL,
    `fraisProRate` DECIMAL(6, 4) NULL,
    `irRate` DECIMAL(6, 4) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payslips_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `payslips_employeeId_month_year_key`(`employeeId`, `month`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslip_bonuses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `payslipId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payslip_bonuses_payslipId_idx`(`payslipId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_configs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cnssSalarialeRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.0448,
    `cnssPlafond` DECIMAL(12, 2) NOT NULL DEFAULT 6000.00,
    `amoSalarialeRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.0226,
    `fraisProStandardRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.3500,
    `fraisProHighRate` DECIMAL(6, 4) NOT NULL DEFAULT 0.2500,
    `fraisProStandardCap` DECIMAL(12, 2) NOT NULL DEFAULT 2500.00,
    `fraisProHighCap` DECIMAL(12, 2) NOT NULL DEFAULT 2916.67,
    `chargeFamilleParPersonne` DECIMAL(12, 2) NOT NULL DEFAULT 50.00,
    `maxChargesFamilleCount` INTEGER NOT NULL DEFAULT 6,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `bonuses_companyId_idx` ON `bonuses`(`companyId`);

-- CreateIndex
CREATE UNIQUE INDEX `bonuses_companyId_name_key` ON `bonuses`(`companyId`, `name`);

-- AddForeignKey
ALTER TABLE `bonuses` ADD CONSTRAINT `bonuses_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_bonuses` ADD CONSTRAINT `employee_bonuses_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_bonuses` ADD CONSTRAINT `employee_bonuses_bonusId_fkey` FOREIGN KEY (`bonusId`) REFERENCES `bonuses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslip_bonuses` ADD CONSTRAINT `payslip_bonuses_payslipId_fkey` FOREIGN KEY (`payslipId`) REFERENCES `payslips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

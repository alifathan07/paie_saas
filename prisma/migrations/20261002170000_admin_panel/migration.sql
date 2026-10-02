ALTER TABLE `users`
  ADD COLUMN `isAdmin` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `isBlocked` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `blockReason` VARCHAR(191) NULL,
  ADD COLUMN `maxCompanies` INTEGER NOT NULL DEFAULT 1;

CREATE TABLE `reports` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `subject` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `adminNote` TEXT NULL,
  `status` ENUM('OPEN', 'IN_PROGRESS', 'SOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `solvedAt` DATETIME(3) NULL,
  `userId` INTEGER NOT NULL,
  `companyId` INTEGER NULL,

  INDEX `reports_userId_status_idx`(`userId`, `status`),
  INDEX `reports_status_createdAt_idx`(`status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `reports`
  ADD CONSTRAINT `reports_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `reports_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE `users` SET `isAdmin` = true WHERE `email` = 'admin@paie.ma';

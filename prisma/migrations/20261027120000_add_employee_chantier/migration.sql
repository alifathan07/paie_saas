ALTER TABLE `Employee`
    ADD COLUMN `chantierId` INTEGER NULL,
    ADD COLUMN `chantierNom` VARCHAR(191) NULL,
    ADD INDEX `Employee_chantierId_idx`(`chantierId`);

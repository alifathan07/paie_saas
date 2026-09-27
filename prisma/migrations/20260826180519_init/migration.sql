-- CreateTable
CREATE TABLE `companies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `ice` VARCHAR(191) NULL,
    `ifNumber` VARCHAR(191) NULL,
    `rc` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `companies_ice_key`(`ice`),
    UNIQUE INDEX `companies_ifNumber_key`(`ifNumber`),
    UNIQUE INDEX `companies_rc_key`(`rc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_companyId_idx`(`companyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `matricule` VARCHAR(191) NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `prenom` VARCHAR(191) NOT NULL,
    `cin` VARCHAR(191) NOT NULL,
    `dateNaissance` DATETIME(3) NOT NULL,
    `sexe` ENUM('M', 'F') NOT NULL,
    `dateEmbauche` DATETIME(3) NOT NULL,
    `dateAnciennete` DATETIME(3) NULL,
    `dateSortie` DATETIME(3) NULL,
    `fonction` VARCHAR(191) NULL,
    `codeService` VARCHAR(191) NULL,
    `statut` ENUM('TITULAIRE', 'NON_TITULAIRE', 'VACATAIRE') NOT NULL DEFAULT 'TITULAIRE',
    `natureEmploi` ENUM('PERMANENT', 'OCCASIONNEL', 'STAGIAIRE', 'EXONERE', 'DOCTORANT') NOT NULL DEFAULT 'PERMANENT',
    `contratDateDebut` DATETIME(3) NULL,
    `contratDateFin` DATETIME(3) NULL,
    `pieceJointeUrl` VARCHAR(191) NULL,
    `blocageSaisiePaie` BOOLEAN NOT NULL DEFAULT false,
    `situationFam` ENUM('CELIBATAIRE', 'MARIE', 'DIVORCE', 'VEUF') NOT NULL,
    `nbPersonacharge` INTEGER NOT NULL DEFAULT 0,
    `nbEnfantCharge` INTEGER NOT NULL DEFAULT 0,
    `adresse` VARCHAR(191) NULL,
    `ville` VARCHAR(191) NULL,
    `image` VARCHAR(191) NULL,
    `numeroCNSS` VARCHAR(191) NULL,
    `dateAffiliationCnss` DATETIME(3) NULL,
    `modePaiement` ENUM('VIREMENT', 'CHEQUE', 'ESPECE') NOT NULL DEFAULT 'VIREMENT',
    `banque` VARCHAR(191) NULL,
    `agence` VARCHAR(191) NULL,
    `rib` VARCHAR(191) NULL,
    `actif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `companyId` INTEGER NOT NULL,

    UNIQUE INDEX `Employee_cin_key`(`cin`),
    UNIQUE INDEX `Employee_numeroCNSS_key`(`numeroCNSS`),
    UNIQUE INDEX `Employee_rib_key`(`rib`),
    UNIQUE INDEX `Employee_companyId_matricule_key`(`companyId`, `matricule`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bonuses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bonuses_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bonuses` ADD CONSTRAINT `bonuses_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `chantiers` (
    `id` INTEGER NOT NULL,
    `code` INTEGER NOT NULL,
    `nom` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `chantiers_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `chantiers` (`id`, `code`, `nom`)
SELECT legacy.`chantierId`, ROW_NUMBER() OVER (ORDER BY legacy.`chantierId`), legacy.`chantierNom`
FROM (
    SELECT `chantierId`, COALESCE(NULLIF(MAX(`chantierNom`), ''), CONCAT('Chantier ', `chantierId`)) AS `chantierNom`
    FROM `Employee`
    WHERE `chantierId` IS NOT NULL
    GROUP BY `chantierId`
) AS legacy;

ALTER TABLE `Employee`
    ADD CONSTRAINT `Employee_chantierId_fkey`
    FOREIGN KEY (`chantierId`) REFERENCES `chantiers`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `banques` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `banques_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `banques` (`name`) VALUES
    ('Attijariwafa Bank'),
    ('Banque Populaire'),
    ('Bank of Africa'),
    ('BMCI'),
    ('CIH Bank'),
    ('Crédit du Maroc'),
    ('Société Générale Maroc'),
    ('Al Barid Bank'),
    ('Crédit Agricole du Maroc'),
    ('CFG Bank'),
    ('Umnia Bank'),
    ('Bank Assafa');

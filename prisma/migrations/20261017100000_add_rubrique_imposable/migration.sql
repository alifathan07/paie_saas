CREATE TABLE `rubrique_imposable` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `rubrique_imposable` (`code`, `name`, `amount`) VALUES
    ('10001', 'Salaire de base', 0.00),
    ('1002', 'Prime d\'ancienneté', 0.00);

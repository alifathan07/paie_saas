CREATE TABLE `bulletin_rubrique` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(64) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `bulletin_rubrique_name_key`(`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `bulletin_rubrique` (`name`, `code`) VALUES
    ('Salaire de base', '10001'),
    ('Prime d\'ancienneté', '1002'),
    ('Salaire brut imposable', 'RUB-3001'),
    ('Salaire net à payer', 'RUB-4001');

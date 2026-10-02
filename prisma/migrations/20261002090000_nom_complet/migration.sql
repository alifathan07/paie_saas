-- Consolidate the employee surname and given name into one full-name field.
ALTER TABLE `Employee` ADD COLUMN `nomComplet` VARCHAR(191) NULL;

UPDATE `Employee`
SET `nomComplet` = TRIM(CONCAT(`nom`, ' ', `prenom`));

ALTER TABLE `Employee`
    MODIFY `nomComplet` VARCHAR(191) NOT NULL,
    DROP COLUMN `nom`,
    DROP COLUMN `prenom`;

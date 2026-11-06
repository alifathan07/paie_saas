ALTER TABLE `rubrique_base`
    ADD COLUMN `visible` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `rubrique_retenu`
    ADD COLUMN `visible` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `rubrique_imposable`
    ADD COLUMN `visible` BOOLEAN NOT NULL DEFAULT true;

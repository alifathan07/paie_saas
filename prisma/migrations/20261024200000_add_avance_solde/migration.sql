ALTER TABLE `avances`
    ADD COLUMN `solde` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

UPDATE `avances`
SET `solde` = `amount`;

CREATE TRIGGER `avances_before_insert_set_solde`
BEFORE INSERT ON `avances`
FOR EACH ROW
SET NEW.`solde` = NEW.`amount`;

UPDATE `Employee`
SET `blocageSaisiePaie` = true
WHERE `actif` = false
  AND `blocageSaisiePaie` = false;

ALTER TABLE `Employee`
    DROP COLUMN `actif`;

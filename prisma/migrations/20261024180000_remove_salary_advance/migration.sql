DELETE FROM `rubrique_retenu`
WHERE `key` = 'salary_advance';

ALTER TABLE `payslips`
    DROP COLUMN `avances`;

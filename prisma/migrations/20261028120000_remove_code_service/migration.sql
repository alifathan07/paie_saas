ALTER TABLE `Employee`
    DROP COLUMN `codeService`;

ALTER TABLE `employee_functions`
    DROP INDEX `employee_functions_companyId_code_key`,
    DROP COLUMN `code`;

INSERT INTO `rubrique_imposable`
    (`companyId`, `code`, `name`, `entryType`, `calculationKey`, `active`, `visible`, `createdAt`, `updatedAt`)
SELECT c.`id`, '1012', 'Rappelle', 'MANUAL_AMOUNT', 'rappelle', true, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `company` c
WHERE NOT EXISTS (
    SELECT 1 FROM `rubrique_imposable` r
    WHERE r.`companyId` = c.`id` AND r.`name` = 'Rappelle'
)
AND NOT EXISTS (
    SELECT 1 FROM `rubrique_imposable` r
    WHERE r.`companyId` = c.`id` AND r.`code` = '1012'
)
AND NOT EXISTS (
    SELECT 1 FROM `rubrique_base` r
    WHERE r.`companyId` = c.`id` AND r.`code` = '1012'
);

UPDATE `rubrique_imposable`
SET `code` = '1006'
WHERE `calculationKey` = 'overtime_25' AND `code` = '3001';

UPDATE `rubrique_imposable`
SET `code` = '1007'
WHERE `calculationKey` = 'overtime_50' AND `code` = '3002';

UPDATE `rubrique_imposable`
SET `code` = '1008'
WHERE `calculationKey` = 'overtime_100' AND `code` = '3003';

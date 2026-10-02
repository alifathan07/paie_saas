-- A company may be owned by only one user.
CREATE UNIQUE INDEX `userCompanies_companyId_key` ON `userCompanies`(`companyId`);

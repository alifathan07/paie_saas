-- Remove legacy employee file references now that employee uploads are no longer supported.
ALTER TABLE `Employee` DROP COLUMN `pieceJointeUrl`, DROP COLUMN `image`;

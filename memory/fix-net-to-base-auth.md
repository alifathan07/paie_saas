---
name: fix-net-to-base-auth
description: Net-to-base uses resolveCompanyId like other employee pages
metadata:
  type: project
---

"Aucune entreprise sélectionnée" on net-to-base came from getSessionCompanyId, which only reads session.user.companyId. Employee pages use resolveCompanyId and fall back to the first company. Net-to-base now uses resolveCompanyId. Appliquer calculates and copies salaire de base into the fiche without saving the employee.

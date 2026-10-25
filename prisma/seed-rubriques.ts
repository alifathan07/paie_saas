import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client.js'

const prisma = new PrismaClient()

const baseRubriques = [
  { key: 'base_salary', name: 'Salaire de base', code: '1001' },
  { key: 'seniority_bonus', name: "Prime d'ancienneté", code: '1002' },
  { key: 'taxable_gross_salary', name: 'Salaire brut imposable', code: '1003' },
  { key: 'taxable_net_salary', name: 'Salaire net imposable', code: '1004' },
  { key: 'net_salary', name: 'Salaire net à payer', code: '1005' },
  { key: 'paid_leave_days', name: 'Nombre jours congé payé', code: '1009' },
  { key: 'public_holiday_days', name: 'Nombre jours fériés', code: '1010' },
]

const retenuRubriques = [
  { key: 'cnss', name: 'CNSS', code: '2001', entryType: 'SYSTEM' },
  { key: 'amo', name: 'AMO', code: '2002', entryType: 'SYSTEM' },
  { key: 'cimr', name: 'CIMR', code: '2003', entryType: 'SYSTEM' },
  { key: 'income_tax', name: 'Impôt sur le revenu', code: '2004', entryType: 'SYSTEM' },
  { key: 'professional_expenses', name: 'Frais professionnels', code: '2006', entryType: 'SYSTEM' },
  { key: 'rounding', name: 'Arrondi', code: '2007', entryType: 'SYSTEM' },
  { key: 'loan', name: 'Retenue prêt', code: '2008', entryType: 'MANUAL' },
]

const imposableRubriques = [
  { code: '1006', name: 'Heures supplémentaires 25%', calculationKey: 'overtime_25' },
  { code: '1007', name: 'Heures supplémentaires 50%', calculationKey: 'overtime_50' },
  { code: '1008', name: 'Heures supplémentaires 100%', calculationKey: 'overtime_100' },
]

async function main() {
  const companies = await prisma.company.findMany({ orderBy: { id: 'asc' } })
  if (!companies.length) throw new Error('Aucune société trouvée. Exécutez d’abord le seed principal.')

  for (const company of companies) {
    for (const row of baseRubriques) {
      await prisma.rubriqueBase.upsert({
        where: { companyId_key: { companyId: company.id, key: row.key } },
        update: { name: row.name, code: row.code, entryType: row.entryType, active: true },
        create: { companyId: company.id, ...row },
      })
    }

    for (const row of retenuRubriques) {
      await prisma.rubriqueRetenu.upsert({
        where: { companyId_key: { companyId: company.id, key: row.key } },
        update: { name: row.name, code: row.code, entryType: row.entryType, active: true },
        create: { companyId: company.id, ...row },
      })
    }

    for (const row of imposableRubriques) {
      await prisma.rubriqueImposable.upsert({
        where: { companyId_code: { companyId: company.id, code: row.code } },
        update: { name: row.name, entryType: 'CALCULATED', calculationKey: row.calculationKey, active: true },
        create: { companyId: company.id, ...row, entryType: 'CALCULATED' },
      })
    }

    console.log(`\nSociété ${company.id} — ${company.name}`)
    console.log('Base')
    console.table(await prisma.rubriqueBase.findMany({ where: { companyId: company.id }, orderBy: { code: 'asc' }, select: { key: true, name: true, code: true } }))
    console.log('Retenues')
    console.table(await prisma.rubriqueRetenu.findMany({ where: { companyId: company.id }, orderBy: { code: 'asc' }, select: { key: true, name: true, code: true } }))
    console.log('Imposables')
    console.table(await prisma.rubriqueImposable.findMany({ where: { companyId: company.id }, orderBy: { code: 'asc' }, select: { name: true, code: true, entryType: true, calculationKey: true } }))
  }
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())

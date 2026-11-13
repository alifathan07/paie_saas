import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client.js'
import {
  initializeCompanyRubriques,
} from '../src/services/defaultRubrique.service.js'

const prisma = new PrismaClient()

async function main() {
  const companies = await prisma.company.findMany({ orderBy: { id: 'asc' } })
  if (!companies.length) throw new Error('Aucune société trouvée. Exécutez d’abord le seed principal.')

  for (const company of companies) {
    await initializeCompanyRubriques(company.id, prisma)

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

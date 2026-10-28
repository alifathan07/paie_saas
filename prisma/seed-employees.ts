import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient();

const categories = [
  'Administration',
  'Cadre',
  'Employé',
  'Stagiaire',
  'Technicien',
  'Ouvrier',
];

const employees = [
  {
    matricule: 'DEMO-MA-001',
    nomComplet: 'Nadia El Mansouri',
    cin: 'MA900101',
    dateNaissance: '1990-01-15',
    sexe: 'F' as const,
    dateEmbauche: '2022-04-11',
    category: 'Administration',
    fonction: 'Responsable Ressources Humaines',
    situationFam: 'MARIE' as const,
    nbPersonacharge: 2,
    nbEnfantCharge: 1,
    adresse: '18 Rue Oued Sebou',
    ville: 'Rabat',
    numeroCNSS: 'MA900100001',
    banque: 'Banque Populaire',
    agence: 'Agdal',
    rib: '190000000000000000000001',
    baseSalary: 11500,
  },
  {
    matricule: 'DEMO-MA-002',
    nomComplet: 'Ayoub Benjelloun',
    cin: 'MA880202',
    dateNaissance: '1988-06-24',
    sexe: 'M' as const,
    dateEmbauche: '2021-09-06',
    category: 'Technicien',
    fonction: 'Technicien Maintenance',
    situationFam: 'CELIBATAIRE' as const,
    nbPersonacharge: 0,
    nbEnfantCharge: 0,
    adresse: '42 Avenue Hassan II',
    ville: 'Casablanca',
    numeroCNSS: 'MA880200002',
    banque: 'Attijariwafa Bank',
    agence: 'Maarif',
    rib: '190000000000000000000002',
    baseSalary: 7200,
  },
  {
    matricule: 'DEMO-MA-003',
    nomComplet: 'Salma El Alaoui',
    cin: 'MA950303',
    dateNaissance: '1995-11-03',
    sexe: 'F' as const,
    dateEmbauche: '2023-02-20',
    category: 'Cadre',
    fonction: 'Comptable',
    situationFam: 'CELIBATAIRE' as const,
    nbPersonacharge: 0,
    nbEnfantCharge: 0,
    adresse: '7 Rue Ibn Sina',
    ville: 'Marrakech',
    numeroCNSS: 'MA950300003',
    banque: 'CIH Bank',
    agence: 'Gueliz',
    rib: '190000000000000000000003',
    baseSalary: 8500,
  },
];

async function main() {
  const requestedCompanyId = Number(process.env.SEED_COMPANY_ID || 0);
  const company = requestedCompanyId > 0
    ? await prisma.company.findUnique({ where: { id: requestedCompanyId } })
    : await prisma.company.findFirst({ orderBy: { id: 'asc' } });

  if (!company) {
    throw new Error('Create a company first, or set SEED_COMPANY_ID to an existing company id.');
  }

  for (const name of categories) {
    await prisma.employeeCategory.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      update: {},
      create: { companyId: company.id, name },
    });
  }
  const employeeFunction = async (name: string) => prisma.employeeFunction.upsert({
    where: { companyId_name: { companyId: company.id, name } },
    update: {}, create: { companyId: company.id, name },
  });

  for (const employee of employees) {
    const employeeFunctionRecord = await employeeFunction(employee.fonction);
    const employeeCategory = await prisma.employeeCategory.findUniqueOrThrow({
      where: { companyId_name: { companyId: company.id, name: employee.category } },
    });
    const { fonction, category, ...employeeData } = employee;
    await prisma.employee.upsert({
      where: { cin: employee.cin },
      update: {
        nomComplet: employee.nomComplet,
        functionId: employeeFunctionRecord.id,
        categoryId: employeeCategory.id,
        baseSalary: employee.baseSalary,
        companyId: company.id,
      },
      create: {
        ...employeeData,
        dateNaissance: new Date(employee.dateNaissance),
        dateEmbauche: new Date(employee.dateEmbauche),
        dateAnciennete: new Date(employee.dateEmbauche),
        functionId: employeeFunctionRecord.id,
        categoryId: employeeCategory.id,
        natureEmploi: 'PERMANENT',
        modePaiement: 'VIREMENT',
        actif: true,
        companyId: company.id,
      },
    });
  }

  console.log(`Seeded ${categories.length} employee categories and 3 Moroccan employees for company "${company.name}".`);
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

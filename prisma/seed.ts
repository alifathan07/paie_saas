import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client.js'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 Starting database seeding...");

  const defaultPassword = "password123";
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  // 1. Seed Companies
  const company1 = await prisma.company.upsert({
    where: { ice: "001234567890001" },
    update: {},
    create: {
      name: "Tech Solutions SARL",
      ice: "001234567890001",
      ifNumber: "12345678",
      rc: "123456",
    },
  });

  const company2 = await prisma.company.upsert({
    where: { ice: "002345678901002" },
    update: {},
    create: {
      name: "Atlas Logistics SA",
      ice: "002345678901002",
      ifNumber: "87654321",
      rc: "654321",
    },
  });

  console.log(`✅ Companies seeded: "${company1.name}", "${company2.name}"`);

  // 2. Seed Reusable Non-Taxable Bonus Catalog per Company
  const bonusRendement = await prisma.bonus.upsert({
    where: { companyId_name: { companyId: company1.id, name: "Prime de Rendement (Exonérée)" } },
    update: { taxable: false },
    create: { companyId: company1.id, name: "Prime de Rendement (Exonérée)", taxable: false },
  });

  const bonusTransport = await prisma.bonus.upsert({
    where: { companyId_name: { companyId: company1.id, name: "Indemnité de Transport" } },
    update: { taxable: false },
    create: { companyId: company1.id, name: "Indemnité de Transport", taxable: false },
  });

  const bonusLogement = await prisma.bonus.upsert({
    where: { companyId_name: { companyId: company1.id, name: "Indemnité de Logement (Exonérée)" } },
    update: { taxable: false },
    create: { companyId: company1.id, name: "Indemnité de Logement (Exonérée)", taxable: false },
  });

  const bonusPanier = await prisma.bonus.upsert({
    where: { companyId_name: { companyId: company1.id, name: "Indemnité de Panier" } },
    update: { taxable: false },
    create: { companyId: company1.id, name: "Indemnité de Panier", taxable: false },
  });

  console.log("✅ Reusable Bonus definitions seeded.");

  // 3. Seed Users
  const userAdmin = await prisma.users.upsert({
    where: { email: "admin@paie.ma" },
    update: { password: hashedPassword, isAdmin: true, isBlocked: false },
    create: { name: "Super Admin", email: "admin@paie.ma", password: hashedPassword, isAdmin: true, maxCompanies: 0 },
  });

  const userAli = await prisma.users.upsert({
    where: { email: "ali.fathi@techsolutions.ma" },
    update: { password: hashedPassword },
    create: { name: "Ali Fathi", email: "ali.fathi@techsolutions.ma", password: hashedPassword },
  });

  const userSara = await prisma.users.upsert({
    where: { email: "sara.mansouri@atlaslogistics.ma" },
    update: { password: hashedPassword },
    create: { name: "Sara Mansouri", email: "sara.mansouri@atlaslogistics.ma", password: hashedPassword },
  });

  await prisma.userCompany.upsert({
    where: { companyId_userId: { companyId: company1.id, userId: userAdmin.id } },
    update: {},
    create: { companyId: company1.id, userId: userAdmin.id },
  });

  await prisma.userCompany.upsert({
    where: { companyId_userId: { companyId: company2.id, userId: userAdmin.id } },
    update: {},
    create: { companyId: company2.id, userId: userAdmin.id },
  });

  console.log("✅ Users seeded.");

  // 3b. Seed payroll legal rates used when generating bulletins
  const existingConfig = await prisma.payrollConfig.findFirst();
  if (!existingConfig) {
    await prisma.payrollConfig.create({ data: {} });
  }
  console.log("✅ PayrollConfig seeded.");

  // 4. Seed Employees
  const emp1 = await prisma.employee.upsert({
    where: { cin: "AB123456" },
    update: { baseSalary: 12000.00 },
    create: {
      matricule: "EMP-001",
      nomComplet: "Youssef Benali",
      cin: "AB123456",
      dateNaissance: new Date("1985-09-22"),
      sexe: "M",
      dateEmbauche: new Date("2019-06-15"),
      fonction: "Ingénieur d'État",
      codeService: "ING-01",
      statut: "TITULAIRE",
      natureEmploi: "PERMANENT",
      situationFam: "MARIE",
      nbPersonacharge: 3,
      nbEnfantCharge: 2,
      adresse: "12 Rue Ibn Battuta",
      ville: "Rabat",
      numeroCNSS: "123456789",
      modePaiement: "VIREMENT",
      banque: "Banque Centrale Populaire",
      agence: "Hassan",
      rib: "001234567890123456789001",
      baseSalary: 12000.00,
      actif: true,
      companyId: company1.id,
      bonuses: {
        create: [
          { bonusId: bonusRendement.id, amount: 1500.00 },
          { bonusId: bonusTransport.id, amount: 500.00 }
        ]
      }
    }
  });

  const emp2 = await prisma.employee.upsert({
    where: { cin: "CD234567" },
    update: { baseSalary: 6500.00 },
    create: {
      matricule: "EMP-002",
      nomComplet: "Karim Mahmoudi",
      cin: "CD234567",
      dateNaissance: new Date("1990-03-30"),
      sexe: "M",
      dateEmbauche: new Date("2021-02-10"),
      fonction: "Technicien Supérieur",
      codeService: "TECH-01",
      statut: "TITULAIRE",
      natureEmploi: "PERMANENT",
      situationFam: "MARIE",
      nbPersonacharge: 1,
      nbEnfantCharge: 1,
      adresse: "7 Avenue Mohammed V",
      ville: "Marrakech",
      numeroCNSS: "234567890",
      modePaiement: "VIREMENT",
      banque: "Attijariwafa Bank",
      agence: "Gueliz",
      rib: "002345678901234567890002",
      baseSalary: 6500.00,
      actif: true,
      companyId: company1.id,
      bonuses: {
        create: [
          { bonusId: bonusRendement.id, amount: 800.00 }
        ]
      }
    }
  });

  const emp3 = await prisma.employee.upsert({
    where: { cin: "EF345678" },
    update: { baseSalary: 4000.00 },
    create: {
      matricule: "EMP-003",
      nomComplet: "Laila Cherkaoui",
      cin: "EF345678",
      dateNaissance: new Date("1995-07-19"),
      sexe: "F",
      dateEmbauche: new Date("2023-09-01"),
      fonction: "Conseillère en Formation",
      codeService: "FORM-01",
      statut: "TITULAIRE",
      natureEmploi: "PERMANENT",
      situationFam: "MARIE",
      nbPersonacharge: 2,
      nbEnfantCharge: 1,
      adresse: "34 Rue Léon l'Africain",
      ville: "Fès",
      numeroCNSS: "345678901",
      modePaiement: "VIREMENT",
      banque: "Crédit Agricole du Maroc",
      agence: "Fès Ville",
      rib: "003456789012345678900003",
      baseSalary: 4000.00,
      actif: true,
      companyId: company2.id
    }
  });

  const emp4 = await prisma.employee.upsert({
    where: { cin: "GH456789" },
    update: { baseSalary: 20000.00 },
    create: {
      matricule: "EMP-004",
      nomComplet: "Youssef El Amrani",
      cin: "GH456789",
      dateNaissance: new Date("1988-02-18"),
      sexe: "M",
      dateEmbauche: new Date("2021-08-24"),
      fonction: "Directeur Technique",
      codeService: "DIR-01",
      statut: "TITULAIRE",
      natureEmploi: "PERMANENT",
      situationFam: "MARIE",
      nbPersonacharge: 4,
      nbEnfantCharge: 3,
      adresse: "8 Rue Ibn Sina",
      ville: "Casablanca",
      numeroCNSS: "456789012",
      modePaiement: "VIREMENT",
      banque: "Société Générale",
      agence: "Maarif",
      rib: "022330000000000000000004",
      baseSalary: 20000.00,
      cimrRate: 0.06,
      cimrReduitBaseImposable: false,
      actif: true,
      companyId: company1.id,
      bonuses: {
        create: [
          { bonusId: bonusRendement.id, amount: 3000.00 },
          { bonusId: bonusLogement.id, amount: 1000.00 }
        ]
      }
    }
  });

  const emp5 = await prisma.employee.upsert({
    where: { cin: "IJ567890" },
    update: { baseSalary: 5500.00 },
    create: {
      matricule: "EMP-005",
      nomComplet: "Hind Chraibi",
      cin: "IJ567890",
      dateNaissance: new Date("2000-01-25"),
      sexe: "F",
      dateEmbauche: new Date("2025-11-15"),
      fonction: "Développeuse Web",
      codeService: "IT-01",
      statut: "NON_TITULAIRE",
      natureEmploi: "STAGIAIRE",
      situationFam: "CELIBATAIRE",
      nbPersonacharge: 0,
      nbEnfantCharge: 0,
      adresse: "22 Av. Hassan II",
      ville: "Mohammedia",
      numeroCNSS: "567890123",
      modePaiement: "VIREMENT",
      banque: "CIH Bank",
      agence: "Mohammedia",
      rib: "230330000000000000000005",
      baseSalary: 5500.00,
      actif: true,
      companyId: company1.id
    }
  });

  console.log(`✅ Employees seeded: ${emp1.nomComplet}, ${emp2.nomComplet}, ${emp3.nomComplet}, ${emp4.nomComplet}, ${emp5.nomComplet}`);
  console.log("🎉 Database seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

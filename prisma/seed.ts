import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client.js'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log("🌱 Starting database seeding...");

  const requiredEnv = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be configured before seeding`);
    return value;
  };
  const adminEmail = requiredEnv("ADMIN_EMAIL").toLowerCase();
  const adminPassword = requiredEnv("ADMIN_PASSWORD");
  const demoPassword = process.env.SEED_DEMO_PASSWORD?.trim() || adminPassword;
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
  const demoPasswordHash = await bcrypt.hash(demoPassword, 10);

  // 1. Company seeding intentionally disabled.
  const bulletinRubriques = [
    { name: "Salaire de base", code: "1001" },
    { name: "Prime d'ancienneté", code: "1002" },
    { name: "Salaire brut imposable", code: "RUB-3001" },
    { name: "Salaire net à payer", code: "RUB-4001" },
  ];
  for (const rubrique of bulletinRubriques) {
    await prisma.legacyBulletinRubrique.upsert({
      where: { name: rubrique.name },
      update: { code: rubrique.code },
      create: rubrique,
    });
  }
  console.log("✅ Bulletin rubriques seeded.");

  // 2. Company-dependent bonus catalog seeding intentionally disabled.

  // 3. Seed Users
  const userAdmin = await prisma.users.upsert({
    where: { email: adminEmail },
    update: { password: adminPasswordHash, isAdmin: true, isBlocked: false },
    create: { name: "Super Admin", email: adminEmail, password: adminPasswordHash, isAdmin: true, maxCompanies: 0 },
  });

  const userAli = await prisma.users.upsert({
    where: { email: "ali.fathi@techsolutions.ma" },
    update: { password: demoPasswordHash },
    create: { name: "Ali Fathi", email: "ali.fathi@techsolutions.ma", password: demoPasswordHash },
  });

  const userSara = await prisma.users.upsert({
    where: { email: "sara.mansouri@atlaslogistics.ma" },
    update: { password: demoPasswordHash },
    create: { name: "Sara Mansouri", email: "sara.mansouri@atlaslogistics.ma", password: demoPasswordHash },
  });

  console.log("✅ Users seeded.");

  // 3b. Seed payroll legal rates used when generating bulletins
  const existingConfig = await prisma.payrollConfig.findFirst();
  if (!existingConfig) {
    await prisma.payrollConfig.create({ data: {} });
  }
  console.log("✅ PayrollConfig seeded.");

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

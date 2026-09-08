import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'devtest@iem.edu.in';
  const password = 'password123';
  
  const existingUser = await prisma.user.findUnique({ where: { email } });
  
  if (existingUser) {
    console.log('User already exists, updating password...');
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { email },
      data: { passwordHash: hashedPassword }
    });
    console.log('Password updated.');
  } else {
    console.log('Creating new devtest user...');
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        email,
        name: 'Dev TestUser',
        passwordHash: hashedPassword,
        department: 'BCA',
        yearOfStudy: 1,
        isVerified: true,
      }
    });
    console.log('User created.');
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());

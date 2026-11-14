const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  // Create 3 users for testing
  const users = [
    { email: 'dispatcher@aerodynamic.test', name: 'Test Dispatcher', role: 'FLIGHT_DISPATCHER' },
    { email: 'crew@aerodynamic.test', name: 'Test Crew', role: 'GROUND_CREW_LEAD' },
    { email: 'director@aerodynamic.test', name: 'Test Director', role: 'OPERATIONS_DIRECTOR' }
  ]

  console.log('Seeding users...')
  for (const u of users) {
    await prisma.users.upsert({
      where: { email: u.email },
      update: {},
      create: u,
    })
  }
  console.log('Users seeded!')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

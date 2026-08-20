import 'dotenv/config';
import { prisma } from '@/lib/db';

const soon = new Date(Date.now() + 2 * 60 * 1000);
const def = await prisma.exportDefinition.findFirst({ orderBy: { createdAt: 'desc' } });
if (!def) { console.log('aucun export'); process.exit(0); }

await prisma.exportDefinition.update({
  where: { id: def.id },
  data: { scheduleCron: '*/5 * * * *', nextRunAt: soon, isActive: true },
});
console.log(`"${def.name}" planifié pour ${soon.toISOString()}`);

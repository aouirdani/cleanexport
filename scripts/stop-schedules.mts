import 'dotenv/config';
import { prisma } from '@/lib/db';

const defs = await prisma.exportDefinition.findMany({
  where: { scheduleCron: { not: null } },
  select: { id: true, name: true, scheduleCron: true, nextRunAt: true },
});
defs.forEach(d => console.log(`${d.name} | ${d.scheduleCron} | next=${d.nextRunAt?.toISOString()}`));

if (process.argv.includes('--apply')) {
  const r = await prisma.exportDefinition.updateMany({
    where: { scheduleCron: { not: null } },
    data: { scheduleCron: null, nextRunAt: null },
  });
  console.log(`\n${r.count} planification(s) arrêtée(s)`);
} else {
  console.log('\n--apply pour arrêter');
}

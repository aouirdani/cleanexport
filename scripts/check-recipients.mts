import 'dotenv/config';
import { prisma } from '@/lib/db';
const defs = await prisma.exportDefinition.findMany({
  select: { name: true, recipients: true },
});
defs.forEach(d => console.log(`${d.name}: ${JSON.stringify(d.recipients)}`));

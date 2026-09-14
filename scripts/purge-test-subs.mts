import 'dotenv/config';
import { prisma } from '@/lib/db';

const KEEP = 'none';

const subs = await prisma.subscription.findMany();
for (const s of subs) {
  const keep = s.stripeSubscriptionId === KEEP;
  console.log(`${keep ? 'GARDE ' : 'EFFACE'} ${s.portalId} ${s.status} ${s.stripeSubscriptionId}`);
}

if (process.argv.includes('--apply')) {
  const r = await prisma.subscription.deleteMany({
    where: { stripeSubscriptionId: { not: KEEP } },
  });
  console.log(`\n${r.count} ligne(s) supprimée(s)`);
} else {
  console.log('\n--apply pour appliquer');
}

import 'dotenv/config';
import { prisma } from '@/lib/db';

const defs = await prisma.exportDefinition.findMany({
  select: { name: true, scheduleCron: true, nextRunAt: true, isActive: true,
            portalId: true, recipients: true },
});
console.log('now:', new Date().toISOString());
for (const d of defs) {
  console.log(`${d.name} | cron=${d.scheduleCron} | next=${d.nextRunAt?.toISOString() ?? 'null'} | active=${d.isActive} | recipients=${d.recipients.length}`);
}

const subs = await prisma.subscription.findMany({ select: { portalId: true, status: true, trialEndsAt: true } });
console.log('\nabonnements:');
subs.forEach(s => console.log(`  ${s.portalId} → ${s.status} (essai jusqu'au ${s.trialEndsAt?.toISOString() ?? '—'})`));

import 'dotenv/config';
import { prisma } from '@/lib/db';
import { isSubscriptionLapsed } from '@/lib/plan';

const def = await prisma.exportDefinition.findFirst({
  where: { name: 'export2' },
  include: { portal: { include: { subscription: true } } },
});
if (!def) { console.log('introuvable'); process.exit(0); }

const now = new Date();
console.log('now        ', now.toISOString());
console.log('nextRunAt  ', def.nextRunAt?.toISOString());
console.log('due        ', def.nextRunAt ? def.nextRunAt <= now : false);
console.log('isActive   ', def.isActive);
console.log('sub status ', def.portal.subscription?.status ?? 'AUCUN');
console.log('lapsed     ', isSubscriptionLapsed(def.portal.subscription, now));
console.log('disconnected', def.portal.disconnectedAt);

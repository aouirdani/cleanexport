import 'dotenv/config';
import { prisma } from '@/lib/db';

const subs = await prisma.subscription.findMany();
if (!subs.length) console.log('aucun abonnement en base');
subs.forEach(s => console.log({
  portalId: s.portalId,
  status: s.status,
  subscription: s.stripeSubscriptionId ?? 'AUCUN',
  cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
  currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
}));

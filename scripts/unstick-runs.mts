import 'dotenv/config';
import { prisma } from '@/lib/db';

const cutoff = new Date(Date.now() - 30 * 60 * 1000);
const stuck = await prisma.exportRun.updateMany({
  where: { status: { in: ['QUEUED', 'RUNNING'] }, createdAt: { lt: cutoff } },
  data: { status: 'FAILED', errorCode: 'TIMEOUT',
          errorMessage: 'Run never started — event lost before Inngest sync.',
          finishedAt: new Date() },
});
console.log(`${stuck.count} run(s) unstuck`);

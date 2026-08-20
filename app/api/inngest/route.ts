import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { exportRun } from '@/inngest/exportRun';
import { scheduleTick } from '@/inngest/scheduleTick';
import { tokenRefresh } from '@/inngest/tokenRefresh';
import { r2Cleanup } from '@/inngest/cleanup';
import { staleRunsSweep } from '@/inngest/staleRuns';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [exportRun, scheduleTick, tokenRefresh, r2Cleanup, staleRunsSweep],
});

/**
 * A deliberately-broken fixture, never wired into the app - used only by
 * tests/security/routeResponseShapes.test.ts's positive-control test, which
 * proves the AST walker actually flags a forbidden key instead of passing
 * vacuously. If this file's shape ever stops matching what that test
 * expects, fix the test, not this comment.
 */
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ portal: { id: 'x', refreshToken: 'this-should-be-caught' } });
}

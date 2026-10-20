import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export default process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and the /gps ingest endpoint
    '/((?!_next|gps|share(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};

"use client";

import Link from "next/link";
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Authenticated, Unauthenticated, AuthLoading, ConvexReactClient, ConvexProvider, useMutation } from 'convex/react'
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from 'convex/react-clerk'
import { dark } from '@clerk/themes';
import { ThemeProvider } from '@/components/theme-provider';
import { UnauthenticatedView } from '@/features/auth/components/unauthenticated-view';
import { AuthLoadingView } from '@/features/auth/components/auth-loading-view';
import { api } from "@convex/_generated/api";

const convex = process.env.NEXT_PUBLIC_CONVEX_URL ? new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL) : null;

// Routes that should bypass the auth wrapper (public or handled by middleware)
const BYPASS_AUTH_WRAPPER_ROUTES = ['/sign-up', '/sign-in', '/onboarding', '/rankings'];

function AuthWrapper({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    // Check for exact match on '/' or prefix match on other routes
    const shouldBypass = pathname === '/' || pathname === '/share' || BYPASS_AUTH_WRAPPER_ROUTES.some(route => pathname?.startsWith(route));

    // Allow certain routes to render without the Authenticated/Unauthenticated wrapper
    if (shouldBypass) {
        return <>{children}</>;
    }

    return (
        <>
            <Authenticated>
                <UserSync />
                {children}
            </Authenticated>
            <Unauthenticated>
                <UnauthenticatedView />
            </Unauthenticated>
            <AuthLoading>
                <AuthLoadingView />
            </AuthLoading>
        </>
    );
}

function UserSync() {
    const storeUser = useMutation(api.users.store);
    const synced = useRef(false);

    useEffect(() => {
        if (synced.current) return;
        synced.current = true;
        storeUser().catch(() => {});
    }, [storeUser]);

    return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    // The participant page does not need a Clerk account or load Clerk scripts.
    if (pathname === '/share') {
        return convex ? <ConvexProvider client={convex}><ThemeProvider attribute="class" defaultTheme="light" enableSystem>{children}</ThemeProvider></ConvexProvider> : <ServiceUnavailable />;
    }
    if (!convex || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
        return pathname === '/' ? <>{children}</> : <ServiceUnavailable />;
    }
    return (
        <ClerkProvider
            appearance={{
            theme: dark,
        }}
        >
            <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="light"
                    enableSystem
                    disableTransitionOnChange
                >
                        <AuthWrapper>{children}</AuthWrapper>

                </ThemeProvider>
            </ConvexProviderWithClerk>
        </ClerkProvider>
    )
}

function ServiceUnavailable() {
    return <main dir="ltr" className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6 text-center">
        <h1 className="text-2xl font-semibold">Service setup is incomplete</h1>
        <p>OpenAirTag is not configured yet. Please try again once service setup is complete.</p>
        <Link href="/" className="underline">Back to home</Link>
    </main>;
}

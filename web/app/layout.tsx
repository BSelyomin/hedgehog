import './globals.css';
import type { ReactNode } from 'react';
export const metadata = { title: 'Hedgehog · Know what your portfolio depends on', description: 'Your holdings, real-world events, and odds you can check.' };
export default function Layout({ children }: {
    children: ReactNode;
}) { return <html lang="en"><body>{children}</body></html>; }

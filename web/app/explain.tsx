'use client';
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const WIDTH = 340, GAP = 8, EDGE = 12, ROOM = 250;

// Wraps a short label so that pointing at it (or focusing it, when `focusable`) opens a fuller
// explanation beside it: below the label where there is room, otherwise above, and never off the
// edge of the window. The explanation is always in the page, so screen readers get it too.
export function Explain({ title, body, focusable = false, id: given, children }: { title: string; body: ReactNode; focusable?: boolean; id?: string; children: ReactNode }) {
    const own = useId(), id = given ?? own, anchor = useRef<HTMLSpanElement>(null);
    const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);
    function open() {
        const box = anchor.current?.getBoundingClientRect();
        if (!box)
            return;
        const width = Math.min(WIDTH, window.innerWidth - 2 * EDGE);
        const left = Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE));
        setPlace(window.innerHeight - box.bottom >= ROOM || box.top < ROOM ? { left, width, top: box.bottom + GAP } : { left, width, bottom: window.innerHeight - box.top + GAP });
    }
    const close = () => setPlace(null);
    return <span className="explained" ref={anchor} tabIndex={focusable ? 0 : undefined} aria-describedby={id} onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}
        onKeyDown={event => { if (event.key === 'Escape') close(); }}>
        {children}
        <span role="tooltip" id={id} className="explain-pop" hidden={!place} style={place ?? undefined}><strong>{title}</strong>{body}</span>
    </span>;
}

// A small "i" beside a label, such as a column name. Pointing at it, focusing it or tapping it
// opens what the label means. It is a real button, so the keyboard and screen readers reach it.
export function Info({ title, children }: { title: string; children: ReactNode }) {
    const id = useId();
    return <Explain title={title} id={id} body={<span>{children}</span>}>
        <button type="button" className="info" aria-label={`What “${title}” means`} aria-describedby={id}><span aria-hidden="true">i</span></button>
    </Explain>;
}

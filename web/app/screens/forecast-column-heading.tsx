'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Portal keeps explanations visible outside the horizontally scrolling table. */
export function ForecastColumnHeading({ label, description }: { label: string; description: string }) {
    const id = useId();
    const anchor = useRef<HTMLButtonElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
    function cancelClose() {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = null;
    }
    function close() { cancelClose(); setPosition(null); }
    function show() {
        cancelClose();
        const bounds = anchor.current?.getBoundingClientRect();
        if (!bounds) return;
        const width = Math.min(280, window.innerWidth - 24);
        setPosition({ width, left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
            ...(bounds.bottom + 160 < window.innerHeight ? { top: bounds.bottom + 8 } : { bottom: window.innerHeight - bounds.top + 8 }) });
    }
    function scheduleClose() { cancelClose(); closeTimer.current = setTimeout(close, 120); }
    useEffect(() => () => cancelClose(), []);
    useEffect(() => {
        if (!position) return;
        const dismiss = () => setPosition(null);
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
        const outside = (event: PointerEvent) => {
            if (event.target instanceof Node && !anchor.current?.contains(event.target) && !document.getElementById(id)?.contains(event.target)) dismiss();
        };
        window.addEventListener('scroll', dismiss, true);
        window.addEventListener('resize', dismiss);
        window.addEventListener('keydown', escape);
        window.addEventListener('pointerdown', outside);
        return () => {
            window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss);
            window.removeEventListener('keydown', escape); window.removeEventListener('pointerdown', outside);
        };
    }, [position, id]);
    return <>
        <button ref={anchor} type="button" className="forecast-column-help" aria-label={`${label}: explanation`}
            aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={scheduleClose}
            onFocus={show} onBlur={close} onClick={show} onKeyDown={event => { if (event.key === 'Escape') close(); }}>
            {label} <span aria-hidden="true">ⓘ</span>
        </button>
        {position && createPortal(<div id={id} role="tooltip" className="forecast-column-tooltip" style={position}
            onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>{description}</div>, document.body)}
    </>;
}

const YEAR = 365.25 * 86400000;
export function yearsUntil(maturity: string, now: number) {
    return (Date.parse(maturity) - now) / YEAR;
}
// Modified duration, in years, of a bond paying `couponRate` percent a year in `frequency`
// payments, `years` from maturity and priced at `yieldRate` percent. It is the percentage fall in
// price for a one percentage point rise in yield, to first order. Coupon dates are counted back
// from maturity, so a bill or a bond inside its last period is a single payment.
export function modifiedDuration(couponRate: number, years: number, yieldRate = couponRate, frequency = 2) {
    if (![couponRate, years, yieldRate].every(Number.isFinite) || years <= 0 || couponRate < 0 || yieldRate <= -100 || !Number.isInteger(frequency) || frequency < 1)
        throw new Error('Invalid bond terms');
    const coupon = couponRate / 100 / frequency, y = yieldRate / 100 / frequency;
    const payments = Math.ceil(years * frequency - 1e-9);
    let value = 0, weighted = 0;
    for (let k = 1; k <= payments; k++) {
        const time = years - (payments - k) / frequency;
        const present = (coupon + (k === payments ? 1 : 0)) / (1 + y) ** (time * frequency);
        value += present;
        weighted += time * present;
    }
    return weighted / value / (1 + y);
}

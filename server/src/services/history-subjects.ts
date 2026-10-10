export const HISTORY_SUBJECTS = [
    {id:'inflation',title:'Inflation',tags:['inflation']},
    {id:'rates',title:'Interest rates',tags:['fed-rates']},
    {id:'companies',title:'Company events',tags:[]},
    {id:'stocks',title:'Stock market',tags:['sp500']},
] as const;
export function subjectSeries(id:string,tags:{series_ticker:string;tag:string}[]):string[] {
    const subject=HISTORY_SUBJECTS.find(s=>s.id===id);
    if (!subject) return [];
    return [...new Set(tags.filter(t=>id==='companies' ? /^[A-Z][A-Z0-9.\-^=]{0,14}$/.test(t.tag) : (subject.tags as readonly string[]).includes(t.tag)).map(t=>t.series_ticker))];
}

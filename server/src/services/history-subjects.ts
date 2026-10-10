export const HISTORY_SUBJECTS = [
    {id:'companies',title:'Company markets',tags:[]},
    {id:'oil',title:'Oil',tags:['oil']},
    {id:'rates',title:'Fed rates',tags:['fed-rates']},
    {id:'inflation',title:'Inflation',tags:['inflation']},
    {id:'treasury',title:'Treasury yields',tags:['treasury-yields']},
    {id:'stocks',title:'Stock market',tags:['sp500']},
    {id:'mortgage',title:'Mortgage rates',tags:['mortgage-rates']},
    {id:'credit',title:'Credit',tags:['credit-defaults']},
] as const;
export function subjectSeries(id:string,tags:{series_ticker:string;tag:string}[]):string[] {
    const subject=HISTORY_SUBJECTS.find(s=>s.id===id);
    if (!subject) return [];
    return [...new Set(tags.filter(t=>id==='companies' ? /^[A-Z][A-Z0-9.\-^=]{0,14}$/.test(t.tag) : (subject.tags as readonly string[]).includes(t.tag)).map(t=>t.series_ticker))];
}
